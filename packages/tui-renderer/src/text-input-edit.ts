import type { RendererTextInputAtomicRange, RendererTextInputCursor } from './text-input-types';
import { snapTextOffsetToBoundary } from './text-input-selection';

/**
 * Pure edit-operation algorithms backing `RendererTextInput` insert/delete
 * and undo/redo: atomic-range normalization/shifting around text mutations,
 * and history snapshot equality. `RendererTextInput` (text-input.ts) owns the
 * mutable lines/cursor/atomicRanges/history stacks and calls into these
 * functions with plain values.
 */

export interface RendererTextInputHistorySnapshot {
  readonly lines: readonly string[];
  readonly cursor: RendererTextInputCursor;
  readonly atomicRanges: readonly RendererTextInputAtomicRange[];
  readonly selectionAnchor?: number;
}

export function normalizeAtomicRanges(
  ranges: readonly RendererTextInputAtomicRange[] | undefined,
  text: string,
): readonly RendererTextInputAtomicRange[] {
  if (ranges === undefined || ranges.length === 0 || text.length === 0) return [];
  const out: RendererTextInputAtomicRange[] = [];
  const sorted = ranges
    .map((range) => {
      const start = snapTextOffsetToBoundary(text, range.start, 'backward');
      const end = snapTextOffsetToBoundary(text, range.end, 'forward');
      if (end <= start) return undefined;
      const normalized: { start: number; end: number; id?: string } = { start, end };
      if (range.id !== undefined) normalized.id = range.id;
      return normalized;
    })
    .filter((range): range is RendererTextInputAtomicRange => range !== undefined)
    .toSorted((a, b) => a.start - b.start || a.end - b.end);

  for (const range of sorted) {
    const previous = out.at(-1);
    if (previous !== undefined && range.start < previous.end) {
      const merged: { start: number; end: number; id?: string } = {
        start: previous.start,
        end: Math.max(previous.end, range.end),
      };
      if (previous.id !== undefined && previous.id === range.id) merged.id = previous.id;
      out[out.length - 1] = merged;
      continue;
    }
    out.push(range);
  }

  return out;
}

export function shiftAtomicRangesAfterInsert(
  ranges: readonly RendererTextInputAtomicRange[],
  offset: number,
  amount: number,
): readonly RendererTextInputAtomicRange[] {
  if (amount <= 0 || ranges.length === 0) return ranges;
  return ranges.map((range) => {
    const shifted: { start: number; end: number; id?: string } =
      range.start >= offset
        ? { start: range.start + amount, end: range.end + amount }
        : range.end > offset
          ? { start: range.start, end: range.end + amount }
          : { start: range.start, end: range.end };
    if (range.id !== undefined) shifted.id = range.id;
    return shifted;
  });
}

export function shiftAtomicRangesAfterDelete(
  ranges: readonly RendererTextInputAtomicRange[],
  start: number,
  end: number,
): readonly RendererTextInputAtomicRange[] {
  if (end <= start || ranges.length === 0) return ranges;
  const amount = end - start;
  const out: RendererTextInputAtomicRange[] = [];
  for (const range of ranges) {
    if (range.end <= start) {
      out.push(range);
      continue;
    }
    if (range.start >= end) {
      const shifted: { start: number; end: number; id?: string } = {
        start: range.start - amount,
        end: range.end - amount,
      };
      if (range.id !== undefined) shifted.id = range.id;
      out.push(shifted);
    }
  }
  return out;
}

export function cloneAtomicRange(range: RendererTextInputAtomicRange): RendererTextInputAtomicRange {
  const clone: { start: number; end: number; id?: string } = {
    start: range.start,
    end: range.end,
  };
  if (range.id !== undefined) clone.id = range.id;
  return clone;
}

export function historySnapshotsEqual(
  left: RendererTextInputHistorySnapshot,
  right: RendererTextInputHistorySnapshot,
): boolean {
  return (
    arrayEqual(left.lines, right.lines) &&
    cursorEqual(left.cursor, right.cursor) &&
    left.selectionAnchor === right.selectionAnchor &&
    atomicRangesEqual(left.atomicRanges, right.atomicRanges)
  );
}

function arrayEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function cursorEqual(left: RendererTextInputCursor, right: RendererTextInputCursor): boolean {
  return left.line === right.line && left.column === right.column;
}

function atomicRangesEqual(
  left: readonly RendererTextInputAtomicRange[],
  right: readonly RendererTextInputAtomicRange[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((range, index) => {
    const other = right[index]!;
    return range.start === other.start && range.end === other.end && range.id === other.id;
  });
}
