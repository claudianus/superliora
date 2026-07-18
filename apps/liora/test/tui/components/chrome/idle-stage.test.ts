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
  resolveIdleMoonGlyph,
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

describe('idle-stage helpers', () => {
  it('resolves zero rows on tiny terminals', () => {
    expect(resolveIdleStageRows(10)).toBe(0);
    expect(resolveIdleStageRows(23)).toBe(0);
  });

  it('grows the stage with width', () => {
    expect(resolveIdleStageRows(30)).toBeGreaterThanOrEqual(7);
    expect(resolveIdleStageRows(80)).toBeGreaterThanOrEqual(8);
  });

  it('rotates mood / tip / moon over time', () => {
    const a = resolveIdleMoodKey(0);
    const b = resolveIdleMoodKey(20_000);
    expect(a).toMatch(/^tui\.idle\.mood\./);
    expect(b).toMatch(/^tui\.idle\.mood\./);
    expect(resolveIdleMoonGlyph(0).length).toBeGreaterThan(0);
    expect(resolveIdleTipKey(0)).toMatch(/^tui\.tip\./);
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

  it('renders a living ambient scene in safe terminals', () => {
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
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    advanceAppearanceAnimationClock(Date.now());

    try {
      const lines = new IdleStageComponent({ state: appState }).render(80);
      expect(lines.length).toBeGreaterThan(6);
      const joined = strip(lines.join('\n'));
      expect(joined).toMatch(/waiting for the first spark/i);
      expect(joined).toMatch(/tip · /i);
      expect(joined).toMatch(/[·∙•◦*⋆˚+.]/);
      for (const line of lines) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(80);
      }
    } finally {
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('keeps every line within the requested width', () => {
    for (const width of [0, 10, 24, 39, 60, 80, 120]) {
      for (const line of renderIdleStageLines(width, DEFAULT_APPEARANCE_PREFERENCES, {
        nowMs: 1_000,
        workDir: '/tmp/project',
      })) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });

  it('localizes the title in Korean', () => {
    setCliLocale('ko');
    const joined = strip(
      renderIdleStageLines(80, DEFAULT_APPEARANCE_PREFERENCES, { nowMs: 0 }).join('\n'),
    );
    expect(joined).toContain('첫 불꽃을 기다리는 중');
  });

  it('treats welcome as empty chrome, not real content', () => {
    expect(isEmptyTranscriptChrome(new IdleStageComponent({ state: appState }))).toBe(true);
    expect(isEmptyTranscriptChrome(new WelcomeComponent(appState))).toBe(true);
    expect(isEmptyTranscriptChrome({ render: () => [] } as never)).toBe(false);
  });
});
