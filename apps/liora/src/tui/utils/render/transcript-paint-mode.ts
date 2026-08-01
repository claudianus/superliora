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

import { isTranscriptMeasureMode } from '#/tui/renderer';

let suppressLiveToolTicks = false;
let lastScrollActivityMs = 0;

/** How long after a scroll paint chrome timers should skip refresh. */
export const TRANSCRIPT_SCROLL_TIMER_HOLD_MS = 180;

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
  return nowMs - lastScrollActivityMs < holdMs && lastScrollActivityMs > 0;
}

/** Test helper. */
export function resetTranscriptScrollActivityForTest(): void {
  lastScrollActivityMs = 0;
  suppressLiveToolTicks = false;
}
