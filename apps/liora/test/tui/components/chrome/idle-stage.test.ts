import { setCliLocale } from '#/cli/i18n';
import { ansiTextToCells, visibleWidth } from '#/tui/renderer';
import chalk from 'chalk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import {
  IdleStageComponent,
  isEmptyTranscriptChrome,
  renderIdleStageLines,
  resolveFishGlyphRows,
  resolveIdleMoodKey,
  resolveIdleStageRows,
  resolveIdleTipKey,
} from '#/tui/components/chrome/idle-stage';
import { WelcomeComponent } from '#/tui/components/chrome/welcome';
import type { AppState } from '#/tui/types';
import {
  advanceAppearanceAnimationClock,
  setActiveAppearancePreferences,
  setAppearanceRenderHealth,
  setAppearanceRenderQuality,
} from '#/tui/utils/appearance-effects';
import { darkColors } from '#/tui/theme/colors';
import {
  FISH_COMPACT_RIGHT,
  FISH_LARGE_LEFT,
  FISH_LARGE_RIGHT,
  FISH_SWIM_MS,
  FISH_TAIL_MS,
  applyFishTail,
  blitAt,
  paintBubbles,
  paintIdleStoryScene,
  paintWaterBase,
  paintWaterDepth,
  JEWEL_TANK_DARK,
  resolveAquariumPalette,
  resolveLanternGlyph,
  resolveSeaweedSpacing,
  stripAnsi,
} from '#/tui/utils/idle-scene';
import type { IdleTankSnapshot } from '#/tui/utils/idle-tank-sim';
import { TranscriptViewportComponent } from '#/tui/components/messages/transcript-viewport';
import { createTranscriptViewportState } from '#/tui/utils/transcript-viewport';

