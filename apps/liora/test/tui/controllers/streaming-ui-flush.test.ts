import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import {
  STREAMING_UI_FLUSH_BURST_DELTAS,
  STREAMING_UI_FLUSH_MAX_MS,
  STREAMING_UI_FLUSH_MS,
} from '#/tui/constant/streaming';
import { StreamingUIController, type StreamingUIHost } from '#/tui/controllers/streaming-ui';
import { createTUIState } from '#/tui/liora-tui';
import type { AppState, TranscriptEntry } from '#/tui/types';
import { createMotionBeatController } from '#/tui/utils/motion-beats';
import {
  nextStreamingFlushDelay,
  type StreamingFlushScheduleInput,
} from '#/tui/utils/streaming-flush-schedule';

function fakeAppState(overrides: Partial<AppState> = {}): AppState {
  return {
    theme: 'dark',
    model: 'example-model',
    planMode: false,
    ultraworkMode: false,
    streamingPhase: 'composing',
    isCompacting: false,
    isBackgroundCompacting: false,
    inputMode: 'prompt',
    appearance: { ...DEFAULT_APPEARANCE_PREFERENCES },
    ...overrides,
  } as AppState;
}

function createHost() {
  const state = createTUIState({
    initialAppState: fakeAppState(),
    startup: { continueLast: false, yolo: false, auto: false, plan: false },
  });
  const entries: TranscriptEntry[] = [];
  const host: StreamingUIHost = {
    state,
    session: undefined,
    motionBeats: createMotionBeatController(),
    setAppState(patch) {
      state.appState = { ...state.appState, ...patch };
    },
    patchLivePane() {},
    resetLivePane() {},
    updateActivityPane() {},
    updateQueueDisplay() {},
    requireSession() {
      throw new Error('no session in unit test');
    },
    deferUserMessages: false,
    shiftQueuedMessage() {
      return undefined;
    },
    pushTranscriptEntry(entry) {
      entries.push(entry);
      state.transcriptEntries.push(entry);
    },
    mergeCurrentTurnSteps() {},
  };
  return { host, state, entries };
}

function scheduleInput(overrides: Partial<StreamingFlushScheduleInput> = {}): StreamingFlushScheduleInput {
  return {
    now: 1000,
    lastFlushAt: 980,
    pendingDeltaCount: 1,
    baseMs: STREAMING_UI_FLUSH_MS,
    maxMs: STREAMING_UI_FLUSH_MAX_MS,
    burstThreshold: STREAMING_UI_FLUSH_BURST_DELTAS,
    ...overrides,
  };
}

describe('nextStreamingFlushDelay (adaptive flush helper)', () => {
  it('paints the leading edge immediately before any flush', () => {
    expect(nextStreamingFlushDelay(scheduleInput({ lastFlushAt: undefined }))).toBe(0);
  });

  it('paints immediately once idle for at least the base interval', () => {
    expect(
      nextStreamingFlushDelay(scheduleInput({ now: 1000, lastFlushAt: 1000 - STREAMING_UI_FLUSH_MS })),
    ).toBe(0);
    expect(
      nextStreamingFlushDelay(scheduleInput({ now: 1000, lastFlushAt: 900 })),
    ).toBe(0);
  });

  it('returns the remaining base window under light traffic', () => {
    const delay = nextStreamingFlushDelay(
      scheduleInput({ now: 1010, lastFlushAt: 1000, pendingDeltaCount: 2 }),
    );
    expect(delay).toBe(STREAMING_UI_FLUSH_MS - 10);
  });

  it('stretches toward the ceiling once pending volume reaches the burst threshold', () => {
    const atThreshold = nextStreamingFlushDelay(
      scheduleInput({
        now: 1010,
        lastFlushAt: 1000,
        pendingDeltaCount: STREAMING_UI_FLUSH_BURST_DELTAS,
      }),
    );
    expect(atThreshold).toBe(STREAMING_UI_FLUSH_MAX_MS - 10);

    const aboveThreshold = nextStreamingFlushDelay(
      scheduleInput({ now: 1010, lastFlushAt: 1000, pendingDeltaCount: 64 }),
    );
    expect(aboveThreshold).toBe(STREAMING_UI_FLUSH_MAX_MS - 10);
  });

  it('prefers immediacy over stretch once the base window already elapsed', () => {
    const delay = nextStreamingFlushDelay(
      scheduleInput({
        now: 1060,
        lastFlushAt: 1000,
        pendingDeltaCount: STREAMING_UI_FLUSH_BURST_DELTAS * 3,
      }),
    );
    expect(delay).toBe(0);
  });

  it('treats clock skew as zero elapsed instead of a negative delay', () => {
    const delay = nextStreamingFlushDelay(
      scheduleInput({ now: 990, lastFlushAt: 1000, pendingDeltaCount: 1 }),
    );
    expect(delay).toBe(STREAMING_UI_FLUSH_MS);
  });
});

