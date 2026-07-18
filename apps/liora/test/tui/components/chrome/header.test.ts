import chalk from 'chalk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import { formatLocalClock, HeaderComponent } from '#/tui/components/chrome/header';
import type { AppState } from '#/tui/types';
import {
  advanceAppearanceAnimationClock,
  setActiveAppearancePreferences,
  setAppearanceRenderHealth,
  setAppearanceRenderQuality,
} from '#/tui/utils/appearance-effects';

const ANSI_SGR = /\u001B\[[0-9;]*m/g;

function strip(text: string): string {
  return text.replaceAll(ANSI_SGR, '');
}

function baseState(overrides: Partial<AppState> = {}): AppState {
  return {
    model: 'k2',
    workDir: '/tmp',
    additionalDirs: [],
    sessionId: 'sess_1',
    permissionMode: 'manual',
    planMode: false,
    thinking: false,
    contextUsage: 0,
    contextTokens: 0,
    maxContextTokens: 0,
    isCompacting: false,
    isBackgroundCompacting: false,
    isReplaying: false,
    streamingPhase: 'idle',
    streamingStartTime: 0,
    theme: 'dark',
    version: 'test',
    editorCommand: null,
    notifications: { enabled: true, condition: 'unfocused' },
    availableModels: {
      k2: {
        provider: 'managed:kimi-api',
        model: 'kimi-k2',
        maxContextSize: 10000,
        displayName: 'Kimi K2',
      },
    },
    appearance: DEFAULT_APPEARANCE_PREFERENCES,
    ...overrides,
  } as AppState;
}

describe('HeaderComponent', () => {
  const previousChalkLevel = chalk.level;

  beforeEach(() => {
    chalk.level = 3;
    setActiveAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES);
    setAppearanceRenderQuality('full');
    setAppearanceRenderHealth('healthy');
    vi.useFakeTimers();
  });

  afterEach(() => {
    chalk.level = previousChalkLevel;
    vi.useRealTimers();
  });

  it('renders brand mark, particle divider, model label, and local clock on wide terminals', () => {
    const previousEnv = {
      TERM: process.env['TERM'],
      CI: process.env['CI'],
      NO_COLOR: process.env['NO_COLOR'],
    };
    process.env['TERM'] = 'xterm-256color';
    delete process.env['CI'];
    delete process.env['NO_COLOR'];

    try {
      // Freeze the ambient clock so brand space-sparkles are deterministic.
      advanceAppearanceAnimationClock(0);
      const fixedNow = new Date('2026-07-18T13:47:02+09:00').getTime();
      const header = new HeaderComponent(baseState(), () => {}, () => fixedNow);
      const out = strip(header.render(100).join('\n'));
      // Brand may interleave particle glyphs into spaces under premium effects.
      expect(out).toContain('◆');
      expect(out).toContain('SuperLiora');
      expect(out).toContain('Kimi K2');
      expect(out).toContain(formatLocalClock(fixedNow));
      // Particle/divider glyphs should appear between brand and model.
      expect(out).toMatch(/[─━═·∙•◦*]/);
      header.dispose();
    } finally {
      if (previousEnv.TERM === undefined) delete process.env['TERM'];
      else process.env['TERM'] = previousEnv.TERM;
      if (previousEnv.CI === undefined) delete process.env['CI'];
      else process.env['CI'] = previousEnv.CI;
      if (previousEnv.NO_COLOR === undefined) delete process.env['NO_COLOR'];
      else process.env['NO_COLOR'] = previousEnv.NO_COLOR;
    }
  });

  it('refreshes when the local clock second changes', () => {
    let now = new Date('2026-07-18T13:47:02+09:00').getTime();
    const onRefresh = vi.fn();
    const header = new HeaderComponent(baseState(), onRefresh, () => now);

    vi.advanceTimersByTime(999);
    expect(onRefresh).not.toHaveBeenCalled();

    now += 1_000;
    vi.advanceTimersByTime(1);
    expect(onRefresh).toHaveBeenCalledTimes(1);

    header.dispose();
    now += 1_000;
    vi.advanceTimersByTime(1_000);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('hides on tiny terminals', () => {
    const header = new HeaderComponent(baseState());
    expect(header.render(40)).toEqual([]);
    header.dispose();
  });

  it('formats a stable HH:mm:ss local clock label', () => {
    const ms = new Date(2026, 6, 18, 9, 5, 7).getTime();
    expect(formatLocalClock(ms)).toBe('09:05:07');
  });
});
