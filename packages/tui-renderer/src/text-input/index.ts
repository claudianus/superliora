import type { RendererCellStyle } from '../cell-buffer/index';
import type { NativeInputEvent, NativeInputKeyEvent, NativeInputMouseEvent } from '../input-events/index';
import type { RendererTextInputHistorySnapshot } from './edit';
import { normalizeAtomicRanges } from './edit';
import {
  handleTextInputMouse,
} from './mouse';
import { renderTextInputFrame } from './render';
import type { RendererCursorShape } from '../terminal/output';
import {
  dispatchTextInputKey,
  type RendererTextInputKeyActions,
} from './key-dispatch';
import {
  createTextInputHistorySnapshot,
  pushTextInputUndoSnapshot,
  restoreTextInputHistorySnapshot,
} from './history';
import {
  buildVisualLines,
  normalizeHistoryLimit,
  normalizeInputText,
  normalizeMaxLength,
  normalizeOptionalLayoutWidth,
  normalizeRenderHeight,
  normalizeRenderWidth,
  type VisualLine,
} from './layout';
import type { AtomicCursorBias } from './selection';
import type {
  RendererTextInputAtomicRange,
  RendererTextInputCursor,
  RendererTextInputMouseOptions,
  RendererTextInputOptions,
  RendererTextInputRenderOptions,
  RendererTextInputRenderResult,
  RendererTextInputSelection,
  RendererTextInputSelectionRange,
} from './types';
import {
  clampCursorState,
  getSelectionState,
  moveCursorToOffsetState,
  normalizeSelectionState,
  restoreHistorySnapshotState,
  selectionRangeState,
  setCursorFromTextOffsetState,
  setSelectionState,
  snapOffsetOutOfAtomicRangeState,
  textOffsetForCursorState,
  textOffsetForMouseState,
  type TextInputCursorSelectionState,
} from './cursor-selection';
import {
  deleteTextInputBackward,
  deleteTextInputForward,
  deleteTextInputToLineEnd,
  deleteTextInputToLineStart,
  deleteTextInputWordBackward,
  deleteTextInputWordForward,
  insertTextInputContent,
  moveTextInputLeft,
  moveTextInputPageDirection,
  moveTextInputParagraphDirection,
  moveTextInputRight,
  moveTextInputVerticalDirection,
  moveTextInputWordLeft,
  moveTextInputWordRight,
  type TextInputEditingHost,
} from './editing-actions';
import { computeOffsetForLine } from './offsets';

export type {
  RendererTextInputAtomicRange,
  RendererTextInputCursor,
  RendererTextInputMouseOptions,
  RendererTextInputOptions,
  RendererTextInputRenderOptions,
  RendererTextInputRenderResult,
  RendererTextInputSelection,
  RendererTextInputSelectionRange,
} from './types';

