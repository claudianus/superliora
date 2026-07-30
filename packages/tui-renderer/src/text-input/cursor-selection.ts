import type { RendererTextInputHistorySnapshot } from './edit';
import {
  normalizeInputText,
  normalizeRenderWidth,
  type VisualLine,
} from './layout';
import { resolveTextInputMouseOffset } from './mouse';
import {
  clampOffsetOutsideAtomicRange,
  computeCursorForOffset,
  computeOffsetForCursor,
  computeOffsetForLine,
  expandToAtomicBoundaries,
  findNextEditableOffset,
  findPreviousEditableOffset,
} from './offsets';
import {
  nextWordBoundary,
  previousWordBoundary,
  snapColumnToBoundary,
  snapTextOffsetToBoundary,
  type AtomicCursorBias,
} from './selection';
import type {
  RendererTextInputAtomicRange,
  RendererTextInputCursor,
  RendererTextInputMouseOptions,
  RendererTextInputSelection,
  RendererTextInputSelectionRange,
} from './types';

/** Mutable cursor/selection surface used by {@link RendererTextInput}. */
export interface TextInputCursorSelectionState {
  readonly lines: readonly string[];
  cursor: RendererTextInputCursor;
  atomicRanges: readonly RendererTextInputAtomicRange[];
  selectionAnchor: number | undefined;
  preferredDisplayColumn: number | undefined;
  layoutWidth: number | undefined;
  placeholder: string | undefined;
  getText(): string;
  setLines(lines: string[]): void;
  setAtomicRanges(ranges: readonly RendererTextInputAtomicRange[]): void;
  createVisualLines(width: number): readonly VisualLine[];
  textOffsetForLine(line: number): number;
  clearSelection(): void;
  clearPreferredDisplayColumn(): void;
}

export function textOffsetForCursorState(state: TextInputCursorSelectionState): number {
  return computeOffsetForCursor(state.lines, state.cursor);
}

export function cursorForTextOffsetState(
  state: TextInputCursorSelectionState,
  offset: number,
): RendererTextInputCursor {
  return computeCursorForOffset(state.lines, offset);
}

export function snapOffsetOutOfAtomicRangeState(
  state: TextInputCursorSelectionState,
  offset: number,
  bias: AtomicCursorBias,
): number {
  return clampOffsetOutsideAtomicRange(state.getText(), state.atomicRanges, offset, bias);
}

export function setCursorFromTextOffsetState(
  state: TextInputCursorSelectionState,
  offset: number,
  bias: AtomicCursorBias,
): void {
  state.cursor = cursorForTextOffsetState(
    state,
    snapOffsetOutOfAtomicRangeState(state, offset, bias),
  );
}

export function moveCursorToOffsetState(
  state: TextInputCursorSelectionState,
  offset: number,
  bias: AtomicCursorBias,
  extend: boolean,
  anchorOverride?: number,
): void {
  const anchor = extend
    ? (anchorOverride ?? state.selectionAnchor ?? textOffsetForCursorState(state))
    : undefined;
  setCursorFromTextOffsetState(state, offset, bias);
  if (anchor === undefined) {
    state.clearSelection();
    return;
  }
  state.selectionAnchor =
    anchor === textOffsetForCursorState(state) ? undefined : anchor;
}

export function clampCursorState(
  state: TextInputCursorSelectionState,
  bias: AtomicCursorBias = 'nearest',
): void {
  const line = Math.max(0, Math.min(state.lines.length - 1, Math.floor(state.cursor.line)));
  const text = state.lines[line] ?? '';
  const column = snapColumnToBoundary(text, state.cursor.column);
  state.cursor = { line, column };
  setCursorFromTextOffsetState(state, textOffsetForCursorState(state), bias);
}

export function selectionRangeState(
  state: TextInputCursorSelectionState,
): RendererTextInputSelectionRange | undefined {
  if (state.selectionAnchor === undefined) return undefined;
  const head = textOffsetForCursorState(state);
  if (head === state.selectionAnchor) return undefined;
  return expandToAtomicBoundaries(
    state.atomicRanges,
    Math.min(state.selectionAnchor, head),
    Math.max(state.selectionAnchor, head),
  );
}

