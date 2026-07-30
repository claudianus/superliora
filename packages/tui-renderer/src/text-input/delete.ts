import type { AtomicCursorBias } from './selection';
import type { RendererTextInputHistorySnapshot } from './edit';
import type { RendererTextInputSelectionRange } from './types';

/**
 * Pure delete-range algorithms backing `RendererTextInput` backward/forward,
 * word, and line-boundary deletes. The class owns undo snapshots and applies
 * the returned ranges to mutable lines/atomicRanges.
 */

export interface TextInputDeleteRange {
  readonly start: number;
  readonly end: number;
  readonly cursorOffset: number;
  readonly bias: AtomicCursorBias;
}

export function collapsedSelectionOffset(
  selection: RendererTextInputSelectionRange | undefined,
  side: 'start' | 'end',
): number | undefined {
  if (selection === undefined) return undefined;
  return side === 'start' ? selection.start : selection.end;
}

export function computeCharacterBackwardDelete(
  cursorOffset: number,
  previousEditableOffset: (offset: number) => number,
): TextInputDeleteRange | undefined {
  if (cursorOffset <= 0) return undefined;
  const start = previousEditableOffset(cursorOffset);
  return { start, end: cursorOffset, cursorOffset: start, bias: 'backward' };
}

export function computeCharacterForwardDelete(
  cursorOffset: number,
  textLength: number,
  nextEditableOffset: (offset: number) => number,
): TextInputDeleteRange | undefined {
  if (cursorOffset >= textLength) return undefined;
  const end = nextEditableOffset(cursorOffset);
  return { start: cursorOffset, end, cursorOffset: cursorOffset, bias: 'forward' };
}

export function computeWordBackwardDelete(
  cursorOffset: number,
  previousWordOffset: (offset: number) => number,
): TextInputDeleteRange | undefined {
  const start = previousWordOffset(cursorOffset);
  if (start === cursorOffset) return undefined;
  return { start, end: cursorOffset, cursorOffset: start, bias: 'backward' };
}

export function computeWordForwardDelete(
  cursorOffset: number,
  nextWordOffset: (offset: number) => number,
): TextInputDeleteRange | undefined {
  const end = nextWordOffset(cursorOffset);
  if (cursorOffset === end) return undefined;
  return { start: cursorOffset, end, cursorOffset: cursorOffset, bias: 'forward' };
}

export function computeLineStartDelete(
  lineStartOffset: number,
  cursorOffset: number,
): TextInputDeleteRange | undefined {
  if (lineStartOffset === cursorOffset) return undefined;
  return { start: lineStartOffset, end: cursorOffset, cursorOffset: lineStartOffset, bias: 'backward' };
}

export function computeLineEndDelete(
  cursorOffset: number,
  lineEndOffset: number,
): TextInputDeleteRange | undefined {
  if (cursorOffset === lineEndOffset) return undefined;
  return { start: cursorOffset, end: lineEndOffset, cursorOffset: cursorOffset, bias: 'forward' };
}

export interface TextInputDeleteActions {
  createHistorySnapshot(): RendererTextInputHistorySnapshot;
  deleteSelection(): boolean;
  applyDeleteRange(range: TextInputDeleteRange): void;
  clearPreferredDisplayColumn(): void;
  pushUndoSnapshot(snapshot: RendererTextInputHistorySnapshot): void;
}

export function executeTextInputDelete(
  actions: TextInputDeleteActions,
  computeRange: () => TextInputDeleteRange | undefined,
): void {
  const before = actions.createHistorySnapshot();
  if (actions.deleteSelection()) {
    actions.clearPreferredDisplayColumn();
    actions.pushUndoSnapshot(before);
    return;
  }
  const range = computeRange();
  if (range === undefined) return;
  actions.applyDeleteRange(range);
  actions.clearPreferredDisplayColumn();
  actions.pushUndoSnapshot(before);
}
