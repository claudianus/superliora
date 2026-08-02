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

/** How long after a scroll paint chrome timers should skip refresh. */
export const TRANSCRIPT_SCROLL_TIMER_HOLD_MS = 180;
/**
 * Hold content/layout invalidation after pure-scroll. Slightly longer than
 * storm gap so format/ambient ticks cannot re-enter while the wheel is hot.
 */
export const TRANSCRIPT_SCROLL_INVALIDATION_HOLD_MS = Math.max(
  TRANSCRIPT_SCROLL_TIMER_HOLD_MS,
  TRANSCRIPT_SCROLL_STORM_GAP_MS * 5,
);

export interface TranscriptPaintMode {
  readonly suppressLiveToolTicks?: boolean;
}

export function withTranscriptPaintMode<T>(mode: TranscriptPaintMode, run: () => T): T {
  const previous = suppressLiveToolTicks;
  suppressLiveToolTicks = mode.suppressLiveToolTicks === true;
  if (suppressLiveToolTicks) {
    lastScrollActivityMs = Date.now();
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
  nowMs: number = Date.now(),
  holdMs: number = TRANSCRIPT_SCROLL_TIMER_HOLD_MS,
): boolean {
  if (isTranscriptScrollStorm(nowMs, holdMs)) return true;
  return nowMs - lastScrollActivityMs < holdMs && lastScrollActivityMs > 0;
}

/**
 * True while content/geometry invalidation must defer (scroll storm or recent
 * pure-scroll paint). Stronger than {@link wasRecentTranscriptScroll} for
 * O(transcript) work like invalidateGeometryAndPaint.
 */
export function shouldDeferTranscriptHeavyInvalidation(
  nowMs: number = Date.now(),
): boolean {
  return (
    isTranscriptScrollStorm(nowMs, TRANSCRIPT_SCROLL_INVALIDATION_HOLD_MS) ||
    wasRecentTranscriptScroll(nowMs, TRANSCRIPT_SCROLL_INVALIDATION_HOLD_MS)
  );
}

/** Test helper. */
export function resetTranscriptScrollActivityForTest(): void {
  lastScrollActivityMs = 0;
  suppressLiveToolTicks = false;
}