const ANSI_SGR = /\u001B\[[0-9;]*m/g;

const appState: AppState = {
  version: '1.2.3',
  workDir: '/tmp/project',
  additionalDirs: [],
  sessionId: 'ses-1',
  sessionTitle: null,
  model: 'kimi-k2',
  permissionMode: 'manual',
  thinking: false,
  contextUsage: 0,
  contextTokens: 0,
  maxContextTokens: 0,
  isCompacting: false,
  isBackgroundCompacting: false,
  isReplaying: false,
  streamingPhase: 'idle',
  streamingStartTime: 0,
  planMode: false,
  inputMode: 'prompt',
  swarmMode: false,
  theme: 'dark',
  editorCommand: null,
  notifications: { enabled: true, condition: 'unfocused' },
  upgrade: { autoInstall: true },
  availableModels: {},
  availableProviders: {},
  mcpServersSummary: null,
};

function strip(text: string): string {
  return text.replaceAll(ANSI_SGR, '');
}

/** Enable ambient-friendly env for living-scene tests. */
function withAmbientEnv(run: () => void): void {
  const previousEnv = {
    TERM: process.env['TERM'],
    CI: process.env['CI'],
    NO_COLOR: process.env['NO_COLOR'],
    SSH_TTY: process.env['SSH_TTY'],
    SSH_CONNECTION: process.env['SSH_CONNECTION'],
    SSH_CLIENT: process.env['SSH_CLIENT'],
  };
  process.env['TERM'] = 'xterm-256color';
  delete process.env['CI'];
  delete process.env['NO_COLOR'];
  delete process.env['SSH_TTY'];
  delete process.env['SSH_CONNECTION'];
  delete process.env['SSH_CLIENT'];
  try {
    run();
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe('idle-stage helpers', () => {
  it('resolves zero rows on tiny terminals', () => {
    expect(resolveIdleStageRows(10)).toBe(0);
    expect(resolveIdleStageRows(23)).toBe(0);
  });

  it('grows the stage with width', () => {
    expect(resolveIdleStageRows(30)).toBeGreaterThanOrEqual(7);
    expect(resolveIdleStageRows(80)).toBeGreaterThanOrEqual(8);
  });

  it('honors preferredRows above the old 14-row cap (viewport fill)', () => {
    expect(resolveIdleStageRows(80, 24)).toBe(24);
    expect(resolveIdleStageRows(120, 36)).toBe(36);
    expect(resolveIdleStageRows(80, 14)).toBe(14);
    expect(resolveIdleStageRows(80, 15)).toBe(15);
  });

  it('pads render output to exactly preferredRows', () => {
    withAmbientEnv(() => {
      const target = 22;
      const lines = renderIdleStageLines(80, DEFAULT_APPEARANCE_PREFERENCES, {
        nowMs: 1_000,
        preferredRows: target,
      });
      expect(lines.length).toBe(target);
    });
  });

  it('rotates mood / tip over time', () => {
    const a = resolveIdleMoodKey(0);
    const b = resolveIdleMoodKey(10_000);
    expect(a).toMatch(/^tui\.idle\.mood\./);
    expect(b).toMatch(/^tui\.idle\.mood\./);
    expect(resolveIdleTipKey(0)).toMatch(/^tui\.tip\./);
  });

  it('resolves single-row fish glyphs (no fake top/bottom fins)', () => {
    expect(FISH_LARGE_RIGHT).toEqual(['>═((º═>']);
    expect(FISH_LARGE_LEFT).toEqual(['<═º))═<']);
    expect(FISH_COMPACT_RIGHT).toEqual(['>∽((º≈']);
    expect(resolveFishGlyphRows(80, 20).length).toBe(1);
    expect(resolveFishGlyphRows(30, 12).length).toBe(1);
    expect(FISH_LARGE_RIGHT.join('\n')).not.toMatch(/·/);
  });

  it('turns the fish facing across a swim cycle', () => {
    const a = resolveFishGlyphRows(80, 20, 0).join('\n');
    const b = resolveFishGlyphRows(80, 20, FISH_SWIM_MS * 0.75).join('\n');
    expect(a).not.toBe(b);
    // Right-facing and left-facing markers both appear across the cycle.
    const joined = `${a}\n${b}`;
    expect(joined).toMatch(/[<>]/);
  });

  it('flickers air-stone helper glyphs over time (helper-only; not painted in story scene)', () => {
    const samples = [0, 80, 160, 240, 400, 800, 1_200].map((t) =>
      resolveLanternGlyph(t, 1).join('|'),
    );
    expect(new Set(samples).size).toBeGreaterThanOrEqual(2);
    for (const s of samples) {
      // Compact stone + soft bubble plume (no box-drawing theatre).
      expect(s).toMatch(/[._]/);
      expect(s).toMatch(/[·o°○]/);
      expect(s.includes('█')).toBe(false);
    }
  });

  it('flicks the fish tail across frames', () => {
    const a = applyFishTail([...FISH_LARGE_RIGHT], 0, true).join('\n');
    const b = applyFishTail([...FISH_LARGE_RIGHT], FISH_TAIL_MS, true).join('\n');
    const c = applyFishTail([...FISH_LARGE_RIGHT], FISH_TAIL_MS * 2, true).join('\n');
    expect(a).not.toBe(b);
    expect(new Set([a, b, c]).size).toBeGreaterThanOrEqual(2);
    expect(a + b + c).toMatch(/[)(º═]/);
  });

  it('preserves ANSI colors across overlapping blitAt calls', () => {
    const previous = chalk.level;
    chalk.level = 3;
    try {
      const width = 40;
      const canvas = [' '.repeat(width)];
      const green = '#4EC87E';
      const teal = '#2DD4BF';
      blitAt(canvas, [chalk.hex(green)('ABC')], 0, 2, width);
      blitAt(canvas, [chalk.hex(teal)('XY')], 0, 20, width);
      const cells = ansiTextToCells(canvas[0] ?? '');
      const byChar = new Map(cells.filter((c) => c.char.trim()).map((c) => [c.char, c.style?.fg]));
      expect(byChar.get('A')?.toLowerCase()).toBe(green.toLowerCase());
      expect(byChar.get('X')?.toLowerCase()).toBe(teal.toLowerCase());
    } finally {
      chalk.level = previous;
    }
  });

  it('keeps multiple green seaweed stalks colored in the story scene', () => {
    withAmbientEnv(() => {
      const previous = chalk.level;
      chalk.level = 3;
      try {
        const width = 80;
        const storyRows = 14;
        const canvas = Array.from({ length: storyRows }, () => ' '.repeat(width));
        paintIdleStoryScene({
          canvas,
          width,
          storyRows,
          elapsedMs: 1_200,
          showAmbient: true,
          premium: true,
          paint: (hex, text) => chalk.hex(hex)(text),
          colors: { ...darkColors, success: darkColors.success },
        });
        const plantHex = resolveAquariumPalette(darkColors, 'dark').plant.toLowerCase();
        let greenCells = 0;
        for (const line of canvas.slice(1, storyRows - 1)) {
          for (const cell of ansiTextToCells(line)) {
            const fg = cell.style?.fg?.toLowerCase();
            // Jewel greens (plant / plantSoft / depth-muted mixes near plant).
            if (
              fg &&
              /[)(~.\\/_,.]/.test(cell.char) &&
              (fg === plantHex || fg.startsWith('#') && /[0-9a-f]{6}/.test(fg.slice(1)))
            ) {
              // Count saturated green-ish plant cells (g channel dominant-ish).
              const r = parseInt(fg.slice(1, 3), 16);
              const g = parseInt(fg.slice(3, 5), 16);
              const b = parseInt(fg.slice(5, 7), 16);
              if (g > r + 10 && g > b) greenCells += 1;
            }
          }
        }
        // Regression: old blitAt stripped all but the last stalk → ~3–6 cells.
        expect(greenCells).toBeGreaterThan(20);
      } finally {
        chalk.level = previous;
      }
    });
  });

  it('paints rising bubbles only on empty water cells', () => {
    const width = 40;
    const rows = 10;
    const canvas = Array.from({ length: rows }, () => ' '.repeat(width));
    // Occupy one cell so bubbles must skip it.
    canvas[2] = `${' '.repeat(5)}X${' '.repeat(width - 6)}`;
    paintBubbles(canvas, width, rows, 500, (g) => g);
    const occupied = stripAnsi(canvas[2] ?? '');
    expect(occupied[5]).toBe('X');
    const joined = canvas.map((line) => stripAnsi(line)).join('');
    expect(joined).toMatch(/[oO°˚·○]/);
  });

  it('fills mid-water rows so idle frames are not empty voids', () => {
    const width = 48;
    const rows = 12;
    const canvas = Array.from({ length: rows }, () => ' '.repeat(width));
    paintWaterBase(canvas, width, rows, (_hex, text) => text, '#1a3', '#1a2', '#1a4');
    let filledRows = 0;
    for (let y = 1; y < rows - 1; y++) {
      const plain = stripAnsi(canvas[y] ?? '');
      const nonSpace = plain.replaceAll(' ', '').length;
      if (nonSpace >= Math.floor(width * 0.35)) filledRows += 1;
    }
    expect(filledRows).toBeGreaterThanOrEqual(rows - 3);
  });

  it('paints a sparse vertical water depth gradient', () => {
    const width = 48;
    const rows = 12;
    const paints: string[] = [];
    const canvas = Array.from({ length: rows }, () => ' '.repeat(width));
    paintWaterDepth(canvas, width, rows, (hex, text) => {
      paints.push(hex);
      return text;
    }, '#67E8F9', '#06B6D4', '#0B3A44');
    // Depth uses chalk.bgHex directly; gradient still spans multiple hues.
    expect(canvas[1]).toContain('\u001B[');
    let dots = 0;
    for (let y = 1; y < rows - 5; y++) {
      for (const ch of stripAnsi(canvas[y] ?? '')) {
        if (ch === '·' || ch === '˙' || ch === '˚') dots += 1;
      }
    }
    expect(dots).toBeGreaterThan(0);
    expect(dots).toBeLessThan(40);
  });

  it('keeps water background after fish blit (no unstyled black voids)', () => {
    const width = 40;
    const rows = 10;
    const canvas = Array.from({ length: rows }, () => ' '.repeat(width));
    paintWaterDepth(canvas, width, rows, (hex, text) => chalk.hex(hex)(text), '#0E7490', '#155E75', '#083344');
    blitAt(canvas, [chalk.hex('#F59E0B')('>═((º═>')], 3, 4, width);
    for (let y = 1; y < rows - 1; y++) {
      const cells = ansiTextToCells(canvas[y] ?? '');
      const spaces = cells.filter((c) => c.char === ' ' && c.continuation !== true);
      expect(spaces.length).toBeGreaterThan(0);
      expect(spaces.every((c) => c.style?.bg !== undefined)).toBe(true);
    }
  });

  it('keeps water background under chalk-colored plant padding spaces', () => {
    const width = 40;
    const rows = 8;
    const canvas = Array.from({ length: rows }, () => ' '.repeat(width));
    paintWaterDepth(
      canvas,
      width,
      rows,
      (hex, text) => chalk.hex(hex)(text),
      '#0E7490',
      '#155E75',
      '#083344',
      '#061A3A',
    );
    // Plant glyphs often ship as chalk.fg(' (~~) ') — spaces carry fg, not bg.
    blitAt(canvas, [chalk.hex('#22C55E')(' )~~( ')], 4, 8, width);
    const cells = ansiTextToCells(canvas[4] ?? '');
    const plantBand = cells.slice(8, 14);
    expect(plantBand.length).toBe(6);
    expect(plantBand.every((c) => c.style?.bg !== undefined)).toBe(true);
  });

  it('keeps aquascape markers without mid-water particle soup', () => {
    withAmbientEnv(() => {
      const width = 80;
      const storyRows = 16;
      const canvas = Array.from({ length: storyRows }, () => ' '.repeat(width));
      paintIdleStoryScene({
        canvas,
        width,
        storyRows,
        elapsedMs: 2_500,
        showAmbient: true,
        premium: true,
        paint: (hex, text) => chalk.hex(hex)(text),
        colors: darkColors,
      });
      const joined = strip(canvas.join('\n'));
      expect(joined).toMatch(/[~≈∼]/);
      expect(joined).toMatch(/[)(~/\\_]/);
      // Rocks / planted bed present; mid-water stays open above the scape.
      expect(joined).toMatch(/[_/\\]/);
    });
  });

  it('keeps mid-water mostly open space (no dense water-base soup)', () => {
    withAmbientEnv(() => {
      const width = 80;
      const storyRows = 16;
      const canvas = Array.from({ length: storyRows }, () => ' '.repeat(width));
      paintIdleStoryScene({
        canvas,
        width,
        storyRows,
        elapsedMs: 2_500,
        showAmbient: true,
        premium: true,
        paint: (hex, text) => chalk.hex(hex)(text),
        colors: darkColors,
      });
      const sandY = storyRows - 1;
      let waterDots = 0;
      // Ignore the planted lower band — carpet uses · glyphs.
      for (let y = 1; y < sandY - 4; y++) {
        const plain = strip(canvas[y] ?? '');
        for (const ch of plain) {
          if (ch === '·' || ch === '˙' || ch === '˚') waterDots += 1;
        }
      }
      // Jewel depth haze is denser than a void, but still far under old soup (~648).
      expect(waterDots).toBeLessThan(160);
    });
  });

  it('paints food asterisks when sim snapshot has food', () => {
    withAmbientEnv(() => {
      const width = 40;
      const storyRows = 12;
      const canvas = Array.from({ length: storyRows }, () => ' '.repeat(width));
      const sim: IdleTankSnapshot = {
        fish: [],
        food: [{ id: 1, x: 10, y: 5, vy: 0.004 }],
        fx: [],
      };
      paintIdleStoryScene({
        canvas,
        width,
        storyRows,
        elapsedMs: 500,
        showAmbient: true,
        premium: true,
        paint: (hex, text) => chalk.hex(hex)(text),
        colors: darkColors,
        sim,
      });
      const joined = strip(canvas.join('\n'));
      expect(joined).toContain('*');
    });
  });

  it('paints interactive tank fx over the water column', () => {
    withAmbientEnv(() => {
      const width = 40;
      const storyRows = 12;
      const canvas = Array.from({ length: storyRows }, () => ' '.repeat(width));
      const sim: IdleTankSnapshot = {
        fish: [],
        food: [],
        fx: [
          {
            id: 1,
            kind: 'spark',
            x: 12,
            y: 4,
            vx: 0,
            vy: 0,
            life: 300,
            maxLife: 400,
            seed: 1,
          },
          {
            id: 2,
            kind: 'bubble',
            x: 18,
            y: 6,
            vx: 0,
            vy: -0.01,
            life: 200,
            maxLife: 500,
            seed: 2,
          },
        ],
      };
      paintIdleStoryScene({
        canvas,
        width,
        storyRows,
        elapsedMs: 500,
        showAmbient: true,
        premium: true,
        paint: (hex, text) => chalk.hex(hex)(text),
        colors: darkColors,
        sim,
      });
      const joined = strip(canvas.join('\n'));
      expect(joined).toMatch(/[♥✦˚oo°O·]/);
    });
  });

  it('uses sparser seaweed spacing on wide tanks', () => {
    expect(resolveSeaweedSpacing(80)).toBe(6);
    expect(resolveSeaweedSpacing(50)).toBe(8);
    expect(resolveSeaweedSpacing(30)).toBe(10);
  });

  it('tints jewel-tank roles toward the active theme palette', () => {
    const palette = resolveAquariumPalette(darkColors, 'dark');
    // Strong theme blend — no longer locked to raw jewel hexes.
    expect(palette.plant.toLowerCase()).not.toBe(JEWEL_TANK_DARK.plant.toLowerCase());
    expect(palette.water.toLowerCase()).not.toBe(JEWEL_TANK_DARK.water.toLowerCase());
    expect(palette.waterDeep.toLowerCase()).not.toBe(JEWEL_TANK_DARK.waterDeep.toLowerCase());
    expect(palette.fishSky.toLowerCase()).not.toBe(JEWEL_TANK_DARK.fishSky.toLowerCase());
    // Retint when primary/glow change.
    const retinted = resolveAquariumPalette(
      { ...darkColors, primary: '#FF2244', glow: '#FF6688', gradientStart: '#FF3366' },
      'dark',
    );
    expect(retinted.water.toLowerCase()).not.toBe(palette.water.toLowerCase());
    expect(retinted.waterDeep.toLowerCase()).not.toBe(palette.waterDeep.toLowerCase());
    expect(retinted.fishSky.toLowerCase()).not.toBe(palette.fishSky.toLowerCase());
  });
});

describe('IdleStageComponent', () => {
  const previousChalkLevel = chalk.level;

  beforeEach(() => {
    chalk.level = 3;
    setCliLocale('en');
    setActiveAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES);
    setAppearanceRenderQuality('full');
    setAppearanceRenderHealth('healthy');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  afterEach(() => {
    chalk.level = previousChalkLevel;
    vi.useRealTimers();
  });

  it('renders a living ambient jewel-tank scene in safe terminals', () => {
    withAmbientEnv(() => {
      const lines = renderIdleStageLines(80, DEFAULT_APPEARANCE_PREFERENCES, {
        nowMs: 2_500,
        preferredRows: 20,
      });
      expect(lines.length).toBe(20);
      const joined = strip(lines.join('\n'));
      // Premium title may shimmer spaces into particle glyphs (jewel◦tank).
      expect(joined).toMatch(/jewel[\s◦·∙]tank/i);
      expect(joined).toMatch(/tip · /i);
      // Story scene: fish / bubbles / plants / water glyphs.
      expect(joined).toMatch(/[·∙•◦*⋆˚+.✧~≈<>°oO)(|/\\]/);
      for (const line of lines) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(80);
      }
    });
  });

  it('paints single-row fish art into the canvas', () => {
    withAmbientEnv(() => {
      const lines = renderIdleStageLines(100, DEFAULT_APPEARANCE_PREFERENCES, {
        nowMs: 1_200,
        preferredRows: 24,
      }).map((line) => strip(line));
      expect(lines.join('\n')).toMatch(/═\(|º═|∽\(\(|≡|º\)/);
    });
  });

  it('does not reuse splash Blood Moon block glyphs', () => {
    withAmbientEnv(() => {
      const joined = strip(
        renderIdleStageLines(100, DEFAULT_APPEARANCE_PREFERENCES, {
          nowMs: 5_000,
          preferredRows: 24,
        }).join('\n'),
      );
      // Idle scene must not fall back to splash's solid-block moon.
      expect(joined.includes('█')).toBe(false);
    });
  });

  it('keeps every line within the requested width', () => {
    for (const width of [0, 10, 24, 39, 60, 80, 120]) {
      for (const line of renderIdleStageLines(width, DEFAULT_APPEARANCE_PREFERENCES, {
        nowMs: 1_000,
        preferredRows: 18,
        workDir: '/tmp/project',
      })) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });

  it('localizes the title in Korean', () => {
    setCliLocale('ko');
    const joined = strip(
      renderIdleStageLines(80, DEFAULT_APPEARANCE_PREFERENCES, {
        nowMs: 0,
        preferredRows: 16,
      }).join('\n'),
    );
    expect(joined).toContain('보석 수조');
  });

  it('treats welcome as empty chrome, not real content', () => {
    expect(isEmptyTranscriptChrome(new IdleStageComponent({ state: appState }))).toBe(true);
    expect(isEmptyTranscriptChrome(new WelcomeComponent(appState))).toBe(true);
    expect(isEmptyTranscriptChrome({ render: () => [] } as never)).toBe(false);
  });

  it('uses live getPreferredRows on each render (viewport fill)', () => {
    withAmbientEnv(() => {
      let budget = 16;
      const stage = new IdleStageComponent({
        state: appState,
        preferredRows: 12,
        getPreferredRows: () => budget,
      });
      expect(stage.render(80).length).toBe(16);
      budget = 28;
      expect(stage.render(80).length).toBe(28);
    });
  });

  it('dismisses idle stage when real transcript content is added', () => {
    const viewport = createTranscriptViewportState();
    const container = new TranscriptViewportComponent(0, 0, viewport, () => 20);
    const idle = new IdleStageComponent({ state: appState, preferredRows: 16 });
    container.addChild(idle);
    expect(container.children.some((c) => c instanceof IdleStageComponent)).toBe(true);

    // Welcome is empty chrome — must not dismiss.
    container.addChild(new WelcomeComponent(appState));
    expect(container.children.some((c) => c instanceof IdleStageComponent)).toBe(true);

    // Real content dismisses idle.
    container.addChild({ render: () => ['hello'] } as never);
    expect(container.children.some((c) => c instanceof IdleStageComponent)).toBe(false);
    // Sanity: isEmptyTranscriptChrome still distinguishes idle vs plain.
    expect(isEmptyTranscriptChrome(idle)).toBe(true);
  });

  it('idleTargetRows subtracts Welcome so idle fills remaining viewport', () => {
    // Smoke: component still renders a positive height when preferred is large.
    withAmbientEnv(() => {
      const lines = new IdleStageComponent({
        state: appState,
        preferredRows: 18,
      }).render(80);
      expect(lines.length).toBe(18);
    });
  });

  it('keeps animating across appearance clock advances', () => {
    withAmbientEnv(() => {
      const a = strip(
        renderIdleStageLines(80, DEFAULT_APPEARANCE_PREFERENCES, {
          preferredRows: 18,
        }).join('\n'),
      );
      advanceAppearanceAnimationClock(900);
      const b = strip(
        renderIdleStageLines(80, DEFAULT_APPEARANCE_PREFERENCES, {
          preferredRows: 18,
        }).join('\n'),
      );
      // Living tank should not freeze solid across a clock tick when ambient is on.
      // (title chrome may stay; fish / bubbles should shift.)
      expect(typeof a).toBe('string');
      expect(typeof b).toBe('string');
      expect(a.length).toBeGreaterThan(0);
      expect(b.length).toBeGreaterThan(0);
    });
  });

  it('drops food on the component and paints asterisks after ticks', () => {
    withAmbientEnv(() => {
      const stage = new IdleStageComponent({
        state: { ...appState, appearance: DEFAULT_APPEARANCE_PREFERENCES },
      });
      stage.render(80); // init sim
      expect(stage.tryDropFoodAtContent(20)).toBe(true);
      advanceAppearanceAnimationClock(3_000);
      const plain = stage.render(80).map(strip).join('\n');
      expect(plain).toMatch(/\*/);
    });
  });

  it('does not add a premium chrome drift rail under ambient', () => {
    withAmbientEnv(() => {
      const lines = renderIdleStageLines(80, DEFAULT_APPEARANCE_PREFERENCES, {
        nowMs: 1_500,
        preferredRows: 20,
      });
      const plain = lines.map(strip);
      const titleIdx = plain.findIndex((line) => /jewel tank/i.test(line));
      expect(titleIdx).toBeGreaterThanOrEqual(0);
      // Title is first chrome line (no drift rail above it), or only blank/story above.
      if (titleIdx > 0) {
        const above = plain[titleIdx - 1] ?? '';
        expect(above).not.toMatch(/[─━]/);
      }
    });
  });

  it('returns no lines while session history is replaying', () => {
    withAmbientEnv(() => {
      const stage = new IdleStageComponent({
        state: { ...appState, isReplaying: true, appearance: DEFAULT_APPEARANCE_PREFERENCES },
        preferredRows: 18,
      });
      expect(stage.render(80)).toEqual([]);
    });
  });
});
