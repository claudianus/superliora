import { describe, expect, it, vi } from 'vitest';

import {
  workerDockBandActive,
  shouldWorkerDockConsumeArrow,
  shouldWorkerDockConsumeEnter,
} from '#/tui/features/worker-dock/dock';
import { buildTUIStateNativeFrameRegions } from '#/tui/features/native-layout/native-layout-frame';
import { createTUIState, type TUIState } from '#/tui/tui-state';
import type { WorkerDockView } from '#/tui/components/panes/worker-dock/panel';
import { emptyConductorJobsSnapshot } from '#/tui/utils/job/job-strip';
import type { AppState } from '#/tui/types';
import { handleWorkerDockMouse } from '#/tui/features/worker-dock/worker-dock-mouse';
import { getTUIStateNativeWorkerDockRect } from '#/tui/features/transcript/transcript-hit-test';
import { createTUIStateNativeInputRouter } from '#/tui/features/native-layout/native-input-router';
import type { NativeInputEvent } from '#/tui/renderer';

function fakeInitialAppState(): AppState {
  return {
    model: 'test-model',
    workDir: '/tmp/kimi-test',
    additionalDirs: [],
    sessionId: 'sess-1',
    permissionMode: 'manual',
    inputMode: 'prompt',
    thinking: false,
    contextUsage: 0,
    contextTokens: 0,
    maxContextTokens: 0,
    isCompacting: false,
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
  };
}

function createState(columns: number, rows: number): TUIState {
  const state = createTUIState({
    initialAppState: fakeInitialAppState(),
    startup: { continueLast: false, yolo: false, auto: false },
  });
  Object.defineProperty(state.terminal, 'rows', { configurable: true, get: () => rows });
  Object.defineProperty(state.terminal, 'columns', { configurable: true, get: () => columns });
  state.editorContainer.addChild(state.editor);
  return state;
}

function busyView(): WorkerDockView {
  return {
    snapshot: {
      version: 1,
      activeCount: 1,
      totalTokens: 100,
      ops: [],
      workers: [
        {
          id: 'sa-1',
          name: 'explore-1',
          kind: 'subagent',
          status: 'running',
          runInBackground: false,
          toolCount: 3,
          tokens: 100,
          elapsedMs: 5_000,
          spawnedAtMs: 1_000,
          lastActivityAtMs: 1_000,
        },
      ],
    },
    jobs: emptyConductorJobsSnapshot(),
  };
}

describe('shouldWorkerDockConsumeEnter', () => {
  it('lets editor submit when the prompt has draft text', () => {
    expect(
      shouldWorkerDockConsumeEnter({
        editorText: '/exit',
        selectedWorkerId: 'agent-6',
        dockFocused: true,
      }),
    ).toBe(false);
  });

  it('lets editor submit when the dock has no selection', () => {
    expect(
      shouldWorkerDockConsumeEnter({
        editorText: '',
        selectedWorkerId: undefined,
        dockFocused: true,
      }),
    ).toBe(false);
  });

  it('opens a selected worker only on an empty prompt', () => {
    expect(
      shouldWorkerDockConsumeEnter({
        editorText: '   ',
        selectedWorkerId: 'agent-6',
        dockFocused: true,
      }),
    ).toBe(true);
  });

  it('does not steal Enter from an empty editor with a remembered dock selection', () => {
    expect(shouldWorkerDockConsumeEnter({
      editorText: '',
      selectedWorkerId: 'agent-6',
      dockFocused: false,
    })).toBe(false);
  });
});

describe('shouldWorkerDockConsumeArrow', () => {
  it('leaves ↑/↓ with the editor when the dock is not focused', () => {
    expect(shouldWorkerDockConsumeArrow({ selectedWorkerId: undefined, dockFocused: false })).toBe(false);
    expect(shouldWorkerDockConsumeArrow({ selectedWorkerId: 'w-1', dockFocused: false })).toBe(false);
  });

  it('lets an explicitly focused dock consume ↑/↓', () => {
    expect(shouldWorkerDockConsumeArrow({ selectedWorkerId: 'w-1', dockFocused: true })).toBe(true);
  });
});

