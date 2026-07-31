import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HeaderComponent } from '#/tui/components/chrome/header/header';
import { currentTheme, darkColors } from '#/tui/theme';
import type { AppState } from '#/tui/types';

const ANSI = /\u001B\[[0-9;]*m/g;

function strip(text: string): string {
  return text.replaceAll(ANSI, '');
}

function baseState(overrides: Partial<AppState> = {}): AppState {
  return {
    model: 'test',
    workDir: '/tmp',
    additionalDirs: [],
    sessionId: '',
    permissionMode: 'auto',
    planMode: false,
    ultraworkMode: false,
    premiumQualityMode: false,
    orchestratorMode: false,
    inputMode: 'prompt',
    swarmMode: false,
    thinking: false,
    thinkingLevel: 'off',
    contextUsage: 0,
    contextTokens: 0,
    maxContextTokens: 0,
    workingSet: { soft: 0, hard: 0, used: 0 },
    isCompacting: false,
    isBackgroundCompacting: false,
    isReplaying: false,
    streamingPhase: 'idle',
    streamingStartTime: 0,
    promptIntelligencePhase: 'idle',
    activityTip: null,
    theme: 'dark',
    disablePasteBurst: false,
    version: '0.5.0',
    editorCommand: null,
    notifications: { enabled: true, condition: 'unfocused' },
    upgrade: { autoInstall: true },
    appearance: undefined as never,
    onboarding: undefined as never,
    availableModels: {},
    availableProviders: {},
    nonVisionFallbackPolicy: 'analyze',
    providerRouteStatus: null,
    lastProviderRouteSelection: null,
    lastModelRouteNotice: null,
    sessionTitle: null,
    goal: null,
    mcpServersSummary: null,
    providerQuota: null,
    updateNotice: null,
    updateLifecycle: null,
    ...overrides,
  } as AppState;
}

describe('HeaderComponent update badge', () => {
  let previousPalette: typeof currentTheme.palette;

  beforeEach(() => {
    previousPalette = currentTheme.palette;
    currentTheme.setPalette(darkColors);
  });

  afterEach(() => {
    currentTheme.setPalette(previousPalette);
  });

  it('renders completed / installing / failed / available lifecycle badges', () => {
    const cases: Array<{ kind: 'completed' | 'installing' | 'failed' | 'available'; expect: string }> = [
      { kind: 'completed', expect: '✓ updated' },
      { kind: 'installing', expect: '↻ updating' },
      { kind: 'failed', expect: '⚠ update' },
      { kind: 'available', expect: '⬆ v0.6.0' },
    ];
    for (const c of cases) {
      const header = new HeaderComponent(
        baseState({
          updateLifecycle: {
            kind: c.kind,
            version: '0.6.0',
            title: 't',
          },
        }),
        vi.fn(),
        () => 0,
      );
      const out = header.render(120).map(strip).join(' ');
      expect(out).toContain(c.expect);
      header.dispose();
    }
  });
});
