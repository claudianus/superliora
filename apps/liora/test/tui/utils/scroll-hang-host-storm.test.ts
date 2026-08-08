/**
 * Host-path scroll storm: native render callback + deferred format + settle.
 * Does NOT force withTranscriptCheapPaintMode — that is the production path.
 */
import { EventEmitter } from 'node:events';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TruncatedOutputComponent } from '#/tui/components/messages/tool-renderers/truncated';
import { ToolOutputViewportComponent } from '#/tui/components/messages/tool-output-viewport';
import { createTUIStateNativeRenderer } from '#/tui/features/native-layout/native-layout-frame';
import { createTUIState } from '#/tui/liora-tui';
import {
  type Component,
  type NativeRenderLoopScheduler,
  type NativeRenderTimer,
  TRANSCRIPT_SCROLL_MATERIALIZE_BUDGET,
  resetTranscriptMeasureModeForTest,
} from '#/tui/renderer';
import type { AppState } from '#/tui/types';
import {
  lastScrollHangDumpForTest,
  lastScrollHangSample,
  resetScrollHangProbeForTest,
  scrollHangRingForTest,
  setScrollHangProbeSinkForTest,
  setScrollHangTraceEnabledForTest,
} from '#/tui/utils/render/scroll-hang-probe';
import {
  clearTranscriptScrollSettleRefreshForTest,
  isTranscriptScrollSettleArmed,
  scheduleTranscriptScrollSettleRefresh,
} from '#/tui/utils/render/scroll-settle-refresh';
import {
  resetTranscriptScrollActivityForTest,
  withTranscriptPaintMode,
} from '#/tui/utils/render/transcript-paint-mode';
import {
  clearDeferredTranscriptFormatQueueForTest,
  deferredTranscriptFormatQueueSize,
  isDeferredFormatHeldForScroll,
  scheduleDeferredTranscriptFormat,
  setDeferredFormatHoldPredicateForTest,
  setDeferredFormatSchedulerForTest,
} from '#/tui/utils/transcript/deferred-format-queue';
import { createToolOutputViewportState } from '#/tui/utils/tool/tool-output-viewport';

const SCROLL_PAINT_CALLS_PER_CARD = 3;
const SCROLL_FRAME_PAINT_CEILING =
  TRANSCRIPT_SCROLL_MATERIALIZE_BUDGET * SCROLL_PAINT_CALLS_PER_CARD;
/** Match SCROLL_HANG_CALLBACK_MS — literal avoids import TDZ flakes. */
const HANG_CALLBACK_MS = 80;

