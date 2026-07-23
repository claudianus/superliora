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

  it('formats a stable 12-hour AM/PM local clock label', () => {
    expect(formatLocalClock(new Date(2026, 6, 18, 9, 5, 7).getTime())).toBe('09:05:07 AM');
    expect(formatLocalClock(new Date(2026, 6, 18, 0, 0, 0).getTime())).toBe('12:00:00 AM');
    expect(formatLocalClock(new Date(2026, 6, 18, 12, 0, 0).getTime())).toBe('12:00:00 PM');
    expect(formatLocalClock(new Date(2026, 6, 18, 13, 47, 2).getTime())).toBe('01:47:02 PM');
  });

  it('keeps the ambient clock color seed stable when the second changes', () => {
    const previousEnv = {
      TERM: process.env['TERM'],
      CI: process.env['CI'],
      NO_COLOR: process.env['NO_COLOR'],
    };
    process.env['TERM'] = 'xterm-256color';
    delete process.env['CI'];
    delete process.env['NO_COLOR'];

    try {
      advanceAppearanceAnimationClock(0);
      const t0 = new Date('2026-07-18T13:47:02+09:00').getTime();
      const t1 = t0 + 1_000;
      const headerA = new HeaderComponent(baseState(), () => {}, () => t0);
      const headerB = new HeaderComponent(baseState(), () => {}, () => t1);

      // Same animation clock → only the wall-clock digits should change; the
      // ambient hue base must not jump because the seed is no longer the label.
      const lineA = headerA.render(100)[0] ?? '';
      const lineB = headerB.render(100)[0] ?? '';
      const ansiA = [...lineA.matchAll(/\u001B\[[0-9;]*m/g)].map((m) => m[0]);
      const ansiB = [...lineB.matchAll(/\u001B\[[0-9;]*m/g)].map((m) => m[0]);

      expect(strip(lineA)).toContain('01:47:02 PM');
      expect(strip(lineB)).toContain('01:47:03 PM');
      // Color sequence length stays aligned; the shared SGR runs should not
      // reshuffle solely because the second digit advanced.
      expect(ansiA.length).toBe(ansiB.length);
      // Most SGR codes (everything except digit-local restyles) should match.
      const sharedPrefix = ansiA.filter((code, i) => ansiB[i] === code).length;
      expect(sharedPrefix).toBeGreaterThan(ansiA.length * 0.8);

      headerA.dispose();
      headerB.dispose();
    } finally {
      if (previousEnv.TERM === undefined) delete process.env['TERM'];
      else process.env['TERM'] = previousEnv.TERM;
      if (previousEnv.CI === undefined) delete process.env['CI'];
      else process.env['CI'] = previousEnv.CI;
      if (previousEnv.NO_COLOR === undefined) delete process.env['NO_COLOR'];
      else process.env['NO_COLOR'] = previousEnv.NO_COLOR;
    }
  });
});
