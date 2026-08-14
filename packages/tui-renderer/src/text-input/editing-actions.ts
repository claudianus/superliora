import type { RendererTextInputHistorySnapshot } from './edit';
import {
  computeCharacterBackwardDelete,
  computeCharacterForwardDelete,
  computeLineEndDelete,
  computeLineStartDelete,
  computeWordBackwardDelete,
  computeWordForwardDelete,
  executeTextInputDelete,
} from './delete';
import { shiftAtomicRangesAfterDelete } from './edit';
import {
  computeTextInputInsert,
  normalizeInsertText,
} from './insert';
import {
  computeMoveLeftOffset,
  computeMoveRightOffset,
  computeMoveWordLeftOffset,
  computeMoveWordRightOffset,
} from './horizontal-move';
import {
  moveTextInputPage,
  moveTextInputParagraph,
  moveTextInputVertical,
} from './vertical-move';
import type { NavigationMoveResult } from './navigation';
import type { AtomicCursorBias } from './selection';
import type { RendererTextInputSelectionRange } from './types';
import {
  clampCursorState,
  deleteTextRangeState,
  moveCursorToOffsetState,
  nextEditableOffsetState,
  nextWordOffsetState,
  previousEditableOffsetState,
  previousWordOffsetState,
  selectionRangeState,
  setCursorFromTextOffsetState,
  textOffsetForCursorState,
  type TextInputCursorSelectionState,
} from './cursor-selection';
import type { VisualLine } from './layout';
import { computeVisualLineIndexForCursor } from './layout';

export interface TextInputEditingHost extends TextInputCursorSelectionState {
  readonly multiline: boolean;
  readonly maxLength: number | undefined;
  lines: string[];
  atomicRanges: readonly import('./types').RendererTextInputAtomicRange[];
  layoutHeight: number | undefined;
  preferredDisplayColumn: number | undefined;
  createVisualLines(width: number): readonly VisualLine[];
  clearSelection(): void;
  clearPreferredDisplayColumn(): void;
  createHistorySnapshot(): RendererTextInputHistorySnapshot;
  pushUndoSnapshot(snapshot: RendererTextInputHistorySnapshot): void;
  selectionRange(): RendererTextInputSelectionRange | undefined;
  textOffsetForCursor(): number;
  textOffsetForLine(line: number): number;
  currentLine(): string;
  snapOffsetOutOfAtomicRange(offset: number, bias: AtomicCursorBias): number;
}

export function insertTextInputContent(host: TextInputEditingHost, text: string): void {
  const normalized = normalizeInsertText(text, host.multiline);
  const result = computeTextInputInsert({
    normalized,
    multiline: host.multiline,
    maxLength: host.maxLength,
    currentText: host.getText(),
    lines: host.lines,
    atomicRanges: host.atomicRanges,
    selection: host.selectionRange(),
    cursorOffset: host.textOffsetForCursor(),
    snapOffset: (offset, bias) => host.snapOffsetOutOfAtomicRange(offset, bias),
  });
  if (result === undefined) return;
  const before = host.createHistorySnapshot();
  host.lines = [...result.lines];
  host.atomicRanges = result.atomicRanges;
  host.clearSelection();
  setCursorFromTextOffsetState(host, result.nextOffset, 'forward');
  // Forward bias: never snap the caret backward into the just-inserted cluster
  // (Hangul / combining marks / multi-code-unit emoji).
  clampCursorState(host, 'forward');
  host.clearPreferredDisplayColumn();
  host.pushUndoSnapshot(before);
}

function deleteActions(host: TextInputEditingHost) {
  return {
    createHistorySnapshot: () => host.createHistorySnapshot(),
    deleteSelection: () => deleteSelection(host),
    applyDeleteRange: (range: {
      readonly start: number;
      readonly end: number;
      readonly cursorOffset: number;
      readonly bias: AtomicCursorBias;
    }) =>{  applyDeleteRange(host, range); },
    clearPreferredDisplayColumn: () =>{  host.clearPreferredDisplayColumn(); },
    pushUndoSnapshot: (snapshot: RendererTextInputHistorySnapshot) =>{  host.pushUndoSnapshot(snapshot); },
  };
}

function verticalMoveActions(host: TextInputEditingHost) {
  return {
    lines: host.lines,
    cursor: host.cursor,
    layoutWidth: host.layoutWidth,
    layoutHeight: host.layoutHeight,
    preferredDisplayColumn: host.preferredDisplayColumn,
    createVisualLines: (width: number) => host.createVisualLines(width),
    visualLineIndexForCursor: (visualLines: readonly VisualLine[]) =>
      computeVisualLineIndexForCursor(host.cursor, visualLines),
    textLength: () => host.getText().length,
    applyNavigationMove: (move: NavigationMoveResult, extend: boolean) =>{ 
      applyNavigationMove(host, move, extend); },
  };
}

function applyNavigationMove(host: TextInputEditingHost, move: NavigationMoveResult, extend: boolean): void {
  if (move.clearPreferred) host.clearPreferredDisplayColumn();
  else if (move.preferredColumn !== undefined) host.preferredDisplayColumn = move.preferredColumn;
  moveCursorToOffsetState(host, move.offset, move.bias, extend);
}