export function normalizeSelectionOffsetState(
  state: TextInputCursorSelectionState,
  offset: number,
): number {
  const text = state.getText();
  return snapOffsetOutOfAtomicRangeState(
    state,
    snapTextOffsetToBoundary(text, offset, 'nearest'),
    'nearest',
  );
}

export function normalizeSelectionState(state: TextInputCursorSelectionState): void {
  const selection = getSelectionState(state);
  if (selection === undefined) {
    state.clearSelection();
    return;
  }
  setSelectionState(state, selection);
}

export function getSelectionState(
  state: TextInputCursorSelectionState,
): RendererTextInputSelection | undefined {
  if (state.selectionAnchor === undefined) return undefined;
  const head = textOffsetForCursorState(state);
  if (state.selectionAnchor === head) return undefined;
  return { anchor: state.selectionAnchor, head };
}

export function setSelectionState(
  state: TextInputCursorSelectionState,
  selection: RendererTextInputSelection | undefined,
): void {
  if (selection === undefined) {
    state.clearSelection();
    return;
  }
  const anchor = normalizeSelectionOffsetState(state, selection.anchor);
  const head = normalizeSelectionOffsetState(state, selection.head);
  state.selectionAnchor = anchor;
  setCursorFromTextOffsetState(state, head, 'nearest');
  if (textOffsetForCursorState(state) === anchor) state.clearSelection();
  state.clearPreferredDisplayColumn();
}

export function previousEditableOffsetState(
  state: TextInputCursorSelectionState,
  offset: number,
): number {
  return findPreviousEditableOffset(state.getText(), state.atomicRanges, offset);
}

export function nextEditableOffsetState(
  state: TextInputCursorSelectionState,
  offset: number,
): number {
  return findNextEditableOffset(state.getText(), state.atomicRanges, offset);
}

export function previousWordOffsetState(
  state: TextInputCursorSelectionState,
  offset: number,
): number {
  return snapOffsetOutOfAtomicRangeState(
    state,
    previousWordBoundary(state.getText(), offset),
    'backward',
  );
}

export function nextWordOffsetState(
  state: TextInputCursorSelectionState,
  offset: number,
): number {
  return snapOffsetOutOfAtomicRangeState(
    state,
    nextWordBoundary(state.getText(), offset),
    'forward',
  );
}

export function deleteTextRangeState(
  state: TextInputCursorSelectionState,
  start: number,
  end: number,
  shiftAtomicRangesAfterDelete: (
    ranges: readonly RendererTextInputAtomicRange[],
    start: number,
    end: number,
  ) => readonly RendererTextInputAtomicRange[],
): void {
  if (end <= start) return;
  const text = state.getText();
  state.setLines(normalizeInputText(text.slice(0, start) + text.slice(end)));
  state.setAtomicRanges(shiftAtomicRangesAfterDelete(state.atomicRanges, start, end));
}

export function textOffsetForMouseState(
  state: TextInputCursorSelectionState,
  options: RendererTextInputMouseOptions,
): number {
  const resolved = resolveTextInputMouseOffset(
    state.createVisualLines(normalizeRenderWidth(options.width ?? state.layoutWidth ?? 1)),
    options,
    state.layoutWidth,
    (line) => state.textOffsetForLine(line),
  );
  state.layoutWidth = resolved.width;
  return resolved.offset;
}

export function restoreHistorySnapshotState(
  state: TextInputCursorSelectionState,
  snapshot: RendererTextInputHistorySnapshot,
  restoreSnapshot: (snapshot: RendererTextInputHistorySnapshot) => {
    lines: string[];
    cursor: RendererTextInputCursor;
    atomicRanges: readonly RendererTextInputAtomicRange[];
    selectionAnchor: number | undefined;
  },
): void {
  const restored = restoreSnapshot(snapshot);
  state.setLines(restored.lines);
  state.cursor = restored.cursor;
  state.setAtomicRanges(restored.atomicRanges);
  state.selectionAnchor = restored.selectionAnchor;
  clampCursorState(state);
  normalizeSelectionState(state);
  state.clearPreferredDisplayColumn();
}
