import chalk from 'chalk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HeaderComponent } from '#/tui/components/chrome/header';
import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import type { AppState } from '#/tui/types';
import {
  setActiveAppearancePreferences,
  setAppearanceRenderHealth,
  setAppearanceRenderQuality,
} from '#/tui/utils/appearance-effects';

const ANSI_SGR = /\u001B\[[0-9;]*m/g;
const strip = (s: string): string => s.replaceAll(ANSI_SGR, '');

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

describe('HeaderComponent density segment', () => {
  const previousLevel = chalk.level;
  const fixedNow = new Date('2026-07-18T13:47:02+09:00').getTime();

  beforeEach(() => {
    chalk.level = 3;
    setActiveAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES);
    setAppearanceRenderQuality('full');
    setAppearanceRenderHealth('healthy');
    vi.useFakeTimers();
  });

  afterEach(() => {
    chalk.level = previousLevel;
    vi.useRealTimers();
  });

  it('shows context usage and session cost on wide terminals', () => {
    const header = new HeaderComponent(
      baseState({ contextUsage: 0.42, contextTokens: 84_000, maxContextTokens: 200_000, sessionCostUsd: 2.5 }),
      () => {},
      () => fixedNow,
    );
    const out = strip(header.render(160).join('\n'));
    expect(out).toContain('CTX');
    expect(out).toContain('84.0k/200.0k');
    expect(out).toContain('COST');
    expect(out).toContain('$2.50');
    header.dispose();
  });

  it('omits the density segment when there is no usage data', () => {
    const header = new HeaderComponent(baseState(), () => {}, () => fixedNow);
    const out = strip(header.render(160).join('\n'));
    expect(out).not.toContain('CTX');
    expect(out).not.toContain('COST');
    header.dispose();
  });

  it('omits the density segment on narrow terminals', () => {
    const header = new HeaderComponent(
      baseState({ contextUsage: 0.42, contextTokens: 84_000, maxContextTokens: 200_000 }),
      () => {},
      () => fixedNow,
    );
    const out = strip(header.render(80).join('\n'));
    expect(out).not.toContain('CTX');
    header.dispose();
  });
});
