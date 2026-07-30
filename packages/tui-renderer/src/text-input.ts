import type { RendererCellStyle } from './cell-buffer';
import type { NativeInputEvent, NativeInputKeyEvent, NativeInputMouseEvent } from './input-events';
import type { RendererTextInputHistorySnapshot } from './text-input-edit';
import {
  computeCharacterBackwardDelete,
  computeCharacterForwardDelete,
  computeLineEndDelete,
  computeLineStartDelete,
  computeWordBackwardDelete,
  computeWordForwardDelete,
  executeTextInputDelete,
} from './text-input-delete';
import {
  normalizeAtomicRanges,
  shiftAtomicRangesAfterDelete,
} from './text-input-edit';
import {
  computeTextInputInsert,
  normalizeInsertText,
} from './text-input-insert';
import {
  computeMoveLeftOffset,
  computeMoveRightOffset,
  computeMoveWordLeftOffset,
  computeMoveWordRightOffset,
} from './text-input-horizontal-move';
import {
  handleTextInputMouse,
  resolveTextInputMouseOffset,
} from './text-input-mouse';
import { renderTextInputFrame } from './text-input-render';
import type { RendererCursorShape } from './terminal-output';
import {
  dispatchTextInputKey,
  type RendererTextInputKeyActions,
} from './text-input-key-dispatch';
import {
  createTextInputHistorySnapshot,
  pushTextInputUndoSnapshot,
  restoreTextInputHistorySnapshot,
} from './text-input-history';
import {
  buildVisualLines,
  computeVisualLineIndexForCursor,
  normalizeHistoryLimit,
  normalizeInputText,
  normalizeMaxLength,
  normalizeOptionalLayoutWidth,
  normalizeRenderHeight,
  normalizeRenderWidth,
  type VisualLine,
} from './text-input-layout';
import {
  moveTextInputPage,
  moveTextInputParagraph,
  moveTextInputVertical,
} from './text-input-vertical-move';
import type { NavigationMoveResult } from './text-input-navigation';
import {
  nextWordBoundary,
  previousWordBoundary,
  snapColumnToBoundary,
  snapTextOffsetToBoundary,
  type AtomicCursorBias,
} from './text-input-selection';
import type {
  RendererTextInputAtomicRange,
  RendererTextInputCursor,
  RendererTextInputMouseOptions,
  RendererTextInputOptions,
  RendererTextInputRenderOptions,
  RendererTextInputRenderResult,
  RendererTextInputSelection,
  RendererTextInputSelectionRange,
} from './text-input-types';

export type {
  RendererTextInputAtomicRange,
  RendererTextInputCursor,
  RendererTextInputMouseOptions,
  RendererTextInputOptions,
  RendererTextInputRenderOptions,
  RendererTextInputRenderResult,
  RendererTextInputSelection,
  RendererTextInputSelectionRange,
} from './text-input-types';

import {
  clampOffsetOutsideAtomicRange,
  computeCursorForOffset,
  computeOffsetForCursor,
  computeOffsetForLine,
  expandToAtomicBoundaries,
  findNextEditableOffset,
  findPreviousEditableOffset,
} from './text-input-offsets';

export class RendererTextInput {
  private lines: string[];
  private cursor: RendererTextInputCursor = { line: 0, column: 0 };
  private readonly multiline: boolean;
  private readonly maxLength: number | undefined;
  private focused: boolean;
  private cursorShape: RendererCursorShape;
  private cursorBlinking: boolean | undefined;
  private placeholder: string | undefined;
  private style: RendererCellStyle | undefined;
  private placeholderStyle: RendererCellStyle | undefined;
  private atomicRanges: readonly RendererTextInputAtomicRange[] = [];
  private layoutWidth: number | undefined;
  private layoutHeight: number | undefined;
  private preferredDisplayColumn: number | undefined;
  private selectionAnchor: number | undefined;
  private selectionStyle: RendererCellStyle | undefined;
  private readonly historyLimit: number;
  private undoStack: RendererTextInputHistorySnapshot[] = [];
  private redoStack: RendererTextInputHistorySnapshot[] = [];
  private draggingSelectionAnchor: number | undefined;

