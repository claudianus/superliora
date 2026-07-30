import {
  shiftAtomicRangesAfterDelete,
  shiftAtomicRangesAfterInsert,
} from './text-input-edit';
import { normalizeInputText } from './text-input-layout';
import type { RendererTextInputAtomicRange, RendererTextInputSelectionRange } from './text-input-types';
import type { AtomicCursorBias } from './text-input-selection';

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
  const insertAt =
    params.selection?.start ??
    params.snapOffset(params.cursorOffset, 'forward');
  const replaceEnd = params.selection?.end ?? insertAt;
  const selectedLength = replaceEnd - insertAt;
  const maxInsertLength =
    params.maxLength === undefined
      ? params.normalized.length
      : Math.max(0, params.maxLength - (params.currentText.length - selectedLength));
  if (maxInsertLength === 0 && selectedLength === 0) return undefined;
  const nextText =
    params.currentText.slice(0, insertAt) +
    params.normalized.slice(0, maxInsertLength) +
    params.currentText.slice(replaceEnd);
  const nextOffset = insertAt + Math.min(params.normalized.length, maxInsertLength);
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