function fakeInitialAppState(): AppState {
  return {
    model: 'test-model',
    workDir: '/tmp/scroll-hang-host-storm',
    additionalDirs: [],
    sessionId: 'sess-scroll-hang',
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

function hugeOutput(lines: number): string {
  return Array.from({ length: lines }, (_, i) => `ROW-${String(i).padStart(4, '0')}`).join('\n');
}

class FakeNativeOutput extends EventEmitter {
  writes: string[] = [];
  constructor(
    public columns: number,
    public rows: number,
  ) {
    super();
  }
  write(chunk: string): void {
    this.writes.push(chunk);
  }
}

class FakeRenderLoopTimer implements NativeRenderTimer {
  cleared = false;
  unrefCalls = 0;
  constructor(
    readonly dueAt: number,
    readonly callback: () => void,
  ) {}
  unref(): void {
    this.unrefCalls += 1;
  }
}

class FakeRenderLoopScheduler implements NativeRenderLoopScheduler {
  private time = 0;
  private timers: FakeRenderLoopTimer[] = [];
  now(): number {
    return this.time;
  }
  setTimeout(callback: () => void, delayMs: number): FakeRenderLoopTimer {
    const timer = new FakeRenderLoopTimer(this.time + Math.max(0, delayMs), callback);
    this.timers.push(timer);
    return timer;
  }
  clearTimeout(timer: NativeRenderTimer): void {
    (timer as FakeRenderLoopTimer).cleared = true;
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

describe('scroll hang host storm', () => {
  beforeEach(() => {
    resetScrollHangProbeForTest();
    resetTranscriptScrollActivityForTest();
    resetTranscriptMeasureModeForTest();
    clearDeferredTranscriptFormatQueueForTest();
    clearTranscriptScrollSettleRefreshForTest();
    setDeferredFormatHoldPredicateForTest(undefined);
    setDeferredFormatSchedulerForTest(undefined);
    setScrollHangTraceEnabledForTest(undefined);
    setScrollHangProbeSinkForTest(undefined);
  });

  afterEach(() => {
    resetScrollHangProbeForTest();
    resetTranscriptScrollActivityForTest();
    resetTranscriptMeasureModeForTest();
    clearDeferredTranscriptFormatQueueForTest();
    clearTranscriptScrollSettleRefreshForTest();
    setDeferredFormatHoldPredicateForTest(undefined);
    setDeferredFormatSchedulerForTest(undefined);
    setScrollHangTraceEnabledForTest(undefined);
    setScrollHangProbeSinkForTest(undefined);
  });

  it('real wasRecent paint-clock hold blocks deferred drain mid-scroll', () => {
    const ran: number[] = [];
    const scheduled: Array<() => void> = [];
    setDeferredFormatHoldPredicateForTest(undefined);
    setDeferredFormatSchedulerForTest((run) => {
      scheduled.push(run);
    });

    withTranscriptPaintMode({ suppressLiveToolTicks: true }, () => {
      expect(isDeferredFormatHeldForScroll()).toBe(true);
    });
    expect(isDeferredFormatHeldForScroll()).toBe(true);

    scheduleDeferredTranscriptFormat(() => {
      ran.push(1);
    });
    expect(scheduled.length).toBe(1);
    scheduled[0]!();
    expect(ran).toEqual([]);
    expect(deferredTranscriptFormatQueueSize()).toBe(1);
  });

  it('alternating up/down through native callback keeps scroll hold and hang budgets', () => {
    const width = 80;
    const height = 28;
    const state = createTUIState({
      initialAppState: fakeInitialAppState(),
      startup: {
        continueLast: false,
        yolo: false,
        auto: false,
        plan: false,
      },
    });
    Object.defineProperty(state.terminal, 'rows', { configurable: true, get: () => height });
    Object.defineProperty(state.terminal, 'columns', { configurable: true, get: () => width });

    for (let t = 0; t < 20; t++) {
      let toolState = createToolOutputViewportState();
      const child = new TruncatedOutputComponent(hugeOutput(800), {
        expanded: true,
        isError: false,
        maxLines: 5,
      });
      state.transcriptContainer.addChild(
        new ToolOutputViewportComponent({
          child,
          getState: () => toolState,
          setState: (next) => {
            toolState = next;
          },
          expanded: true,
        }),
      );
    }
    state.editorContainer.addChild(fixedLines(['ed']));
    state.footerContainer.addChild(fixedLines(['ft']));

    const deferredRan: number[] = [];
    const drainTurns: Array<() => void> = [];
    setDeferredFormatHoldPredicateForTest(undefined);
    setDeferredFormatSchedulerForTest((run) => {
      drainTurns.push(run);
    });

    const dumps: Array<{ reason: string }> = [];
    setScrollHangProbeSinkForTest((dump) => {
      dumps.push(dump);
    });
    setScrollHangTraceEnabledForTest(false);

    const output = new FakeNativeOutput(width, height);
    const scheduler = new FakeRenderLoopScheduler();
    const renderer = createTUIStateNativeRenderer(state, {
      output,
      scheduler,
      renderOnStart: true,
      synchronized: true,
    });
    renderer.start();
    scheduler.advance(0);
    state.transcriptContainer.contentRowCount(width);

    // Arm scroll hold before enqueueing format jobs.
    state.transcriptViewport.scroll('line-up', 12);
    scheduleTranscriptScrollSettleRefresh(state);
    renderer.requestRender('transcript-scroll');
    scheduler.advance(20);
    expect(isDeferredFormatHeldForScroll()).toBe(true);

    // Drop any formats cards already enqueued during the arming scroll paint.
    clearDeferredTranscriptFormatQueueForTest();
    drainTurns.length = 0;
    for (let i = 0; i < 8; i++) {
      scheduleDeferredTranscriptFormat(() => {
        deferredRan.push(i);
      });
    }
    const queuedBefore = deferredTranscriptFormatQueueSize();
    expect(queuedBefore).toBe(8);

    for (let i = 0; i < 40; i++) {
      const dir = i % 2 === 0 ? 'line-up' : 'line-down';
      state.transcriptViewport.scroll(dir, 12);
      scheduleTranscriptScrollSettleRefresh(state);
      renderer.requestRender('transcript-scroll');
      scheduler.advance(20);

      expect(isDeferredFormatHeldForScroll()).toBe(true);
      // One drain batch only — hold re-queues via drainImpl; do not spin.
      const pending = drainTurns.splice(0, drainTurns.length);
      for (const turn of pending) turn();

      const sample = lastScrollHangSample();
      expect(sample).toBeDefined();
      expect(sample!.causes).toContain('transcript-scroll');
      expect(sample!.childPaints).toBeLessThanOrEqual(SCROLL_FRAME_PAINT_CEILING);
      expect(typeof sample!.renderCbMs).toBe('number');
      expect(sample!.renderCbMs).toBeLessThan(HANG_CALLBACK_MS);
      expect(sample!.scrollHold).toBe(true);
      expect(deferredTranscriptFormatQueueSize()).toBeGreaterThanOrEqual(queuedBefore);
      expect(deferredRan).toEqual([]);
      expect(state.transcriptContainer.lastFrameChildPaintCalls).toBeLessThanOrEqual(
        SCROLL_FRAME_PAINT_CEILING,
      );
    }

    expect(isTranscriptScrollSettleArmed()).toBe(true);
    expect(scrollHangRingForTest().length).toBeGreaterThan(10);
    expect(dumps.filter((d) => d.reason === 'callback-budget')).toHaveLength(0);
    expect(lastScrollHangDumpForTest()).toBeUndefined();

    renderer.stop();
  });
});
