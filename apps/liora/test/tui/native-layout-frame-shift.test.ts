import { describe, expect, it } from 'vitest';

import type { Component } from '#/tui/renderer';
import { detectTUIStateNativeLayoutShift } from '#/tui/features/native-layout/native-layout-frame';
import { createTUIState } from '#/tui/tui-state';
import type { AppState } from '#/tui/types';

function fakeInitialAppState(): AppState {
  return {
    model: 'test-model',
    workDir: '/tmp/kimi-test',
    additionalDirs: [],
    sessionId: 'sess-1',
    permissionMode: 'manual',
    planMode: false,
    askMode: false,
    inputMode: 'prompt',
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

function fixedLines(lines: readonly string[]): Component {
  return {
    invalidate: () => {},
    render: () => [...lines],
  };
}

function createShiftState(width = 80, height = 24) {
  const state = createTUIState({
    initialAppState: fakeInitialAppState(),
    startup: { continueLast: false, yolo: false, auto: false, plan: false },
  });
  Object.defineProperty(state.terminal, 'rows', { configurable: true, get: () => height });
  Object.defineProperty(state.terminal, 'columns', { configurable: true, get: () => width });
  return { state, width, height };
}

describe('detectTUIStateNativeLayoutShift editor replacement geometry', () => {
  it('treats editor unmount as geometryShift and persists the editor-slot row count', () => {
    const { state, width } = createShiftState();
    state.editorContainer.addChild(state.editor);

    const first = detectTUIStateNativeLayoutShift(state, width, {});
    expect(first.geometryShift).toBe(false);
    expect(first.next.editorLayoutRows).toEqual(expect.any(Number));
    expect(first.next.editorLayoutRows).toBeGreaterThan(0);

    state.editorContainer.clear();
    const second = detectTUIStateNativeLayoutShift(state, width, first.next);

    expect(second.geometryShift).toBe(true);
    expect(second.structuralShift).toBe(true);
    expect(second.next.editorLayoutRows).toBe(0);
  });

  it('treats editor restore as geometryShift using the persisted empty-slot prior', () => {
    const { state, width } = createShiftState();
    state.editorContainer.addChild(state.editor);

    const mounted = detectTUIStateNativeLayoutShift(state, width, {});
    state.editorContainer.clear();
    const unmounted = detectTUIStateNativeLayoutShift(state, width, mounted.next);
    expect(unmounted.next.editorLayoutRows).toBe(0);

    state.editorContainer.addChild(state.editor);
    const restored = detectTUIStateNativeLayoutShift(state, width, unmounted.next);

    expect(restored.geometryShift).toBe(true);
    expect(restored.structuralShift).toBe(true);
    expect(restored.next.editorLayoutRows).toBe(mounted.next.editorLayoutRows);
  });

  it('treats a taller editor-replacement panel as geometryShift and tracks its rows', () => {
    const { state, width } = createShiftState();
    state.editorContainer.addChild(state.editor);
    const first = detectTUIStateNativeLayoutShift(state, width, {});
    const editorRows = first.next.editorLayoutRows;
    expect(editorRows).toEqual(expect.any(Number));

    const panelLines = Array.from({ length: 12 }, (_, index) => `panel-row-${index}`);
    state.editorContainer.clear();
    state.editorContainer.addChild(fixedLines(panelLines));
    const replaced = detectTUIStateNativeLayoutShift(state, width, first.next);

    expect(replaced.geometryShift).toBe(true);
    expect(replaced.next.editorLayoutRows).toBeGreaterThan(editorRows!);
    expect(replaced.next.editorLayoutRows).toBe(state.editorContainer.measureContentRows(width));
  });
});