  constructor(options: RendererTextInputOptions = {}) {
    this.multiline = options.multiline ?? true;
    this.maxLength = normalizeMaxLength(options.maxLength);
    this.lines = normalizeInputText(options.text ?? '');
    if (!this.multiline && this.lines.length > 1) {
      this.lines = [this.lines.join('')];
    }
    this.truncateToMaxLength();
    this.cursor = {
      line: this.lines.length - 1,
      column: this.lines.at(-1)?.length ?? 0,
    };
    this.focused = options.focused ?? true;
    this.cursorShape = options.cursorShape ?? 'bar';
    this.cursorBlinking = options.cursorBlinking;
    this.placeholder = options.placeholder;
    this.style = options.style;
    this.placeholderStyle = options.placeholderStyle;
    this.atomicRanges = normalizeAtomicRanges(options.atomicRanges, this.getText());
    this.layoutWidth = normalizeOptionalLayoutWidth(options.layoutWidth);
    this.layoutHeight = normalizeRenderHeight(options.layoutHeight);
    this.selectionStyle = options.selectionStyle;
    this.historyLimit = normalizeHistoryLimit(options.historyLimit);
    this.clampCursor();
    if (options.selection !== undefined) this.setSelection(options.selection);
  }

  getText(): string {
    return this.lines.join('\n');
  }

  setText(text: string): void {
    this.lines = normalizeInputText(text);
    if (!this.multiline && this.lines.length > 1) {
      this.lines = [this.lines.join('')];
    }
    this.truncateToMaxLength();
    this.atomicRanges = normalizeAtomicRanges(this.atomicRanges, this.getText());
    this.cursor = {
      line: this.lines.length - 1,
      column: this.lines.at(-1)?.length ?? 0,
    };
    this.clampCursor();
    this.clearSelection();
    this.draggingSelectionAnchor = undefined;
    this.clearHistory();
  }

  getLines(): readonly string[] {
    return this.lines;
  }

  getCursor(): RendererTextInputCursor {
    return this.cursor;
  }

  setCursor(cursor: RendererTextInputCursor): void {
    this.cursor = cursor;
    this.clampCursor();
    this.clearSelection();
    this.draggingSelectionAnchor = undefined;
    this.clearPreferredDisplayColumn();
  }

  getAtomicRanges(): readonly RendererTextInputAtomicRange[] {
    return this.atomicRanges;
  }

  setAtomicRanges(ranges: readonly RendererTextInputAtomicRange[]): void {
    this.atomicRanges = normalizeAtomicRanges(ranges, this.getText());
    this.clampCursor();
    this.normalizeSelection();
  }

  getSelection(): RendererTextInputSelection | undefined {
    if (this.selectionAnchor === undefined) return undefined;
    const head = this.textOffsetForCursor();
    if (this.selectionAnchor === head) return undefined;
    return { anchor: this.selectionAnchor, head };
  }

  getSelectionRange(): RendererTextInputSelectionRange | undefined {
    return this.selectionRange();
  }

  getSelectedText(): string {
    const range = this.selectionRange();
    if (range === undefined) return '';
    return this.getText().slice(range.start, range.end);
  }

  setSelection(selection: RendererTextInputSelection | undefined): void {
    if (selection === undefined) {
      this.clearSelection();
      return;
    }
    const anchor = this.normalizeSelectionOffset(selection.anchor);
    const head = this.normalizeSelectionOffset(selection.head);
    this.selectionAnchor = anchor;
    this.setCursorFromTextOffset(head, 'nearest');
    if (this.textOffsetForCursor() === anchor) this.clearSelection();
    this.clearPreferredDisplayColumn();
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): boolean {
    const snapshot = this.undoStack.pop();
    if (snapshot === undefined) return false;
    this.redoStack.push(this.createHistorySnapshot());
    this.restoreHistorySnapshot(snapshot);
    return true;
  }

  redo(): boolean {
    const snapshot = this.redoStack.pop();
    if (snapshot === undefined) return false;
    this.undoStack.push(this.createHistorySnapshot());
    this.restoreHistorySnapshot(snapshot);
    return true;
  }

