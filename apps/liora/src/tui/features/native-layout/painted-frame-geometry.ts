import type { RendererRect, RendererRegionId, RendererRegionLine } from '#/tui/renderer';

/**
 * Geometry of the frame that is actually on screen.
 *
 * Pointer hit-tests must agree with what the user sees, and they run once per
 * input event — a trackpad fling delivers hundreds of wheel events a second.
 * Recomputing the stage plan or re-rendering the transcript per event pinned
 * the main thread for seconds (the scroll freeze). The frame builder already
 * has every rect and the painted transcript window, so it publishes them here
 * and hit-tests read them in O(1).
 */
export interface PaintedFrameGeometry {
  readonly columns: number;
  readonly rows: number;
  readonly stageWidth: number;
  readonly regions: Partial<Record<RendererRegionId, RendererRect>>;
  readonly transcriptVisibleRows: number;
  /** Viewport start the transcript window was painted at. */
  readonly transcriptViewportStart: number;
  /** Transcript region lines as painted (selection overlay included). */
  readonly transcriptLines: readonly RendererRegionLine[];
}

/** Painted geometry when it was laid out for this terminal size, else undefined. */
export function paintedFrameGeometryFor(
  geometry: PaintedFrameGeometry | undefined,
  columns: number,
  rows: number,
): PaintedFrameGeometry | undefined {
  if (geometry === undefined) return undefined;
  if (geometry.columns !== columns || geometry.rows !== rows) return undefined;
  return geometry;
}
