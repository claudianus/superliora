import { describe, expect, it } from 'vitest';

import { Text } from '#/tui/renderer';
import type { AppState } from '#/tui/types';
import {
  RAIL_WIDTH,
  STAGE_MAX_HEIGHT,
  STAGE_MAX_WIDTH,
  STAGE_RAIL_GAP,
} from '#/tui/controllers/stage-layout';
import { buildTUIStateNativeFrameRegions } from '#/tui/utils/native-layout-frame';
import { createTUIState } from '#/tui/tui-state';

function fakeInitialAppState(): AppState {
  return {
    model: 'test-model',
    workDir: '/tmp/kimi-test',
    additionalDirs: [],
    sessionId: 'sess-1',
    permissionMode: 'manual',
    planMode: false,
    inputMode: 'prompt',
    swarmMode: false,
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
    version: '0.0.0-test',
    editorCommand: null,
    notifications: { enabled: true, condition: 'unfocused' },
    upgrade: { autoInstall: true },
    availableModels: {},
    availableProviders: {},
    sessionTitle: null,
    mcpServersSummary: null,
  };
}

describe('native stage frame layout', () => {
  it('centers the stage column on ultrawide terminals', () => {
    const width = 200;
    const height = 80;
    const state = createTUIState({
      initialAppState: fakeInitialAppState(),
      startup: { continueLast: false, yolo: false, auto: false, plan: false },
    });
    Object.defineProperty(state.terminal, 'rows', { configurable: true, get: () => height });
    Object.defineProperty(state.terminal, 'columns', { configurable: true, get: () => width });
    state.editorContainer.addChild(state.editor);

    const regions = buildTUIStateNativeFrameRegions(state, width, height);
    const transcript = regions.find((region) => region.id === 'transcript');
    const editor = regions.find((region) => region.id === 'editor');
    const expectedX = Math.floor((width - STAGE_MAX_WIDTH) / 2);
    const expectedY = Math.floor((height - STAGE_MAX_HEIGHT) / 2);

    expect(transcript?.rect).toMatchObject({
      x: expectedX,
      y: expectedY,
      width: STAGE_MAX_WIDTH,
    });
    expect(editor?.rect).toMatchObject({
      x: expectedX,
      width: STAGE_MAX_WIDTH,
    });
    expect(editor?.rect?.y).toBeGreaterThanOrEqual(expectedY);
    expect(regions.some((region) => region.id === 'rail')).toBe(false);
  });

  it('places situational panels in a rail beside the centered stage when they fit', () => {
    const width = 200;
    const height = 80;
    const state = createTUIState({
      initialAppState: fakeInitialAppState(),
      startup: { continueLast: false, yolo: false, auto: false, plan: false },
    });
    Object.defineProperty(state.terminal, 'rows', { configurable: true, get: () => height });
    Object.defineProperty(state.terminal, 'columns', { configurable: true, get: () => width });
    state.editorContainer.addChild(state.editor);
    state.todoPanel.setTodos([
      { title: 'Ship stage layout', status: 'in_progress' },
    ]);
    state.todoPanelContainer.addChild(state.todoPanel);

    const regions = buildTUIStateNativeFrameRegions(state, width, height);
    const transcript = regions.find((region) => region.id === 'transcript');
    const rail = regions.find((region) => region.id === 'rail');
    const bundle = STAGE_MAX_WIDTH + STAGE_RAIL_GAP + RAIL_WIDTH;
    const expectedStageX = Math.floor((width - bundle) / 2);
    const expectedStageY = Math.floor((height - STAGE_MAX_HEIGHT) / 2);

    expect(transcript?.rect).toMatchObject({
      x: expectedStageX,
      y: expectedStageY,
      width: STAGE_MAX_WIDTH,
    });
    expect(rail?.rect).toMatchObject({
      x: expectedStageX + STAGE_MAX_WIDTH + STAGE_RAIL_GAP,
      width: RAIL_WIDTH,
      y: transcript?.rect?.y,
      height: transcript?.rect?.height,
    });
    // Railed panels must not steal vertical stack rows under the transcript.
    expect(regions.some((region) => region.id === 'todo')).toBe(false);
  });

  it('keeps compact terminals full-bleed with stacked panels', () => {
    const width = 80;
    const height = 24;
    const state = createTUIState({
      initialAppState: fakeInitialAppState(),
      startup: { continueLast: false, yolo: false, auto: false, plan: false },
    });
    Object.defineProperty(state.terminal, 'rows', { configurable: true, get: () => height });
    Object.defineProperty(state.terminal, 'columns', { configurable: true, get: () => width });
    state.editorContainer.addChild(state.editor);
    state.todoPanel.setTodos([
      { title: 'Stay stacked', status: 'pending' },
    ]);
    state.todoPanelContainer.addChild(state.todoPanel);
    state.transcriptContainer.addChild(new Text('hello', 0, 0));

    const regions = buildTUIStateNativeFrameRegions(state, width, height);
    const transcript = regions.find((region) => region.id === 'transcript');
    const todo = regions.find((region) => region.id === 'todo');

    expect(transcript?.rect).toMatchObject({ x: 0, width: 80 });
    expect(todo?.rect).toMatchObject({ x: 0, width: 80 });
    expect(regions.some((region) => region.id === 'rail')).toBe(false);
  });
});
