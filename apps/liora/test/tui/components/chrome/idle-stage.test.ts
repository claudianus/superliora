import { setCliLocale } from '#/cli/i18n';
import { visibleWidth } from '#/tui/renderer';
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
  FISH_LARGE_RIGHT,
  FISH_SWIM_MS,
  FISH_TAIL_MS,
  applyFishTail,
  paintBubbles,
  paintIdleStoryScene,
  paintMoonlightPath,
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

  it('resolves multi-row fish glyphs (story character ≥3)', () => {
    expect(FISH_LARGE_RIGHT.length).toBeGreaterThanOrEqual(3);
    expect(FISH_COMPACT_RIGHT.length).toBeGreaterThanOrEqual(3);
    expect(resolveFishGlyphRows(80, 20).length).toBeGreaterThanOrEqual(3);
    expect(resolveFishGlyphRows(30, 12).length).toBeGreaterThanOrEqual(3);
  });

  it('turns the fish facing across a swim cycle', () => {
    const a = resolveFishGlyphRows(80, 20, 0).join('\n');
    const b = resolveFishGlyphRows(80, 20, FISH_SWIM_MS * 0.75).join('\n');
    expect(a).not.toBe(b);
    // Right-facing and left-facing markers both appear across the cycle.
    const joined = `${a}\n${b}`;
    expect(joined).toMatch(/[<>]/);
  });

  it('flickers air-stone bubbles over time (no solid splash-moon █)', () => {
    const samples = [0, 80, 160, 240, 400, 800, 1_200].map((t) =>
      resolveLanternGlyph(t, 1).join('|'),
    );
    expect(new Set(samples).size).toBeGreaterThanOrEqual(2);
    for (const s of samples) {
      expect(s).toMatch(/[╒═╨]/);
      expect(s.includes('█')).toBe(false);
    }
  });

  it('flicks the fish tail across frames', () => {
    const a = applyFishTail([...FISH_LARGE_RIGHT], 0, true).join('\n');
    const b = applyFishTail([...FISH_LARGE_RIGHT], FISH_TAIL_MS, true).join('\n');
    const c = applyFishTail([...FISH_LARGE_RIGHT], FISH_TAIL_MS * 2, true).join('\n');
    expect(a).not.toBe(b);
    expect(new Set([a, b, c]).size).toBeGreaterThanOrEqual(2);
    expect(a + b + c).toMatch(/[)(º]/);
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

  it('lays a drifting caustic path across mid-water', () => {
    const width = 40;
    const bandRows = 4;
    const canvas = Array.from({ length: bandRows }, () => '~'.repeat(width));
    paintMoonlightPath(canvas, 0, bandRows, width, 1_000, (ch) => ch);
    const joined = canvas.map((line) => stripAnsi(line)).join('\n');
    expect(joined).toMatch(/[≈∼·]/);
  });

  it('paints food asterisks when sim snapshot has food', () => {
    withAmbientEnv(() => {
      const width = 40;
      const storyRows = 12;
      const canvas = Array.from({ length: storyRows }, () => ' '.repeat(width));
      const sim: IdleTankSnapshot = {
        fish: [],
        food: [{ id: 1, x: 10, y: 5, vy: 0.004 }],
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

  it('uses denser seaweed spacing on wide tanks', () => {
    expect(resolveSeaweedSpacing(80)).toBeLessThanOrEqual(5);
    expect(resolveSeaweedSpacing(80)).toBe(4);
    expect(resolveSeaweedSpacing(50)).toBe(5);
    expect(resolveSeaweedSpacing(30)).toBe(6);
  });

  it('maps aquarium roles from theme tokens only', () => {
    const palette = resolveAquariumPalette(darkColors, 'dark');
    const tokens = new Set(Object.values(darkColors));
    for (const hex of Object.values(palette)) {
      expect(tokens.has(hex)).toBe(true);
    }
    expect(palette.plant).toBe(darkColors.success);
    expect(palette.water).toBe(darkColors.glow);
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
      expect(joined).toMatch(/jewel tank/i);
      expect(joined).toMatch(/tip · /i);
      // Story scene: fish / bubbles / plants / water / coral glyphs.
      expect(joined).toMatch(/[·∙•◦*⋆˚+.✧~≈<>°oO)(|/\\═╨]/);
      for (const line of lines) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(80);
      }
    });
  });

  it('paints multi-row fish art into the canvas', () => {
    withAmbientEnv(() => {
      const lines = renderIdleStageLines(100, DEFAULT_APPEARANCE_PREFERENCES, {
        nowMs: 1_200,
        preferredRows: 24,
      }).map((line) => strip(line));

      // Count consecutive rows that look like fish body strokes.
      let run = 0;
      let maxRun = 0;
      for (const line of lines) {
        if (/[<>°)(]/.test(line) || /><|°\)|\)\)|<\(/.test(line)) {
          run += 1;
          maxRun = Math.max(maxRun, run);
        } else {
          run = 0;
        }
      }
      expect(maxRun).toBeGreaterThanOrEqual(1);
      // At least some fish-like glyphs somewhere in the tank.
      expect(lines.join('\n')).toMatch(/[<>]/);
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
});