function applyDeleteRange(
  host: TextInputEditingHost,
  range: { readonly start: number; readonly end: number; readonly cursorOffset: number; readonly bias: AtomicCursorBias },
): void {
  deleteTextRangeState(host, range.start, range.end, shiftAtomicRangesAfterDelete);
  setCursorFromTextOffsetState(host, range.cursorOffset, range.bias);
}

function deleteSelection(host: TextInputEditingHost): boolean {
  const selection = host.selectionRange();
  if (selection === undefined) return false;
  deleteTextRangeState(host, selection.start, selection.end, shiftAtomicRangesAfterDelete);
  setCursorFromTextOffsetState(host, selection.start, 'backward');
  host.clearSelection();
  return true;
}

export function deleteTextInputBackward(host: TextInputEditingHost): void {
  executeTextInputDelete(deleteActions(host), () =>
    computeCharacterBackwardDelete(host.textOffsetForCursor(), (offset) =>
      previousEditableOffsetState(host, offset),
    ),
  );
}

export function deleteTextInputForward(host: TextInputEditingHost): void {
  executeTextInputDelete(deleteActions(host), () =>
    computeCharacterForwardDelete(host.textOffsetForCursor(), host.getText().length, (offset) =>
      nextEditableOffsetState(host, offset),
    ),
  );
}

export function moveTextInputLeft(host: TextInputEditingHost, extend = false): void {
  const offset = computeMoveLeftOffset(
    host.selectionRange(),
    extend,
    host.textOffsetForCursor(),
    (value) => previousEditableOffsetState(host, value),
  );
  moveCursorToOffsetState(host, offset, 'backward', extend);
  host.clearPreferredDisplayColumn();
}

export function moveTextInputRight(host: TextInputEditingHost, extend = false): void {
  const offset = computeMoveRightOffset(
    host.selectionRange(),
    extend,
    host.textOffsetForCursor(),
    (value) => nextEditableOffsetState(host, value),
  );
  moveCursorToOffsetState(host, offset, 'forward', extend);
  host.clearPreferredDisplayColumn();
}

export function moveTextInputWordLeft(host: TextInputEditingHost, extend = false): void {
  const offset = computeMoveWordLeftOffset(
    host.selectionRange(),
    extend,
    host.textOffsetForCursor(),
    (value) => previousWordOffsetState(host, value),
  );
  moveCursorToOffsetState(host, offset, 'backward', extend);
  host.clearPreferredDisplayColumn();
}

export function moveTextInputWordRight(host: TextInputEditingHost, extend = false): void {
  const offset = computeMoveWordRightOffset(
    host.selectionRange(),
    extend,
    host.textOffsetForCursor(),
    (value) => nextWordOffsetState(host, value),
  );
  moveCursorToOffsetState(host, offset, 'forward', extend);
  host.clearPreferredDisplayColumn();
}

export function deleteTextInputWordBackward(host: TextInputEditingHost): void {
  executeTextInputDelete(deleteActions(host), () =>
    computeWordBackwardDelete(host.textOffsetForCursor(), (offset) =>
      previousWordOffsetState(host, offset),
    ),
  );
}

export function deleteTextInputWordForward(host: TextInputEditingHost): void {
  executeTextInputDelete(deleteActions(host), () =>
    computeWordForwardDelete(host.textOffsetForCursor(), (offset) =>
      nextWordOffsetState(host, offset),
    ),
  );
}

export function deleteTextInputToLineStart(host: TextInputEditingHost): void {
  executeTextInputDelete(deleteActions(host), () =>
    computeLineStartDelete(host.textOffsetForLine(host.cursor.line), host.textOffsetForCursor()),
  );
}

export function deleteTextInputToLineEnd(host: TextInputEditingHost): void {
  executeTextInputDelete(deleteActions(host), () =>
    computeLineEndDelete(
      host.textOffsetForCursor(),
      host.textOffsetForLine(host.cursor.line) + host.currentLine().length,
    ),
  );
}

export function moveTextInputVerticalDirection(
  host: TextInputEditingHost,
  direction: -1 | 1,
  extend = false,
): void {
  moveTextInputVertical(direction, extend, verticalMoveActions(host));
}

export function moveTextInputParagraphDirection(
  host: TextInputEditingHost,
  direction: -1 | 1,
  extend = false,
): void {
  moveTextInputParagraph(direction, extend, verticalMoveActions(host));
}

export function moveTextInputPageDirection(
  host: TextInputEditingHost,
  direction: -1 | 1,
  extend = false,
): void {
  moveTextInputPage(direction, extend, verticalMoveActions(host));
}

export function textInputSelectionRange(host: TextInputCursorSelectionState): RendererTextInputSelectionRange | undefined {
  return selectionRangeState(host);
}

export function textInputOffsetForCursor(host: TextInputCursorSelectionState): number {
  return textOffsetForCursorState(host);
}