describe('mission control bottom band', () => {
  it('activates with content in auto mode on any width', () => {
    const state = createState(200, 80);
    expect(workerDockBandActive(state)).toBe(false);
    state.workerDockPanel.setView(busyView());
    expect(workerDockBandActive(state)).toBe(true);
    const narrow = createState(80, 24);
    narrow.workerDockPanel.setView(busyView());
    expect(workerDockBandActive(narrow)).toBe(true);
  });

  it('pinned mode shows the band even when idle; hidden disables everything', () => {
    const state = createState(200, 80);
    state.appState.appearance = {
      ...state.appState.appearance,
      workerDock: 'pinned',
    } as AppState['appearance'];
    state.workerDockPanel.setPinned(true);
    expect(workerDockBandActive(state)).toBe(true);

    state.appState.appearance = {
      ...state.appState.appearance,
      workerDock: 'hidden',
    } as AppState['appearance'];
    state.workerDockPanel.setView(busyView());
    expect(workerDockBandActive(state)).toBe(false);
  });

  it('paints Worker Dock in the stage stack, never as a side dock', () => {
    const width = 200;
    const height = 80;
    const state = createState(width, height);
    state.workerDockPanel.setView(busyView());

    const regions = buildTUIStateNativeFrameRegions(state, width, height);
    expect(regions.some((region) => region.id === 'mission-dock')).toBe(false);
    const mission = regions.find((region) => region.id === 'workers');
    expect(mission).toBeDefined();
    expect(mission!.rect.width).toBeGreaterThan(40);
    // Band sits above the editor inside the stage column.
    const editor = regions.find((region) => region.id === 'editor');
    expect(editor).toBeDefined();
    expect(mission!.rect.y + mission!.rect.height).toBeLessThanOrEqual(editor!.rect.y);
    expect(mission!.rect.x).toBe(editor!.rect.x);
  });

  it('keeps the band off while hidden or empty', () => {
    const state = createState(200, 80);
    expect(state.workerDockContainer.render(100)).toEqual([]);
    const regions = buildTUIStateNativeFrameRegions(state, 200, 80);
    expect(regions.some((region) => region.id === 'workers')).toBe(false);
    expect(regions.some((region) => region.id === 'mission-dock')).toBe(false);
  });

  it('renders the shared panel at stage width when active', () => {
    const state = createState(120, 40);
    state.workerDockPanel.setView(busyView());
    const band = state.workerDockContainer.render(100);
    expect(band.length).toBeGreaterThan(0);
    expect(band.join('\n')).toContain('Worker Dock');
  });
});

describe('worker dock focus routing', () => {
  it.each([false, true])('repaints outside presses only when focus changes (visible=%s)', (visible) => {
    const state = createState(120, 40);
    if (visible) state.workerDockPanel.setView(busyView());
    expect(getTUIStateNativeWorkerDockRect(state) !== undefined).toBe(visible);
    const invalidateFrame = vi.spyOn(state.renderer, 'invalidateFrame');
    const press: NativeInputEvent = {
      type: 'mouse', action: 'press', button: 'left', x: -1, y: -1, raw: '',
      ctrl: false, alt: false, shift: false,
    };
    state.workerDockPanel.focused = true;
    expect(handleWorkerDockMouse({ state }, press)).toBe(false);
    expect(state.workerDockPanel.focused).toBe(false);
    expect(invalidateFrame).toHaveBeenCalledExactlyOnceWith('content');
    handleWorkerDockMouse({ state }, press);
    handleWorkerDockMouse({ state }, { ...press, action: 'release' });
    expect(invalidateFrame).toHaveBeenCalledTimes(1);
  });

  it('retains dock focus across handled navigation presses and their releases', () => {
    const state = createState(120, 40);
    const view = busyView();
    state.workerDockPanel.setView({
      ...view,
      snapshot: {
        ...view.snapshot,
        workers: [
          view.snapshot.workers[0]!,
          { ...view.snapshot.workers[0]!, id: 'sa-2', name: 'explore-2' },
        ],
      },
    });
    const router = createTUIStateNativeInputRouter(state, {
      requestRender: false,
      handlePreEditorInput: (event) => {
        if (event.type !== 'key' || event.eventType === 'release' ||
            event.key !== 'down' || !state.workerDockPanel.focused) return false;
        return state.workerDockPanel.handleSelectionKey('down').handled;
      },
    });
    state.workerDockPanel.selectWorker('sa-1');
    state.workerDockPanel.focused = true;
    const press: NativeInputEvent = {
      type: 'key', key: 'down', eventType: 'press', raw: '\u001B[B',
      ctrl: false, alt: false, shift: false,
    };
    expect(router.dispatch(press).handled).toBe(true);
    expect(state.workerDockPanel.selectedWorker).toBe('sa-2');
    router.dispatch({ ...press, eventType: 'release' });
    expect(state.workerDockPanel.focused).toBe(true);
    expect(router.dispatch(press).handled).toBe(true);
    expect(state.editor.getText()).toBe('');
    router.dispose();
  });

  it('requests a focus-only editor repaint once, not on unchanged focus', () => {
    const state = createState(120, 40);
    const router = createTUIStateNativeInputRouter(state);
    const requestRender = vi.spyOn(state.renderer, 'requestRender');
    state.workerDockPanel.focused = true;
    router.focusEditor();
    expect(state.workerDockPanel.focused).toBe(false);
    expect(requestRender).toHaveBeenCalledExactlyOnceWith('input');
    router.focusEditor();
    expect(requestRender).toHaveBeenCalledTimes(1);
    router.dispose();
  });
});
