import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_APPEARANCE_PREFERENCES, DEFAULT_FOOTER_PREFERENCES } from '#/tui/config';
import { FooterComponent } from '#/tui/components/chrome/footer/footer';
import type { AppState } from '#/tui/types';
import { setActiveAppearancePreferences } from '#/tui/features/appearance/appearance-effects';

const ANSI_SGR = /\x1b\[[0-9;]*m/g;
function strip(text: string): string {
  return text.replaceAll(ANSI_SGR, '');
}

function baseState(overrides: Partial<AppState> = {}): AppState {
  return {
    model: 'k2',
    workDir: '/tmp/proj',
    additionalDirs: [],
    sessionId: 'sess_1',
    permissionMode: 'yolo',
    planMode: true,
    ultraworkMode: false,
    premiumQualityMode: false,
    thinking: false,
    contextUsage: 0,
    contextTokens: 0,
    maxContextTokens: 200_000,
    isCompacting: false,
    isBackgroundCompacting: false,
    isReplaying: false,
    streamingPhase: 'idle',
    streamingStartTime: 0,
    theme: 'dark',
    version: 'test',
    editorCommand: null,
    notifications: { enabled: true, condition: 'unfocused' },
    availableModels: {},
    footer: {
      ...DEFAULT_FOOTER_PREFERENCES,
      modes: 'off',
      showCompact: true,
      showPromptIntelligence: true,
      mediaReady: 'always',
      labels: 'plain',
    },
    ...overrides,
  } as AppState;
}

describe('Footer modes independence', () => {
  afterEach(() => {
    for (const key of ['OPENAI_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_API_KEY'] as const) {
      delete process.env[key];
    }
  });

  it('modes=off hides YOLO/Plan but still shows compact, prompt-intel, and media', () => {
    process.env['OPENAI_API_KEY'] = 'sk-test';
    setActiveAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, profile: 'off' });

    const footer = new FooterComponent(
      baseState({
        isCompacting: true,
        promptIntelligencePhase: 'suggest',
        permissionMode: 'yolo',
        planMode: true,
        appearance: { ...DEFAULT_APPEARANCE_PREFERENCES, profile: 'off' },
      }),
    );
    const line1 = strip(footer.render(160)[0] ?? '');

    // True mode badges must stay dark when modes slot is off.
    expect(line1).not.toMatch(/\bYOLO\b/);
    expect(line1).not.toMatch(/\bPlan\b/);
    // Independent prefs still paint.
    expect(line1).toMatch(/Compacting/);
    expect(line1).toMatch(/Suggesting/);
    expect(line1).toMatch(/Images ready|Media ready/);
  });

  it('showCompact=false hides compact even when modes=auto', () => {
    const footer = new FooterComponent(
      baseState({
        isCompacting: true,
        footer: {
          ...DEFAULT_FOOTER_PREFERENCES,
          modes: 'auto',
          showCompact: false,
          showPromptIntelligence: false,
          mediaReady: 'off',
          labels: 'plain',
        },
        permissionMode: 'manual',
        planMode: false,
      }),
    );
    const line1 = strip(footer.render(160)[0] ?? '');
    expect(line1).not.toMatch(/Compacting/);
  });
});
