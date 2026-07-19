/**
 * Regression: Welcome+Idle transcript must not leave unstyled mid-water cells
 * (they inherit canvas #0B0F14 and read as black band flicker).
 */
import chalk from 'chalk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import { WelcomeComponent } from '#/tui/components/chrome/welcome';
import { IdleStageComponent } from '#/tui/components/chrome/idle-stage';
import { createTUIState } from '#/tui/tui-state';
import type { AppState } from '#/tui/types';
import { currentTheme } from '#/tui/theme';
import { darkColors } from '#/tui/theme/colors';
import {
  setActiveAppearancePreferences,
  setAppearanceRenderHealth,
  setAppearanceRenderQuality,
} from '#/tui/utils/appearance-effects';
import { buildTUIStateNativeFrameRegions } from '#/tui/utils/native-layout-frame';
import type { RendererCell } from '@harness-kit/tui-renderer';

function appState(): AppState {
  return {
    model: 'test-model',
    workDir: '/tmp/kimi-test',
    additionalDirs: [],
    sessionId: 'sess-1',
    permissionMode: 'manual',
    planMode: false,
    inputMode: 'prompt',
    swarmMode: false,
    thinking: true,
    contextUsage: 0,
    contextTokens: 0,
    maxContextTokens: 500_000,
    isCompacting: false,
    isBackgroundCompacting: false,
    isReplaying: false,
    streamingPhase: 'idle',
    streamingStartTime: 0,
    theme: 'dark',
    version: '0.0.0-test',
    editorCommand: null,
    notifications: { enabled: true, condition: 'unfocused' },
    upgrade: { autoInstall: true },
    availableModels: {
      'test-model': { model: 'test-model', displayName: 'cursor/grok-4.5' },
    },
    availableProviders: {},
    sessionTitle: null,
    mcpServersSummary: null,
    appearance: {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'premium',
      particles: 'ambient',
      animationFps: 60,
      canvasBackground: true,
    },
  };
}

describe('idle aquarium black-band regression', () => {
  const prev = {
    TERM: process.env.TERM,
    CI: process.env.CI,
    NO_COLOR: process.env.NO_COLOR,
    FORCE_COLOR: process.env.FORCE_COLOR,
  };

  beforeEach(() => {
    process.env.TERM = 'xterm-256color';
    process.env.FORCE_COLOR = '3';
    delete process.env.CI;
    delete process.env.NO_COLOR;
    chalk.level = 3;
    currentTheme.setPalette(darkColors);
    currentTheme.setCanvasBackgroundEnabled(true);
    setAppearanceRenderHealth('healthy');
    setAppearanceRenderQuality('full');
    setActiveAppearancePreferences({
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'premium',
      particles: 'ambient',
      animationFps: 60,
      canvasBackground: true,
    });
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('paints water rows without unstyled spaces after plant/fish layers', () => {
    const cols = 120;
    const rows = 60;
    const state = createTUIState({
      initialAppState: appState(),
      startup: { continueLast: false, yolo: false, auto: false, plan: false },
    });
    Object.defineProperty(state.terminal, 'rows', { configurable: true, get: () => rows });
    Object.defineProperty(state.terminal, 'columns', { configurable: true, get: () => cols });
    state.editorContainer.addChild(state.editor);
    state.transcriptContainer.addChild(new WelcomeComponent(state.appState));
    state.transcriptContainer.addChild(
      new IdleStageComponent({
        state: state.appState,
        getPreferredRows: (width) => state.transcriptContainer.idleTargetRows(width),
      }),
    );

    const regions = buildTUIStateNativeFrameRegions(state, cols, rows);
    const transcript = regions.find((r) => r.id === 'transcript');
    expect(transcript).toBeDefined();
    const lines = transcript!.content as readonly (readonly RendererCell[])[];
    const canvasBg = (currentTheme.canvasBackgroundCell()?.style.bg ?? '').toLowerCase();

    let waterRows = 0;
    for (const line of lines) {
      const plain = line.map((c) => c.char).join('');
      if (plain.includes('╭') || plain.includes('│') || plain.includes('╰')) continue;
      let otherBg = 0;
      let noBg = 0;
      for (const cell of line) {
        const bg = cell.style?.bg?.toLowerCase();
        if (bg === undefined) noBg++;
        else if (bg !== canvasBg) otherBg++;
      }
      if (otherBg <= line.length * 0.4) continue;
      waterRows++;
      // Left gutter pad may be a single canvas cell; mid-water must keep bg.
      expect(noBg).toBeLessThanOrEqual(1);
    }
    expect(waterRows).toBeGreaterThan(5);
  });
});