describe('StreamingUIController adaptive flush throttle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('paints the first delta of a stream immediately (leading edge)', () => {
    const { host } = createHost();
    const ui = new StreamingUIController(host);

    ui.appendAssistantDelta('Hello');
    ui.scheduleFlush();
    expect(ui.hasPending()).toBe(true);

    // Must not wait out the throttle window: a single tick paints it.
    vi.advanceTimersByTime(1);
    expect(ui.hasPending()).toBe(false);
  });

  it('coalesces follow-up deltas inside the base window', () => {
    const { host } = createHost();
    const ui = new StreamingUIController(host);

    ui.appendAssistantDelta('a');
    ui.scheduleFlush();
    vi.advanceTimersByTime(1); // leading flush
    expect(ui.hasPending()).toBe(false);

    ui.appendAssistantDelta('b');
    ui.scheduleFlush();
    vi.advanceTimersByTime(STREAMING_UI_FLUSH_MS - 2);
    expect(ui.hasPending()).toBe(true);

    vi.advanceTimersByTime(4);
    expect(ui.hasPending()).toBe(false);
  });

  it('flushes at semantic boundaries without waiting the throttle window', () => {
    const { host } = createHost();
    const ui = new StreamingUIController(host);

    // Establish an in-flight throttle window.
    ui.appendAssistantDelta('partial text');
    ui.scheduleFlush();
    vi.advanceTimersByTime(1);
    ui.appendAssistantDelta(' more');
    ui.scheduleFlush();
    expect(ui.hasPending()).toBe(true);

    // Boundary handlers (turn end / tool call start / tool result) call
    // flushNow(): the pending state must clear with zero timer advance.
    ui.flushNow();
    expect(ui.hasPending()).toBe(false);
  });

  it('materializes streaming tool previews at a boundary flush immediately', () => {
    const { host } = createHost();
    const ui = new StreamingUIController(host);

    ui.accumulateToolCallDelta('tc-1', 'Agent', '{"description":');
    ui.scheduleFlush();
    expect(ui.hasPending()).toBe(true);

    ui.flushNow();
    expect(ui.hasPending()).toBe(false);
    expect(ui.getActiveToolCall('tc-1')).toBeDefined();
  });

  it('finalizes thinking drafts at a boundary without timer advance', () => {
    const { host } = createHost();
    const ui = new StreamingUIController(host);

    ui.appendThinkingDelta('considering ');
    ui.scheduleFlush();
    vi.advanceTimersByTime(1);
    ui.appendThinkingDelta('the options');
    ui.scheduleFlush();
    expect(ui.hasPending()).toBe(true);

    ui.flushThinkingToTranscript('idle');
    expect(ui.hasPending()).toBe(false);
    expect(ui.hasThinkingDraft()).toBe(false);
  });

  it('stretches the window during a sustained burst, then flushes by the ceiling', () => {
    const { host } = createHost();
    const ui = new StreamingUIController(host);

    ui.appendAssistantDelta('x');
    ui.scheduleFlush();
    vi.advanceTimersByTime(1); // leading flush anchors lastFlushAt
    expect(ui.hasPending()).toBe(false);

    // Sustained high-frequency deltas across channels in one window.
    for (let i = 0; i < STREAMING_UI_FLUSH_BURST_DELTAS; i++) {
      ui.appendAssistantDelta(`d${String(i)}`);
      ui.scheduleFlush();
    }

    // Past the fixed base window the old throttle would already have flushed;
    // the adaptive window must still be coalescing.
    vi.advanceTimersByTime(STREAMING_UI_FLUSH_MS + 5);
    expect(ui.hasPending()).toBe(true);

    // ...but never beyond the bounded ceiling.
    vi.advanceTimersByTime(STREAMING_UI_FLUSH_MAX_MS);
    expect(ui.hasPending()).toBe(false);
  });

  it('recovers to immediate leading-edge painting after traffic stops', () => {
    const { host } = createHost();
    const ui = new StreamingUIController(host);

    ui.appendAssistantDelta('x');
    ui.scheduleFlush();
    vi.advanceTimersByTime(1);
    for (let i = 0; i < STREAMING_UI_FLUSH_BURST_DELTAS; i++) {
      ui.appendAssistantDelta(`d${String(i)}`);
      ui.scheduleFlush();
    }
    vi.advanceTimersByTime(STREAMING_UI_FLUSH_MAX_MS * 2); // burst flushed + idle
    expect(ui.hasPending()).toBe(false);

    ui.appendAssistantDelta('after idle');
    ui.scheduleFlush();
    vi.advanceTimersByTime(1);
    expect(ui.hasPending()).toBe(false);
  });

  it('drops back to the base window right after a boundary flush', () => {
    const { host } = createHost();
    const ui = new StreamingUIController(host);

    ui.appendAssistantDelta('x');
    ui.scheduleFlush();
    vi.advanceTimersByTime(1);
    for (let i = 0; i < STREAMING_UI_FLUSH_BURST_DELTAS; i++) {
      ui.appendAssistantDelta(`d${String(i)}`);
      ui.scheduleFlush();
    }

    // A boundary (turn end / tool result) interrupts the stretched window.
    ui.flushNow();
    expect(ui.hasPending()).toBe(false);

    // The next cycle must run at the base interval, not the stretched one.
    ui.appendAssistantDelta('y');
    ui.scheduleFlush();
    vi.advanceTimersByTime(STREAMING_UI_FLUSH_MS + 2);
    expect(ui.hasPending()).toBe(false);
  });

  it('schedules nothing when there is no pending work', () => {
    const { host } = createHost();
    const ui = new StreamingUIController(host);

    const timersBefore = vi.getTimerCount();
    ui.scheduleFlush();
    expect(ui.hasPending()).toBe(false);
    expect(vi.getTimerCount()).toBe(timersBefore);
  });
});
