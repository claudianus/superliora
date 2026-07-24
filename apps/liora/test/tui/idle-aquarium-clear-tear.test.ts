/**
 * Idle aquarium must not sit under a sparse full-stage overlay that can wipe
 * the interior to terminal-default black, and rim bands stay outside transcript.
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
  advanceAppearanceAnimationClock,
  setActiveAppearancePreferences,
  setAppearanceRenderHealth,
  setAppearanceRenderQuality,
} from '#/tui/utils/appearance-effects';
import { buildTUIStateNativeFrameRegions } from '#/tui/utils/native-layout-frame';
import {
  NativeFrameRenderer,
  composeRendererRegions,
  renderNativeLayoutFrame,
  RendererCellBuffer,
  type RendererCell,
  type RendererFrameRegion,
} from '@harness-kit/tui-renderer';

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
    availableModels: {},
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

describe('idle aquarium clear tear', () => {
  const prev = {
    TERM: process.env['TERM'],
    CI: process.env['CI'],
    NO_COLOR: process.env['NO_COLOR'],
    FORCE_COLOR: process.env['FORCE_COLOR'],
  };

  beforeEach(() => {
    process.env['TERM'] = 'xterm-256color';
    process.env['FORCE_COLOR'] = '3';
    delete process.env['CI'];
    delete process.env['NO_COLOR'];
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
    advanceAppearanceAnimationClock(10_000);
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('emits rim stageFrame bands outside the transcript rect', () => {
    const cols = 120;
    // Rows above the reading cap leave vertical letterbox margin, which is
    // what makes the stage frame visible (a full-height stage hides it).
    const rows = 80;
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

    advanceAppearanceAnimationClock(20_000);
    const regions = buildTUIStateNativeFrameRegions(state, cols, rows);
    const transcript = regions.find((r) => r.id === 'transcript')!;
    const rims = regions.filter((r) => r.id?.startsWith('stageFrame:'));
    expect(rims.length).toBeGreaterThanOrEqual(4);

    for (const rim of rims) {
      const overlapsInterior =
        rim.rect.x < transcript.rect.x + transcript.rect.width &&
        rim.rect.x + rim.rect.width > transcript.rect.x &&
        rim.rect.y < transcript.rect.y + transcript.rect.height &&
        rim.rect.y + rim.rect.height > transcript.rect.y;
      expect(overlapsInterior).toBe(false);
      expect(rim.clear).toBe(false);
    }
  });

  it('keeps water bg after composing stack clear under rim overlays', () => {
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

    advanceAppearanceAnimationClock(20_000);
    const regions = buildTUIStateNativeFrameRegions(state, cols, rows);
    const transcript = regions.find((r) => r.id === 'transcript')!;
    const fill = currentTheme.canvasBackgroundCell();
    const renderer = new NativeFrameRenderer({
      width: cols,
      height: rows,
      output: { write: () => undefined },
      synchronized: true,
      outputPolicy: 'premium',
    });

    const mapped = (clearStack: boolean): RendererFrameRegion[] =>
      regions.map((r) => ({
        id: r.id,
        rect: r.rect,
        content: r.content as readonly (readonly RendererCell[])[],
        clear: r.id?.startsWith('stageFrame') ? false : clearStack,
        background: r.background,
        zIndex: r.zIndex,
      }));

    renderNativeLayoutFrame(renderer, mapped(false), { clear: false, fill });
    renderNativeLayoutFrame(renderer, mapped(true), { clear: false, fill });

    const midY = transcript.rect.y + Math.floor(transcript.rect.height * 0.65);
    const midX = transcript.rect.x + Math.floor(transcript.rect.width / 2);
    const cell = renderer.frame.getCell(midX, midY);
    expect(cell.style?.bg).toBeDefined();
    expect(cell.style?.bg?.toLowerCase()).not.toBe('#0b0f14');
  });

  it('documents that full-rect clear with unstyled interior cells wipes water (compose hazard)', () => {
    const buf = new RendererCellBuffer(10, 5, { char: '·', style: { bg: '#111111' } });
    const water = Array.from({ length: 10 }, () => ({ char: '~', style: { bg: '#00aaff' } }));
    composeRendererRegions(buf, [
      {
        id: 'transcript',
        rect: { x: 0, y: 0, width: 10, height: 5 },
        lines: [water, water, water, water, water],
        clear: true,
        background: { char: ' ', style: { bg: '#0B0F14' } },
        zIndex: 1,
      },
      {
        id: 'stageFrame',
        rect: { x: 0, y: 0, width: 10, height: 5 },
        // Dense rows: the runtime paints rim-only bands instead of a sparse
        // full-stage rect (see rimBands in tui/utils/stage-frame.ts), so model
        // the hazard with unstyled interior cells rather than undefined holes.
        lines: Array.from({ length: 5 }, () => {
          const row: { char: string; style?: { fg: string } }[] = Array.from({ length: 10 }, () => ({
            char: ' ',
          }));
          row[0] = { char: '│', style: { fg: '#0f0' } };
          row[9] = { char: '│', style: { fg: '#0f0' } };
          return row;
        }),
        clear: true,
        zIndex: 5,
      },
    ]);
    expect(buf.getCell(5, 2).style?.bg).toBeUndefined();
  });
});
