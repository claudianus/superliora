import {
  STREAMING_UI_FLUSH_BURST_DELTAS,
  STREAMING_UI_FLUSH_MAX_MS,
  STREAMING_UI_FLUSH_MS,
} from '../../constant/streaming';
import { nextStreamingFlushDelay } from '../../utils/streaming/streaming-flush-schedule';

export interface StreamingFlushState {
  flushTimer: ReturnType<typeof setTimeout> | undefined;
  lastFlushAt: number | undefined;
  /** Scheduled fire time (ms epoch) of the pending flushTimer, if any. */
  scheduledFlushAt: number | undefined;
  /** Dirty marks since the last flush; drives adaptive burst coalescing. */
  dirtyMarksSinceFlush: number;
  pendingAssistantFlush: boolean;
  pendingThinkingFlush: boolean;
  pendingToolCallFlushIds: Set<string>;
}

export function createStreamingFlushState(): StreamingFlushState {
  return {
    flushTimer: undefined,
    lastFlushAt: undefined,
    scheduledFlushAt: undefined,
    dirtyMarksSinceFlush: 0,
    pendingAssistantFlush: false,
    pendingThinkingFlush: false,
    pendingToolCallFlushIds: new Set<string>(),
  };
}

export function hasPendingFlush(state: StreamingFlushState): boolean {
  return (
    state.pendingAssistantFlush ||
    state.pendingThinkingFlush ||
    state.pendingToolCallFlushIds.size > 0
  );
}

export function clearFlushTimer(state: StreamingFlushState): void {
  if (state.flushTimer === undefined) return;
  clearTimeout(state.flushTimer);
  state.flushTimer = undefined;
  state.scheduledFlushAt = undefined;
}

export function clearFlushTimerIfIdle(state: StreamingFlushState): void {
  if (hasPendingFlush(state)) return;
  clearFlushTimer(state);
  state.dirtyMarksSinceFlush = 0;
}

export function discardPendingFlush(state: StreamingFlushState): void {
  clearFlushTimer(state);
  state.pendingAssistantFlush = false;
  state.pendingThinkingFlush = false;
  state.pendingToolCallFlushIds.clear();
  state.dirtyMarksSinceFlush = 0;
}

export interface StreamingFlushRunHandlers {
  onThinkingFlush(): void;
  onAssistantFlush(): void;
  onToolCallFlush(id: string): void;
}

export function runPendingFlush(
  state: StreamingFlushState,
  handlers: StreamingFlushRunHandlers,
): void {
  if (!hasPendingFlush(state)) return;
  state.lastFlushAt = Date.now();
  const shouldFlushThinking = state.pendingThinkingFlush;
  const shouldFlushAssistant = state.pendingAssistantFlush;
  const toolCallIds = [...state.pendingToolCallFlushIds];
  state.pendingThinkingFlush = false;
  state.pendingAssistantFlush = false;
  state.pendingToolCallFlushIds.clear();
  state.dirtyMarksSinceFlush = 0;

  if (shouldFlushThinking) handlers.onThinkingFlush();
  if (shouldFlushAssistant) handlers.onAssistantFlush();
  for (const id of toolCallIds) handlers.onToolCallFlush(id);
}

export function scheduleFlush(
  state: StreamingFlushState,
  runFlush: () => void,
): void {
  if (!hasPendingFlush(state)) return;
  const now = Date.now();
  const delay = nextStreamingFlushDelay({
    now,
    lastFlushAt: state.lastFlushAt,
    pendingDeltaCount: state.dirtyMarksSinceFlush,
    baseMs: STREAMING_UI_FLUSH_MS,
    maxMs: STREAMING_UI_FLUSH_MAX_MS,
    burstThreshold: STREAMING_UI_FLUSH_BURST_DELTAS,
  });
  const fireAt = now + delay;
  if (state.flushTimer !== undefined) {
    // A burst may stretch the window later; never pull a scheduled flush
    // earlier than the fire time we already promised.
    if (fireAt <= (state.scheduledFlushAt ?? Number.POSITIVE_INFINITY)) return;
    clearFlushTimer(state);
  }
  state.scheduledFlushAt = fireAt;
  state.flushTimer = setTimeout(() => {
    state.flushTimer = undefined;
    state.scheduledFlushAt = undefined;
    runFlush();
  }, delay);
}

export function flushNow(
  state: StreamingFlushState,
  runFlush: () => void,
): void {
  clearFlushTimer(state);
  runFlush();
}
