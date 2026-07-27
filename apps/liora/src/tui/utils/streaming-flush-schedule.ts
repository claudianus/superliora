/**
 * Pure scheduling helper for the streaming UI flush throttle.
 *
 * The controller coalesces high-frequency token/argument deltas behind a
 * single setTimeout. The delay is adaptive but bounded:
 *
 * - Leading edge paints immediately: before the first flush, or once the
 *   stream has been idle for at least `baseMs`, the delay is 0.
 * - Inside a flush window the delay is the time left until `baseMs` has
 *   elapsed since the last flush.
 * - When the pending delta volume within the current cycle reaches
 *   `burstThreshold`, the window stretches to `maxMs` so sustained bursts
 *   coalesce more repaints. The stretch never exceeds `maxMs` and the next
 *   cycle drops back to `baseMs` (the counter resets on every flush).
 *
 * The controller may reschedule a pending timer only to a later fire time
 * (base -> max stretch); it never pulls a scheduled flush earlier.
 */
export interface StreamingFlushScheduleInput {
  /** Current timestamp in ms. */
  now: number;
  /** When the last flush ran; undefined before the first flush. */
  lastFlushAt: number | undefined;
  /** Dirty marks accumulated since the last flush (pending delta volume). */
  pendingDeltaCount: number;
  /** Floor/default interval in ms. */
  baseMs: number;
  /** Interval ceiling during bursts in ms. */
  maxMs: number;
  /** pendingDeltaCount at or above which the interval stretches to maxMs. */
  burstThreshold: number;
}

export function nextStreamingFlushDelay(input: StreamingFlushScheduleInput): number {
  const { now, lastFlushAt, pendingDeltaCount, baseMs, maxMs, burstThreshold } = input;
  // Leading edge: the first delta of a stream paints immediately.
  if (lastFlushAt === undefined) return 0;
  // Tolerate clock skew; only the distance from the last flush matters.
  const elapsed = Math.max(0, now - lastFlushAt);
  // Idle long enough that a flush is already due — paint immediately.
  if (elapsed >= baseMs) return 0;
  const target = pendingDeltaCount >= burstThreshold ? maxMs : baseMs;
  return Math.max(0, target - elapsed);
}