export class RendererTextInput {
  private lines: string[];
  cursor: RendererTextInputCursor = { line: 0, column: 0 };
  private readonly multiline: boolean;
  private readonly maxLength: number | undefined;
  private focused: boolean;
  private cursorShape: RendererCursorShape;
  private cursorBlinking: boolean | undefined;
  placeholder: string | undefined;
  private style: RendererCellStyle | undefined;
  private placeholderStyle: RendererCellStyle | undefined;
  atomicRanges: readonly RendererTextInputAtomicRange[] = [];
  layoutWidth: number | undefined;
  layoutHeight: number | undefined;
  preferredDisplayColumn: number | undefined;
  selectionAnchor: number | undefined;
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
    clampCursorState(this.cursorSelectionHost);
    if (options.selection !== undefined) this.setSelection(options.selection);
  }

  getText(): string {
    return this.lines.join('\n');
  }

  setLines(lines: string[]): void {
    this.lines = lines;
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
    clampCursorState(this.cursorSelectionHost);
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
    clampCursorState(this.cursorSelectionHost);
    this.clearSelection();
    this.draggingSelectionAnchor = undefined;
    this.clearPreferredDisplayColumn();
  }

  getAtomicRanges(): readonly RendererTextInputAtomicRange[] {
    return this.atomicRanges;
  }

  setAtomicRanges(ranges: readonly RendererTextInputAtomicRange[]): void {
    this.atomicRanges = normalizeAtomicRanges(ranges, this.getText());
    clampCursorState(this.cursorSelectionHost);
    normalizeSelectionState(this.cursorSelectionHost);
  }

  getSelection(): RendererTextInputSelection | undefined {
    return getSelectionState(this.cursorSelectionHost);
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
    setSelectionState(this.cursorSelectionHost, selection);
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
        insertTextInputContent(this.editingHost, event.text);
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
      moveCursorToOffset: (offset, bias, extend, anchorOverride) =>{ 
        this.moveCursorToOffset(offset, bias, extend, anchorOverride); },
      setCursorFromTextOffset: (offset, bias) =>{  this.setCursorFromTextOffset(offset, bias); },
      clearSelection: () =>{  this.clearSelection(); },
      clearPreferredDisplayColumn: () =>{  this.clearPreferredDisplayColumn(); },
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

  createVisualLines(width: number): readonly VisualLine[] {
    return buildVisualLines(this.lines, this.placeholder, width);
  }

  textOffsetForLine(line: number): number {
    return computeOffsetForLine(this.lines, line);
  }

  clearSelection(): void {
    this.selectionAnchor = undefined;
  }

  clearPreferredDisplayColumn(): void {
    this.preferredDisplayColumn = undefined;
  }

  private get cursorSelectionHost(): TextInputCursorSelectionState {
    return this as unknown as TextInputCursorSelectionState;
  }

  private get editingHost(): TextInputEditingHost {
    return this as unknown as TextInputEditingHost;
  }

  private handleKey(event: NativeInputKeyEvent): boolean {
    return dispatchTextInputKey(event, this.keyActions);
  }

  private get keyActions(): RendererTextInputKeyActions {
    return {
      multiline: this.multiline,
      insertText: (text) =>{  insertTextInputContent(this.editingHost, text); },
      deleteBackward: () =>{  deleteTextInputBackward(this.editingHost); },
      deleteForward: () =>{  deleteTextInputForward(this.editingHost); },
      deleteWordBackward: () =>{  deleteTextInputWordBackward(this.editingHost); },
      deleteWordForward: () =>{  deleteTextInputWordForward(this.editingHost); },
      deleteToLineStart: () =>{  deleteTextInputToLineStart(this.editingHost); },
      deleteToLineEnd: () =>{  deleteTextInputToLineEnd(this.editingHost); },
      moveLeft: (extend) =>{  moveTextInputLeft(this.editingHost, extend); },
      moveRight: (extend) =>{  moveTextInputRight(this.editingHost, extend); },
      moveWordLeft: (extend) =>{  moveTextInputWordLeft(this.editingHost, extend); },
      moveWordRight: (extend) =>{  moveTextInputWordRight(this.editingHost, extend); },
      moveVertical: (direction, extend) =>{  moveTextInputVerticalDirection(this.editingHost, direction, extend); },
      moveParagraph: (direction, extend) =>{  moveTextInputParagraphDirection(this.editingHost, direction, extend); },
      movePage: (direction, extend) =>{  moveTextInputPageDirection(this.editingHost, direction, extend); },
      moveCursorToOffset: (offset, bias, extend) =>{  this.moveCursorToOffset(offset, bias, extend); },
      cursorLine: () => this.cursor.line,
      textOffsetForLine: (line) => this.textOffsetForLine(line),
      currentLineLength: () => this.currentLine().length,
      textLength: () => this.getText().length,
      clearPreferredDisplayColumn: () =>{  this.clearPreferredDisplayColumn(); },
      selectAll: () =>{  this.selectAll(); },
      undo: () => this.undo(),
      redo: () => this.redo(),
    };
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

  private truncateToMaxLength(): void {
    if (this.maxLength === undefined) return;
    const text = this.getText();
    if (text.length <= this.maxLength) return;
    this.lines = normalizeInputText(text.slice(0, this.maxLength));
    this.atomicRanges = normalizeAtomicRanges(this.atomicRanges, this.getText());
  }

  private currentLine(): string {
    return this.lines[this.cursor.line] ?? '';
  }

  private setCursorFromTextOffset(offset: number, bias: AtomicCursorBias): void {
    setCursorFromTextOffsetState(this.cursorSelectionHost, offset, bias);
  }

  private moveCursorToOffset(
    offset: number,
    bias: AtomicCursorBias,
    extend: boolean,
    anchorOverride?: number,
  ): void {
    moveCursorToOffsetState(this.cursorSelectionHost, offset, bias, extend, anchorOverride);
  }

  private snapOffsetOutOfAtomicRange(offset: number, bias: AtomicCursorBias): number {
    return snapOffsetOutOfAtomicRangeState(this.cursorSelectionHost, offset, bias);
  }

  private selectionRange(): RendererTextInputSelectionRange | undefined {
    return selectionRangeState(this.cursorSelectionHost);
  }

  private textOffsetForCursor(): number {
    return textOffsetForCursorState(this.cursorSelectionHost);
  }

  private textOffsetForMouse(options: RendererTextInputMouseOptions): number {
    return textOffsetForMouseState(this.cursorSelectionHost, options);
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
    restoreHistorySnapshotState(this.cursorSelectionHost, snapshot, restoreTextInputHistorySnapshot);
  }
}
