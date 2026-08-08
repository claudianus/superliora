/**
 * Paint-mode flags for transcript virtual-scroll frames.
 *
 * Tool-call cards tick live animation from inside `render()` and may call
 * `rebuildBody()` + `requestRender()`. During pure scroll that is catastrophic:
 * every visible tool rebuilds its body on the scroll paint path, the frame never
 * yields, and the TUI looks permanently frozen (not mere lag).
 *
 * Scroll paint sets {@link suppressLiveToolTicks} so cards only paint cached
 * lines; ambient/content frames still run live ticks normally.
 *
 * Geometry probes (`contentRowCount` / line-count cache fills) also suppress
 * via {@link isTranscriptMeasureMode} from the renderer package — measure must
 * not re-enter rebuild/requestRender side effects that re-dirty geometry.
 *
 * {@link markTranscriptScrollActivity} lets chrome timers (footer goal / header
 * clock) skip a beat right after scroll so they do not fight wheel frames.
 */

import {
  isTranscriptMeasureMode,
  isTranscriptScrollStorm,
  TRANSCRIPT_SCROLL_STORM_GAP_MS,
  withTranscriptCheapPaintMode,
} from '#/tui/renderer';

let suppressLiveToolTicks = false;
let lastScrollActivityMs = 0;

/**
 * Match the renderer pure-scroll stamp clock (`performance.now` when available).
 * Mixing epoch `Date.now()` with relative `performance.now()` stamps made storm
 * detection always miss and left content holds on paint-mode alone.
 */
function paintClockNowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/** How long after a scroll paint chrome timers should skip refresh. */
export const TRANSCRIPT_SCROLL_TIMER_HOLD_MS = 180;
/**
 * Hold O(transcript) geometry/paint wipes after pure-scroll. Longer than the
 * storm gap so multi-k rebuilds cannot re-enter while the wheel is hot.
 */
export const TRANSCRIPT_SCROLL_HEAVY_HOLD_MS = Math.max(
  TRANSCRIPT_SCROLL_TIMER_HOLD_MS,
  TRANSCRIPT_SCROLL_STORM_GAP_MS * 4,
);
/**
 * Hold light content invalidation only while the wheel is still storming.
 * A full 200ms content hold after every scroll made streaming/type-on feel
 * sticky even when the user only flicked the transcript once.
 */
export const TRANSCRIPT_SCROLL_CONTENT_HOLD_MS = TRANSCRIPT_SCROLL_STORM_GAP_MS * 2;

export interface TranscriptPaintMode {
  readonly suppressLiveToolTicks?: boolean;
}

export function withTranscriptPaintMode<T>(mode: TranscriptPaintMode, run: () => T): T {
  const previous = suppressLiveToolTicks;
  suppressLiveToolTicks = mode.suppressLiveToolTicks === true;
  if (suppressLiveToolTicks) {
    lastScrollActivityMs = paintClockNowMs();
  }
  try {
    // Pure-scroll also enters renderer cheap-paint so highlight/pretty skip
    // cache misses without poisoning Markdown / width paint caches.
    if (suppressLiveToolTicks) {
      return withTranscriptCheapPaintMode(run);
    }
    return run();
  } finally {
    suppressLiveToolTicks = previous;
  }
}

export function areLiveToolTicksSuppressed(): boolean {
  return suppressLiveToolTicks || isTranscriptMeasureMode();
}

/** True when a transcript-scroll paint ran recently (chrome timer holdoff). */
export function wasRecentTranscriptScroll(
  nowMs: number | undefined = undefined,
  holdMs: number = TRANSCRIPT_SCROLL_TIMER_HOLD_MS,
): boolean {
  // Optional nowMs so callers can omit the clock without passing Date.now()
  // (epoch) against performance.now() storm stamps.
  const now = nowMs ?? paintClockNowMs();
  if (isTranscriptScrollStorm(now, holdMs)) return true;
  return now - lastScrollActivityMs < holdMs && lastScrollActivityMs > 0;
}

/**
 * True while light content invalidation must defer. Only active during a real
 * scroll storm — streaming deltas resume immediately once the wheel cools.
 */
export function shouldDeferTranscriptContentInvalidation(
  nowMs: number = paintClockNowMs(),
): boolean {
  return isTranscriptScrollStorm(nowMs, TRANSCRIPT_SCROLL_CONTENT_HOLD_MS);
}

/**
 * True while geometry/paint wipe invalidation must defer (scroll storm or
 * recent pure-scroll paint). Stronger than content defer for O(transcript)
 * work like invalidateGeometryAndPaint.
 */
export function shouldDeferTranscriptHeavyInvalidation(
  nowMs: number = paintClockNowMs(),
): boolean {
  return (
    isTranscriptScrollStorm(nowMs, TRANSCRIPT_SCROLL_HEAVY_HOLD_MS) ||
    wasRecentTranscriptScroll(nowMs, TRANSCRIPT_SCROLL_HEAVY_HOLD_MS)
  );
}

/** Test helper. */
export function resetTranscriptScrollActivityForTest(): void {
  lastScrollActivityMs = 0;
  suppressLiveToolTicks = false;
}
