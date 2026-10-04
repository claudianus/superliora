/**
 * Pointer hit-tests read the painted frame — they never re-plan the stage or
 * re-render the transcript. A trackpad fling delivers hundreds of wheel events
 * a second and several handlers hit-test each one; when every lookup rendered
 * the transcript the main thread pinned at 100% and the TUI froze for seconds.
 */
import { EventEmitter } from 'node:events';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTUIStateNativeRenderer } from '#/tui/features/native-layout/native-layout-frame';
import { createTUIStateNativeInputRouter } from '#/tui/features/native-layout/native-input-router';
import {
  getTUIStateNativeActivityRect,
  getTUIStateNativeTodoRect,
  getTUIStateNativeTranscriptRect,
  getTUIStateNativeWorkerDockRect,
  resolveTranscriptHitTestContext,
} from '#/tui/features/transcript/transcript-hit-test';
import { createTUIState } from '#/tui/liora-tui';
import {
  Text,
  type NativeInputMouseEvent,
  type NativeRenderLoopScheduler,
  type NativeRenderTimer,
} from '#/tui/renderer';
import type { AppState } from '#/tui/types';

const WIDTH = 100;
const HEIGHT = 30;

function initialAppState(): AppState {
  return {
    model: 'test-model',
    workDir: '/tmp/example-test',
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

class FakeOutput extends EventEmitter {
  constructor(
    public columns: number,
    public rows: number,
  ) {
    super();
  }
  write(): void {}
}

class FakeScheduler implements NativeRenderLoopScheduler {
  private time = 0;
  private timers: Array<{ dueAt: number; callback: () => void; cleared: boolean; unref(): void }> = [];
  now(): number {
    return this.time;
  }
  setTimeout(callback: () => void, delayMs: number): NativeRenderTimer {
    const timer = { dueAt: this.time + Math.max(0, delayMs), callback, cleared: false, unref: () => {} };
    this.timers.push(timer);
    return timer;
  }
  clearTimeout(timer: NativeRenderTimer): void {
    (timer as { cleared: boolean }).cleared = true;
  }
  advance(ms: number): void {
    const target = this.time + ms;
    for (;;) {
      const next = this.timers
        .filter((timer) => !timer.cleared && timer.dueAt <= target)
        .toSorted((a, b) => a.dueAt - b.dueAt)[0];
      if (next === undefined) break;
      this.time = next.dueAt;
      next.cleared = true;
      next.callback();
    }
    this.time = target;
  }
}

function wheel(x: number, y: number, button: 'wheel-up' | 'wheel-down'): NativeInputMouseEvent {
  return { type: 'mouse', raw: '', ctrl: false, alt: false, shift: false, action: 'wheel', button, x, y };
}

describe('painted-frame hit-testing', () => {
  let previousTransportStability: string | undefined;

  beforeEach(() => {
    previousTransportStability = process.env['TUI_RENDERER_TRANSPORT_STABILITY'];
    process.env['TUI_RENDERER_TRANSPORT_STABILITY'] = 'synchronized';
  });

  afterEach(() => {
    if (previousTransportStability === undefined) {
      delete process.env['TUI_RENDERER_TRANSPORT_STABILITY'];
    } else {
      process.env['TUI_RENDERER_TRANSPORT_STABILITY'] = previousTransportStability;
    }
    vi.restoreAllMocks();
  });

  function paintedState() {
    const state = createTUIState({
      startup: { continueLast: false, yolo: false, auto: false },
      initialAppState: initialAppState(),
    });
    Object.defineProperty(state.terminal, 'rows', { configurable: true, get: () => HEIGHT });
    Object.defineProperty(state.terminal, 'columns', { configurable: true, get: () => WIDTH });
    state.transcriptContainer.clear();
    for (let i = 0; i < 200; i++) {
      state.transcriptContainer.addChild(new Text(`message ${String(i)}\nsecond line ${String(i)}`));
    }
    const scheduler = new FakeScheduler();
    const renderer = createTUIStateNativeRenderer(state, {
      output: new FakeOutput(WIDTH, HEIGHT),
      scheduler,
      renderOnStart: true,
      synchronized: true,
    });
    renderer.start();
    scheduler.advance(0);
    return { state, scheduler, renderer };
  }

  it('publishes the painted geometry and answers every rect lookup from it', () => {
    const { state, renderer } = paintedState();
    const painted = state.paintedFrameGeometry;
    expect(painted).toBeDefined();
    expect(painted!.columns).toBe(WIDTH);
    expect(painted!.regions.transcript).toBeDefined();
    expect(painted!.transcriptLines.length).toBe(painted!.transcriptVisibleRows);

    const renderWindow = vi.spyOn(state.transcriptContainer, 'renderWithVisibleRegionLines');
    const render = vi.spyOn(state.transcriptContainer, 'render');

    expect(getTUIStateNativeTranscriptRect(state)).toEqual(painted!.regions.transcript);
    expect(getTUIStateNativeTodoRect(state)).toEqual(painted!.regions.todo);
    expect(getTUIStateNativeWorkerDockRect(state)).toEqual(painted!.regions.workers);
    expect(getTUIStateNativeActivityRect(state)).toEqual(painted!.regions.activity);
    const context = resolveTranscriptHitTestContext(state);
    expect(context?.visibleLines).toBe(painted!.transcriptLines);
    expect(context?.viewportStart).toBe(painted!.transcriptViewportStart);

    expect(renderWindow).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
    renderer.stop();
  });

  it('routes a wheel storm without rendering the transcript per event', () => {
    const { state, scheduler, renderer } = paintedState();
    const rect = state.paintedFrameGeometry!.regions.transcript!;
    let scrolls = 0;
    const router = createTUIStateNativeInputRouter(state, {
      requestRender: false,
      // Production wiring offers every wheel to the todo board and worker dock
      // first; both hit-test before the transcript handler sees the event.
      scrollTodoPanel: (event) =>
        event.type === 'mouse' && getTUIStateNativeTodoRect(state) !== undefined && false,
      scrollMissionPanel: (event) =>
        event.type === 'mouse' && getTUIStateNativeWorkerDockRect(state) !== undefined && false,
      scrollTranscriptViewport: (action) => {
        scrolls += 1;
        return state.transcriptViewport.scroll(action);
      },
    });
    const renderWindow = vi.spyOn(state.transcriptContainer, 'renderWithVisibleRegionLines');

    const x = rect.x + Math.floor(rect.width / 2);
    const y = rect.y + 1;
    for (let i = 0; i < 500; i++) {
      router.dispatch(wheel(x, y, i % 7 === 0 ? 'wheel-down' : 'wheel-up'));
    }

    expect(scrolls).toBe(500);
    expect(renderWindow).not.toHaveBeenCalled();

    // The next frame paints once and republishes the moved window.
    renderer.requestRender('transcript-scroll');
    scheduler.advance(20);
    expect(renderWindow).toHaveBeenCalledTimes(1);
    expect(state.paintedFrameGeometry!.transcriptViewportStart).toBe(state.transcriptViewport.start());
    renderer.stop();
  });

  it('falls back to the stage plan before the first frame without rendering the transcript', () => {
    const state = createTUIState({
      startup: { continueLast: false, yolo: false, auto: false },
      initialAppState: initialAppState(),
    });
    state.transcriptContainer.addChild(new Text('only line'));
    const renderWindow = vi.spyOn(state.transcriptContainer, 'renderWithVisibleRegionLines');

    expect(state.paintedFrameGeometry).toBeUndefined();
    expect(getTUIStateNativeTranscriptRect(state, 80, 24)).toBeDefined();
    getTUIStateNativeTodoRect(state, 80, 24);
    getTUIStateNativeWorkerDockRect(state, 80, 24);
    expect(renderWindow).not.toHaveBeenCalled();
  });
});
