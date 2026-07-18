import { setCliLocale } from '#/cli/i18n';
import { visibleWidth } from '#/tui/renderer';
import chalk from 'chalk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import {
  IdleStageComponent,
  isEmptyTranscriptChrome,
  renderIdleStageLines,
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
import { MOON_COMPACT, MOON_LARGE, resolveMoonGlyphRows } from '#/tui/utils/night-sky';
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
    // AC1: no hard Math.min(..., 14) ceiling on wide terminals.
    expect(resolveIdleStageRows(80, 24)).toBe(24);
    expect(resolveIdleStageRows(120, 36)).toBe(36);
    expect(resolveIdleStageRows(80, 14)).toBe(14);
    expect(resolveIdleStageRows(80, 15)).toBe(15);
  });

  it('pads render output to exactly preferredRows', () => {
    withAmbientEnv(() => {
      const target = 22;
      const lines = renderIdleStageLines(100, DEFAULT_APPEARANCE_PREFERENCES, {
        nowMs: 1_000,
        preferredRows: target,
        workDir: '/tmp/project',
      });
      expect(lines.length).toBe(target);
    });
  });

  it('rotates mood / tip over time', () => {
    const a = resolveIdleMoodKey(0);
    const b = resolveIdleMoodKey(20_000);
    expect(a).toMatch(/^tui\.idle\.mood\./);
    expect(b).toMatch(/^tui\.idle\.mood\./);
    expect(resolveIdleTipKey(0)).toMatch(/^tui\.tip\./);
  });

  it('resolves multi-row moon glyphs (Blood Moon ≥5)', () => {
    // AC2: moon art is multi-row, not a single spinner glyph.
    expect(MOON_LARGE.length).toBeGreaterThanOrEqual(5);
    expect(MOON_COMPACT.length).toBeGreaterThanOrEqual(5);
    expect(resolveMoonGlyphRows(80, 20).length).toBeGreaterThanOrEqual(5);
    expect(resolveMoonGlyphRows(30, 12).length).toBeGreaterThanOrEqual(5);
  });
});

describe('IdleStageComponent', () => {
  const previousChalkLevel = chalk.level;

  beforeEach(() => {
    chalk.level = 3;
    setActiveAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES);
    setAppearanceRenderQuality('full');
    setAppearanceRenderHealth('healthy');
    setCliLocale('en');
  });

  afterEach(() => {
    chalk.level = previousChalkLevel;
    vi.useRealTimers();
  });

  it('renders a living ambient night-sky scene in safe terminals', () => {
    withAmbientEnv(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      advanceAppearanceAnimationClock(Date.now());

      const lines = new IdleStageComponent({
        state: appState,
        preferredRows: 20,
      }).render(80);
      expect(lines.length).toBe(20);
      const joined = strip(lines.join('\n'));
      expect(joined).toMatch(/waiting for the first spark/i);
      expect(joined).toMatch(/tip · /i);
      // Multi-layer sky: star glyphs and/or block moon cells.
      expect(joined).toMatch(/[·∙•◦*⋆˚+.✦✧█]/);
      for (const line of lines) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(80);
      }
    });
  });

  it('paints a multi-row moon (≥5) into the canvas', () => {
    withAmbientEnv(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      advanceAppearanceAnimationClock(Date.now());

      const lines = renderIdleStageLines(100, DEFAULT_APPEARANCE_PREFERENCES, {
        nowMs: 5_000,
        preferredRows: 24,
      });
      const plain = lines.map((line) => strip(line));
      // Count consecutive rows that contain the solid moon block character.
      let maxRun = 0;
      let run = 0;
      for (const row of plain) {
        if (row.includes('█')) {
          run += 1;
          maxRun = Math.max(maxRun, run);
        } else {
          run = 0;
        }
      }
      expect(maxRun).toBeGreaterThanOrEqual(5);
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
    expect(joined).toContain('첫 불꽃을 기다리는 중');
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

  it('idleTargetRows subtracts Welcome so idle fills residual viewport only', () => {
    const viewport = createTranscriptViewportState();
    const budget = 40;
    const container = new TranscriptViewportComponent(0, 0, viewport, () => budget);
    const welcome = new WelcomeComponent(appState);
    container.addChild(welcome);
    const welcomeRows = welcome.render(80).length;
    const target = container.idleTargetRows(80);
    // Residual = budget - welcome, floored at 10 for a multi-layer scene.
    expect(target).toBe(Math.max(10, budget - welcomeRows));
    // Idle itself must not inflate the residual calculation.
    container.addChild(new IdleStageComponent({ state: appState, preferredRows: target }));
    expect(container.idleTargetRows(80)).toBe(Math.max(10, budget - welcomeRows));
  });
});
