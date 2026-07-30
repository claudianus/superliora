import type { RendererDirtyRowSpan } from './types';

/**
 * Merge [x, endX) into sorted row intervals.
 * Overlapping or adjacent ranges coalesce; a gap stays as separate spans so
 * left+right letterbox damage does not scan the centered stage between them.
 */
export function mergeDirtyRowIntervals(
  intervals: readonly { x: number; endX: number }[],
  x: number,
  endX: number,
): { x: number; endX: number }[] {
  if (endX <= x) return intervals.map((span) => ({ x: span.x, endX: span.endX }));
  const next: { x: number; endX: number }[] = [];
  let merged = { x, endX };
  let inserted = false;
  for (const span of intervals) {
    if (span.endX < merged.x) {
      next.push({ x: span.x, endX: span.endX });
      continue;
    }
    if (span.x > merged.endX) {
      if (!inserted) {
        next.push(merged);
        inserted = true;
      }
      next.push({ x: span.x, endX: span.endX });
      continue;
    }
    merged = {
      x: Math.min(merged.x, span.x),
      endX: Math.max(merged.endX, span.endX),
    };
  }
  if (!inserted) next.push(merged);
  return next;
}

export function compareDirtyRowSpans(a: RendererDirtyRowSpan, b: RendererDirtyRowSpan): number {
  return a.y === b.y ? a.x - b.x : a.y - b.y;
}