  clearHistory(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  selectAll(): void {
    const length = this.getText().length;
    this.selectionAnchor = 0;
    this.setCursorFromTextOffset(length, 'backward');
    if (length === 0) this.clearSelection();
    this.clearPreferredDisplayColumn();
  }

  setFocused(focused: boolean): void {
    this.focused = focused;
  }

  setLayoutWidth(width: number | undefined): void {
    this.layoutWidth = normalizeOptionalLayoutWidth(width);
  }

  setLayoutHeight(height: number | undefined): void {
    this.layoutHeight = normalizeRenderHeight(height);
  }

  handleInput(event: NativeInputEvent): boolean {
    switch (event.type) {
      case 'paste':
        this.insertText(event.text);
        return true;
      case 'key':
        return this.handleKey(event);
      case 'focus':
      case 'mouse':
      case 'terminal-mode-report':
      case 'unknown':
        return false;
    }
  }

  handleMouse(event: NativeInputMouseEvent, options: RendererTextInputMouseOptions): boolean {
    return handleTextInputMouse(event, options, {
      textOffsetForMouse: (mouseOptions) => this.textOffsetForMouse(mouseOptions),
      textOffsetForCursor: () => this.textOffsetForCursor(),
      selectionAnchor: () => this.selectionAnchor,
      moveCursorToOffset: (offset, bias, extend, anchorOverride) =>
        this.moveCursorToOffset(offset, bias, extend, anchorOverride),
      setCursorFromTextOffset: (offset, bias) => this.setCursorFromTextOffset(offset, bias),
      clearSelection: () => this.clearSelection(),
      clearPreferredDisplayColumn: () => this.clearPreferredDisplayColumn(),
      getDraggingSelectionAnchor: () => this.draggingSelectionAnchor,
      setDraggingSelectionAnchor: (anchor) => {
        this.draggingSelectionAnchor = anchor;
      },
    });
  }

  render(options: RendererTextInputRenderOptions): RendererTextInputRenderResult {
    const width = normalizeRenderWidth(options.width);
    this.layoutWidth = width;
    this.layoutHeight = normalizeRenderHeight(options.height);
    const visualLines = this.createVisualLines(width);
    return renderTextInputFrame(options, {
      visualLines,
      cursor: this.cursor,
      currentLine: this.currentLine(),
      selection: this.selectionRange(),
      focused: this.focused,
      cursorShape: this.cursorShape,
      cursorBlinking: this.cursorBlinking,
      style: this.style,
      placeholderStyle: this.placeholderStyle,
      selectionStyle: this.selectionStyle,
      lineOffset: (line) => this.textOffsetForLine(line),
    });
  }

  private handleKey(event: NativeInputKeyEvent): boolean {
    return dispatchTextInputKey(event, this.keyActions);
  }

  private get keyActions(): RendererTextInputKeyActions {
    return {
      multiline: this.multiline,
      insertText: (text) => this.insertText(text),
      deleteBackward: () => this.deleteBackward(),
      deleteForward: () => this.deleteForward(),
      deleteWordBackward: () => this.deleteWordBackward(),
      deleteWordForward: () => this.deleteWordForward(),
      deleteToLineStart: () => this.deleteToLineStart(),
      deleteToLineEnd: () => this.deleteToLineEnd(),
      moveLeft: (extend) => this.moveLeft(extend),
      moveRight: (extend) => this.moveRight(extend),
      moveWordLeft: (extend) => this.moveWordLeft(extend),
      moveWordRight: (extend) => this.moveWordRight(extend),
      moveVertical: (direction, extend) => this.moveVertical(direction, extend),
      moveParagraph: (direction, extend) => this.moveParagraph(direction, extend),
      movePage: (direction, extend) => this.movePage(direction, extend),
      moveCursorToOffset: (offset, bias, extend) => this.moveCursorToOffset(offset, bias, extend),
      cursorLine: () => this.cursor.line,
      textOffsetForLine: (line) => this.textOffsetForLine(line),
      currentLineLength: () => this.currentLine().length,
      textLength: () => this.getText().length,
      clearPreferredDisplayColumn: () => this.clearPreferredDisplayColumn(),
      selectAll: () => this.selectAll(),
      undo: () => this.undo(),
      redo: () => this.redo(),
    };
  }

  private insertText(text: string): void {
    const normalized = normalizeInsertText(text, this.multiline);
    const result = computeTextInputInsert({
      normalized,
      multiline: this.multiline,
      maxLength: this.maxLength,
      currentText: this.getText(),
      lines: this.lines,
      atomicRanges: this.atomicRanges,
      selection: this.selectionRange(),
      cursorOffset: this.textOffsetForCursor(),
      snapOffset: (offset, bias) => this.snapOffsetOutOfAtomicRange(offset, bias),
    });
    if (result === undefined) return;
    const before = this.createHistorySnapshot();
    this.lines = [...result.lines];
    this.atomicRanges = result.atomicRanges;
    this.clearSelection();
    this.setCursorFromTextOffset(result.nextOffset, 'forward');
    this.clampCursor();
    this.clearPreferredDisplayColumn();
    this.pushUndoSnapshot(before);
  }

  private deleteBackward(): void {
    executeTextInputDelete(this.deleteActions, () =>
      computeCharacterBackwardDelete(this.textOffsetForCursor(), (offset) =>
        this.previousEditableOffset(offset),
      ),
    );
  }

  private deleteForward(): void {
    executeTextInputDelete(this.deleteActions, () =>
      computeCharacterForwardDelete(this.textOffsetForCursor(), this.getText().length, (offset) =>
        this.nextEditableOffset(offset),
      ),
    );
  }

  private moveLeft(extend = false): void {
    const offset = computeMoveLeftOffset(
      this.selectionRange(),
      extend,
      this.textOffsetForCursor(),
      (value) => this.previousEditableOffset(value),
    );
    this.moveCursorToOffset(offset, 'backward', extend);
    this.clearPreferredDisplayColumn();
  }

  private moveRight(extend = false): void {
    const offset = computeMoveRightOffset(
      this.selectionRange(),
      extend,
      this.textOffsetForCursor(),
      (value) => this.nextEditableOffset(value),
    );
    this.moveCursorToOffset(offset, 'forward', extend);
    this.clearPreferredDisplayColumn();
  }

  private moveWordLeft(extend = false): void {
    const offset = computeMoveWordLeftOffset(
      this.selectionRange(),
      extend,
      this.textOffsetForCursor(),
      (value) => this.previousWordOffset(value),
    );
    this.moveCursorToOffset(offset, 'backward', extend);
    this.clearPreferredDisplayColumn();
  }

  private moveWordRight(extend = false): void {
    const offset = computeMoveWordRightOffset(
      this.selectionRange(),
      extend,
      this.textOffsetForCursor(),
      (value) => this.nextWordOffset(value),
    );
    this.moveCursorToOffset(offset, 'forward', extend);
    this.clearPreferredDisplayColumn();
  }

  private deleteWordBackward(): void {
    executeTextInputDelete(this.deleteActions, () =>
      computeWordBackwardDelete(this.textOffsetForCursor(), (offset) => this.previousWordOffset(offset)),
    );
  }

  private deleteWordForward(): void {
    executeTextInputDelete(this.deleteActions, () =>
      computeWordForwardDelete(this.textOffsetForCursor(), (offset) => this.nextWordOffset(offset)),
    );
  }

  private deleteToLineStart(): void {
    executeTextInputDelete(this.deleteActions, () =>
      computeLineStartDelete(this.textOffsetForLine(this.cursor.line), this.textOffsetForCursor()),
    );
  }

  private deleteToLineEnd(): void {
    executeTextInputDelete(this.deleteActions, () =>
      computeLineEndDelete(
        this.textOffsetForCursor(),
        this.textOffsetForLine(this.cursor.line) + this.currentLine().length,
      ),
    );
  }

  private moveVertical(direction: -1 | 1, extend = false): void {
    moveTextInputVertical(direction, extend, this.verticalMoveActions);
  }

  private moveParagraph(direction: -1 | 1, extend = false): void {
    moveTextInputParagraph(direction, extend, this.verticalMoveActions);
  }

  private movePage(direction: -1 | 1, extend = false): void {
    moveTextInputPage(direction, extend, this.verticalMoveActions);
  }

  private get deleteActions() {
    return {
      createHistorySnapshot: () => this.createHistorySnapshot(),
      deleteSelection: () => this.deleteSelection(),
      applyDeleteRange: (range: { readonly start: number; readonly end: number; readonly cursorOffset: number; readonly bias: AtomicCursorBias }) =>
        this.applyDeleteRange(range),
      clearPreferredDisplayColumn: () => this.clearPreferredDisplayColumn(),
      pushUndoSnapshot: (snapshot: RendererTextInputHistorySnapshot) => this.pushUndoSnapshot(snapshot),
    };
  }

  private get verticalMoveActions() {
    return {
      lines: this.lines,
      cursor: this.cursor,
      layoutWidth: this.layoutWidth,
      layoutHeight: this.layoutHeight,
      preferredDisplayColumn: this.preferredDisplayColumn,
      createVisualLines: (width: number) => this.createVisualLines(width),
      visualLineIndexForCursor: (visualLines: readonly VisualLine[]) =>
        this.visualLineIndexForCursor(visualLines),
      textLength: () => this.getText().length,
      applyNavigationMove: (move: NavigationMoveResult, extend: boolean) =>
        this.applyNavigationMove(move, extend),
    };
  }

  private applyNavigationMove(move: NavigationMoveResult, extend: boolean): void {
    if (move.clearPreferred) this.clearPreferredDisplayColumn();
    else if (move.preferredColumn !== undefined) this.preferredDisplayColumn = move.preferredColumn;
    this.moveCursorToOffset(move.offset, move.bias, extend);
  }

  private createVisualLines(width: number): readonly VisualLine[] {
    return buildVisualLines(this.lines, this.placeholder, width);
  }

  private visualLineIndexForCursor(visualLines: readonly VisualLine[]): number {
    return computeVisualLineIndexForCursor(this.cursor, visualLines);
  }

  private currentLine(): string {
    return this.lines[this.cursor.line] ?? '';
  }

  private applyDeleteRange(range: { readonly start: number; readonly end: number; readonly cursorOffset: number; readonly bias: AtomicCursorBias }): void {
    this.deleteTextRange(range.start, range.end);
    this.setCursorFromTextOffset(range.cursorOffset, range.bias);
  }

  private deleteSelection(): boolean {
    const selection = this.selectionRange();
    if (selection === undefined) return false;
    this.deleteTextRange(selection.start, selection.end);
    this.setCursorFromTextOffset(selection.start, 'backward');
    this.clearSelection();
    return true;
  }

  private deleteTextRange(start: number, end: number): void {
    if (end <= start) return;
    const text = this.getText();
    this.lines = normalizeInputText(text.slice(0, start) + text.slice(end));
    this.atomicRanges = shiftAtomicRangesAfterDelete(this.atomicRanges, start, end);
  }

  private textOffsetForCursor(): number {
    return computeOffsetForCursor(this.lines, this.cursor);
  }

  private textOffsetForLine(line: number): number {
    return computeOffsetForLine(this.lines, line);
  }

  private cursorForTextOffset(offset: number): RendererTextInputCursor {
    return computeCursorForOffset(this.lines, offset);
  }

  private truncateToMaxLength(): void {
    if (this.maxLength === undefined) return;
    const text = this.getText();
    if (text.length <= this.maxLength) return;
    this.lines = normalizeInputText(text.slice(0, this.maxLength));
    this.atomicRanges = normalizeAtomicRanges(this.atomicRanges, this.getText());
  }

  private previousEditableOffset(offset: number): number {
    return findPreviousEditableOffset(this.getText(), this.atomicRanges, offset);
  }

  private nextEditableOffset(offset: number): number {
    return findNextEditableOffset(this.getText(), this.atomicRanges, offset);
  }

  private previousWordOffset(offset: number): number {
    return this.snapOffsetOutOfAtomicRange(previousWordBoundary(this.getText(), offset), 'backward');
  }

  private nextWordOffset(offset: number): number {
    return this.snapOffsetOutOfAtomicRange(nextWordBoundary(this.getText(), offset), 'forward');
  }

  private setCursorFromTextOffset(offset: number, bias: AtomicCursorBias): void {
    this.cursor = this.cursorForTextOffset(this.snapOffsetOutOfAtomicRange(offset, bias));
  }

  private moveCursorToOffset(
    offset: number,
    bias: AtomicCursorBias,
    extend: boolean,
    anchorOverride?: number,
  ): void {
    const anchor = extend ? (anchorOverride ?? this.selectionAnchor ?? this.textOffsetForCursor()) : undefined;
    this.setCursorFromTextOffset(offset, bias);
    if (anchor === undefined) {
      this.clearSelection();
      return;
    }
    this.selectionAnchor = anchor === this.textOffsetForCursor() ? undefined : anchor;
  }

  private snapOffsetOutOfAtomicRange(offset: number, bias: AtomicCursorBias): number {
    return clampOffsetOutsideAtomicRange(this.getText(), this.atomicRanges, offset, bias);
  }

  private clampCursor(bias: AtomicCursorBias = 'nearest'): void {
    const line = Math.max(0, Math.min(this.lines.length - 1, Math.floor(this.cursor.line)));
    const text = this.lines[line] ?? '';
    const column = snapColumnToBoundary(text, this.cursor.column);
    this.cursor = { line, column };
    this.setCursorFromTextOffset(this.textOffsetForCursor(), bias);
  }

  private selectionRange(): RendererTextInputSelectionRange | undefined {
    if (this.selectionAnchor === undefined) return undefined;
    const head = this.textOffsetForCursor();
    if (head === this.selectionAnchor) return undefined;
    return this.expandRangeToAtomicBoundaries(
      Math.min(this.selectionAnchor, head),
      Math.max(this.selectionAnchor, head),
    );
  }

  private expandRangeToAtomicBoundaries(start: number, end: number): RendererTextInputSelectionRange {
    return expandToAtomicBoundaries(this.atomicRanges, start, end);
  }

  private normalizeSelection(): void {
    const selection = this.getSelection();
    if (selection === undefined) {
      this.clearSelection();
      return;
    }
    this.setSelection(selection);
  }

  private normalizeSelectionOffset(offset: number): number {
    const text = this.getText();
    return this.snapOffsetOutOfAtomicRange(snapTextOffsetToBoundary(text, offset, 'nearest'), 'nearest');
  }

  private textOffsetForMouse(options: RendererTextInputMouseOptions): number {
    const resolved = resolveTextInputMouseOffset(
      this.createVisualLines(normalizeRenderWidth(options.width ?? this.layoutWidth ?? 1)),
      options,
      this.layoutWidth,
      (line) => this.textOffsetForLine(line),
    );
    this.layoutWidth = resolved.width;
    return resolved.offset;
  }

  private createHistorySnapshot(): RendererTextInputHistorySnapshot {
    return createTextInputHistorySnapshot({
      lines: this.lines,
      cursor: this.cursor,
      atomicRanges: this.atomicRanges,
      selectionAnchor: this.selectionAnchor,
    });
  }

  private restoreHistorySnapshot(snapshot: RendererTextInputHistorySnapshot): void {
    const restored = restoreTextInputHistorySnapshot(snapshot);
    this.lines = restored.lines;
    this.cursor = restored.cursor;
    this.atomicRanges = restored.atomicRanges;
    this.selectionAnchor = restored.selectionAnchor;
    this.clampCursor();
    this.normalizeSelection();
    this.clearPreferredDisplayColumn();
  }

  private pushUndoSnapshot(snapshot: RendererTextInputHistorySnapshot): void {
    const stacks = pushTextInputUndoSnapshot(
      this.undoStack,
      this.redoStack,
      snapshot,
      this.createHistorySnapshot(),
      this.historyLimit,
    );
    this.undoStack = stacks.undoStack;
    this.redoStack = stacks.redoStack;
  }

  private clearPreferredDisplayColumn(): void {
    this.preferredDisplayColumn = undefined;
  }

  private clearSelection(): void {
    this.selectionAnchor = undefined;
  }
}
