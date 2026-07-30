import type {
  RendererTextInputAtomicRange,
  RendererTextInputCursor,
  RendererTextInputSelectionRange,
} from './text-input';
import {
  nextClusterBoundary,
  previousClusterBoundary,
  rangesOverlap,
  snapColumnToBoundary,
  type AtomicCursorBias,
} from './text-input-selection';

/**
 * Pure text-offset and atomic-range query algorithms backing
 * `RendererTextInput` cursor/selection bookkeeping: logical-line <-> text-
 * offset conversion, atomic-range containment/expansion, and editable-offset
 * lookup around atomic ranges. No mutable state lives here; `RendererTextInput`
 * (text-input.ts) owns the lines/cursor/atomicRanges fields and calls into
 * these functions with plain values.
 */

export function computeOffsetForLine(lines: readonly string[], line: number): number {
  let offset = 0;
  const bounded = Math.max(0, Math.min(lines.length - 1, Math.floor(line)));
  for (let index = 0; index < bounded; index++) {
    offset += (lines[index] ?? '').length + 1;
  }
  return offset;
}

export function computeOffsetForCursor(
  lines: readonly string[],
  cursor: RendererTextInputCursor,
): number {
  return computeOffsetForLine(lines, cursor.line) + cursor.column;
}

export function computeCursorForOffset(
  lines: readonly string[],
  offset: number,
): RendererTextInputCursor {
  let remaining = Math.max(0, offset);
  for (let line = 0; line < lines.length; line++) {
    const text = lines[line] ?? '';
    if (remaining <= text.length) {
      return { line, column: snapColumnToBoundary(text, remaining) };
    }
    remaining -= text.length + 1;
  }
  const lastLine = lines.length - 1;
  return { line: lastLine, column: lines[lastLine]?.length ?? 0 };
}

export function findContainingAtomicRange(
  ranges: readonly RendererTextInputAtomicRange[],
  offset: number,
): RendererTextInputAtomicRange | undefined {
  return ranges.find((range) => range.start < offset && offset < range.end);
}

export function clampOffsetOutsideAtomicRange(
  text: string,
  ranges: readonly RendererTextInputAtomicRange[],
  offset: number,
  bias: AtomicCursorBias,
): number {
  const bounded = Math.max(0, Math.min(text.length, offset));
  const range = findContainingAtomicRange(ranges, bounded);
  if (range === undefined) return bounded;
  if (bias === 'backward') return range.start;
  if (bias === 'forward') return range.end;
  return bounded - range.start <= range.end - bounded ? range.start : range.end;
}

export function findPreviousEditableOffset(
  text: string,
  ranges: readonly RendererTextInputAtomicRange[],
  offset: number,
): number {
  const bounded = Math.max(0, Math.min(text.length, offset));
  const endingRange = ranges.find((range) => range.end === bounded);
  if (endingRange !== undefined) return endingRange.start;
  const previous = previousClusterBoundary(text, bounded);
  const containingRange = findContainingAtomicRange(ranges, previous);
  return containingRange?.start ?? previous;
}

export function findNextEditableOffset(
  text: string,
  ranges: readonly RendererTextInputAtomicRange[],
  offset: number,
): number {
  const bounded = Math.max(0, Math.min(text.length, offset));
  const startingRange = ranges.find((range) => range.start === bounded);
  if (startingRange !== undefined) return startingRange.end;
  const next = nextClusterBoundary(text, bounded);
  const containingRange = findContainingAtomicRange(ranges, next);
  return containingRange?.end ?? next;
}

export function expandToAtomicBoundaries(
  ranges: readonly RendererTextInputAtomicRange[],
  start: number,
  end: number,
): RendererTextInputSelectionRange {
  let expandedStart = start;
  let expandedEnd = end;
  let changed = true;
  while (changed) {
    changed = false;
    for (const range of ranges) {
      if (!rangesOverlap(expandedStart, expandedEnd, range.start, range.end)) continue;
      if (range.start < expandedStart) {
        expandedStart = range.start;
        changed = true;
      }
      if (range.end > expandedEnd) {
        expandedEnd = range.end;
        changed = true;
      }
    }
  }
  return { start: expandedStart, end: expandedEnd };
}
