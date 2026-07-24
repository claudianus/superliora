import { describe, expect, it } from 'vitest';

import { Text } from '#/tui/renderer';
import type { AppState } from '#/tui/types';
import {
  STAGE_MAX_HEIGHT,
  STAGE_MAX_WIDTH,
} from '#/tui/controllers/stage-layout';
import { buildTUIStateNativeFrameRegions } from '#/tui/utils/native-layout-frame';
import { planTUINativeStage } from '#/tui/utils/native-stage-plan';
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

  it('keeps situational panels in the vertical stack beside no rail on ultrawide', () => {
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
    const todo = regions.find((region) => region.id === 'todo');
    const expectedStageX = Math.floor((width - STAGE_MAX_WIDTH) / 2);

    // No side rail — the stage keeps the centered reading column and the
    // todo panel renders inside the vertical stack at the stage width.
    expect(regions.some((region) => region.id === 'rail')).toBe(false);
    expect(transcript?.rect).toMatchObject({
      x: expectedStageX,
      width: STAGE_MAX_WIDTH,
    });
    expect(todo?.rect).toMatchObject({
      x: expectedStageX,
      width: STAGE_MAX_WIDTH,
    });
  });

  it('keeps the centered reading column at the wide profile threshold', () => {
    const width = 120;
    const height = 64;
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
    const todo = regions.find((region) => region.id === 'todo');
    const expectedStageX = Math.floor((width - STAGE_MAX_WIDTH) / 2);

    expect(regions.some((region) => region.id === 'rail')).toBe(false);
    expect(transcript?.rect).toMatchObject({ x: expectedStageX, width: STAGE_MAX_WIDTH });
    expect(todo?.rect).toMatchObject({ x: expectedStageX, width: STAGE_MAX_WIDTH });
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

  it('skips stage region clears on ambient damage-only frames', () => {
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

    const cleared = buildTUIStateNativeFrameRegions(state, width, height);
    const ambient = buildTUIStateNativeFrameRegions(state, width, height, {
      ambientDamageOnly: true,
    });

    for (const id of ['transcript', 'editor', 'footer'] as const) {
      const clearedRegion = cleared.find((region) => region.id === id);
      const ambientRegion = ambient.find((region) => region.id === id);
      if (clearedRegion === undefined || ambientRegion === undefined) continue;
      expect(clearedRegion.clear).toBe(true);
      expect(ambientRegion.clear).toBe(false);
    }
  });
});

describe('planTUINativeStage stack panels', () => {
  const planOptions = {
    resolveEditorFallbackLines: () => [],
    resolveEditorRows: () => 1,
  };

  function createSizedState(width: number, height: number) {
    const state = createTUIState({
      initialAppState: fakeInitialAppState(),
      startup: { continueLast: false, yolo: false, auto: false, plan: false },
    });
    Object.defineProperty(state.terminal, 'rows', { configurable: true, get: () => height });
    Object.defineProperty(state.terminal, 'columns', { configurable: true, get: () => width });
    state.editorContainer.addChild(state.editor);
    return state;
  }

  it('renders situational panels into the chrome at the stage width', () => {
    const state = createSizedState(200, 80);
    state.todoPanel.setTodos([{ title: 'Ship stage layout', status: 'in_progress' }]);
    state.todoPanelContainer.addChild(state.todoPanel);
    state.activityContainer.addChild(new Text('agent finished a task', 0, 0));

    const plan = planTUINativeStage(state, 200, 80, planOptions);
    expect(plan.stage.stage.width).toBe(STAGE_MAX_WIDTH);
    expect(plan.chrome.todo.length).toBeGreaterThan(0);
    expect(plan.chrome.activity.length).toBeGreaterThan(0);
    expect(plan.chrome.todo).toEqual(state.todoPanelContainer.render(STAGE_MAX_WIDTH));
    expect(plan.chrome.activity).toEqual(state.activityContainer.render(STAGE_MAX_WIDTH));
  });

  it('keeps panel chrome empty when no situational panel has content', () => {
    const state = createSizedState(200, 80);
    const plan = planTUINativeStage(state, 200, 80, planOptions);
    expect(plan.chrome.todo).toEqual([]);
    expect(plan.chrome.activity).toEqual([]);
    expect(plan.chrome.queue).toEqual([]);
    expect(plan.chrome.btw).toEqual([]);
  });
});
