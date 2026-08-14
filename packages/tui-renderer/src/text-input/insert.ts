import {
  shiftAtomicRangesAfterDelete,
  shiftAtomicRangesAfterInsert,
} from './edit';
import { normalizeInputText } from './layout';
import type { RendererTextInputAtomicRange, RendererTextInputSelectionRange } from './types';
import {
  snapTextOffsetToBoundary,
  splitClusters,
  type AtomicCursorBias,
} from './selection';

/**
 * Pure insert-text mutation for `RendererTextInput`: normalization, max-length
 * clipping, atomic-range shifting, and the next cursor offset after insert.
 */

export interface TextInputInsertResult {
  readonly lines: readonly string[];
  readonly atomicRanges: readonly RendererTextInputAtomicRange[];
  readonly nextOffset: number;
}

export function normalizeInsertText(text: string, multiline: boolean): string {
  return multiline
    ? text.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
    : text.replaceAll(/[\r\n]/g, '');
}

/**
 * Clip insert text so maxLength never splits a grapheme cluster (Hangul /
 * emoji / ZWJ). Prefer whole clusters that fit; return empty when even the
 * first cluster would exceed the remaining budget.
 */
export function clipInsertTextToMaxLength(text: string, maxLength: number): string {
  if (maxLength <= 0) return '';
  if (text.length <= maxLength) return text;
  let out = '';
  for (const cluster of splitClusters(text)) {
    if (out.length + cluster.text.length > maxLength) break;
    out += cluster.text;
  }
  return out;
}

export function computeTextInputInsert(
  params: {
    readonly normalized: string;
    readonly multiline: boolean;
    readonly maxLength: number | undefined;
    readonly currentText: string;
    readonly lines: readonly string[];
    readonly atomicRanges: readonly RendererTextInputAtomicRange[];
    readonly selection: RendererTextInputSelectionRange | undefined;
    readonly cursorOffset: number;
    readonly snapOffset: (offset: number, bias: AtomicCursorBias) => number;
  },
): TextInputInsertResult | undefined {
  if (params.normalized.length === 0) return undefined;
  // Selection start is already expanded to atomic edges by the host. For a bare
  // caret, snap out of atomic interiors AND onto a grapheme boundary so Hangul /
  // emoji inserts never land mid-cluster and get eaten by a later clamp.
  const rawInsertAt =
    params.selection?.start ??
    params.snapOffset(params.cursorOffset, 'forward');
  const insertAt = params.snapOffset(
    snapTextOffsetToBoundary(params.currentText, rawInsertAt, 'forward'),
    'forward',
  );
  const replaceEnd = params.selection?.end ?? insertAt;
  const selectedLength = replaceEnd - insertAt;
  const maxInsertLength =
    params.maxLength === undefined
      ? params.normalized.length
      : Math.max(0, params.maxLength - (params.currentText.length - selectedLength));
  if (maxInsertLength === 0 && selectedLength === 0) return undefined;
  const inserted =
    params.maxLength === undefined
      ? params.normalized
      : clipInsertTextToMaxLength(params.normalized, maxInsertLength);
  if (inserted.length === 0 && selectedLength === 0) return undefined;
  const nextText =
    params.currentText.slice(0, insertAt) +
    inserted +
    params.currentText.slice(replaceEnd);
  // Land the caret on a cluster boundary after the inserted run so a subsequent
  // clamp/snap cannot walk backward into the just-committed glyphs.
  const nextOffset = snapTextOffsetToBoundary(
    nextText,
    insertAt + inserted.length,
    'forward',
  );
  const lines = normalizeInputText(nextText);
  const rangesAfterDelete =
    params.selection === undefined
      ? params.atomicRanges
      : shiftAtomicRangesAfterDelete(params.atomicRanges, params.selection.start, params.selection.end);
  return {
    lines,
    atomicRanges: shiftAtomicRangesAfterInsert(rangesAfterDelete, insertAt, nextOffset - insertAt),
    nextOffset,
  };
}
