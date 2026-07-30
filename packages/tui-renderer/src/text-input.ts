import type { RendererCellStyle } from './cell-buffer';
import type { RendererRegionLine } from './compositor';
import type { NativeInputEvent, NativeInputKeyEvent, NativeInputMouseEvent } from './input-events';
import type { RendererCursorShape, RendererCursorState } from './terminal-output';
import {
  cloneAtomicRange,
  historySnapshotsEqual,
  normalizeAtomicRanges,
  shiftAtomicRangesAfterDelete,
  shiftAtomicRangesAfterInsert,
  type RendererTextInputHistorySnapshot,
} from './text-input-edit';
import {
  buildVisualLines,
  composeGhostLine,
  computeCursorVisualPosition,
  computeVisualLineIndexForCursor,
  normalizeHistoryLimit,
  normalizeInputText,
  normalizeMaxLength,
  normalizeMouseCoordinate,
  normalizeOptionalLayoutWidth,
  normalizeRenderHeight,
  normalizeRenderWidth,
  normalizeViewportRow,
  renderVisualLineCells,
  type VisualLine,
} from './text-input-layout';
import {
  clampOffsetOutsideAtomicRange,
  computeCursorForOffset,
  computeOffsetForCursor,
  computeOffsetForLine,
  expandToAtomicBoundaries,
  findContainingAtomicRange,
  findNextEditableOffset,
  findPreviousEditableOffset,
} from './text-input-offsets';
import {
  nextWordBoundary,
  previousWordBoundary,
  snapColumnToBoundary,
  snapTextOffsetToBoundary,
  type AtomicCursorBias,
} from './text-input-selection';
import {
  dispatchTextInputKey,
  type RendererTextInputKeyActions,
} from './text-input-key-dispatch';
import {
  computeHardLineVerticalMoveOffset,
  computeMouseTextOffset,
  computePageMoveOffset,
  computeParagraphMoveOffset,
  computeVisualLineMoveOffset,
  type NavigationMoveResult,
} from './text-input-navigation';

export interface RendererTextInputOptions {
  readonly text?: string;
  readonly multiline?: boolean;
  readonly focused?: boolean;
  readonly cursorShape?: RendererCursorShape;
  readonly cursorBlinking?: boolean;
  readonly maxLength?: number;
  readonly placeholder?: string;
  readonly style?: RendererCellStyle;
  readonly placeholderStyle?: RendererCellStyle;
  readonly atomicRanges?: readonly RendererTextInputAtomicRange[];
  readonly layoutWidth?: number;
  readonly selection?: RendererTextInputSelection;
  readonly selectionStyle?: RendererCellStyle;
  readonly historyLimit?: number;
  readonly layoutHeight?: number;
}

export interface RendererTextInputCursor {
  readonly line: number;
  readonly column: number;
}

export interface RendererTextInputAtomicRange {
  readonly start: number;
  readonly end: number;
  readonly id?: string;
}

export interface RendererTextInputSelection {
  readonly anchor: number;
  readonly head: number;
}

export interface RendererTextInputSelectionRange {
  readonly start: number;
  readonly end: number;
}

export interface RendererTextInputRenderOptions {
  readonly width: number;
  readonly height?: number;
  readonly focused?: boolean;
  readonly style?: RendererCellStyle;
  readonly placeholderStyle?: RendererCellStyle;
  readonly selectionStyle?: RendererCellStyle;
  /**
   * Optional "ghost" text rendered dimmed right after the cursor (inline
   * autocomplete / next-task suggestion). Tab acceptance is handled by the
   * editor layer; this only paints the preview cells.
   */
  readonly ghostText?: string;
  readonly ghostStyle?: RendererCellStyle;
}

export interface RendererTextInputMouseOptions {
  readonly x: number;
  readonly y: number;
  readonly width?: number;
  readonly viewportRow?: number;
}

export interface RendererTextInputRenderResult {
  readonly lines: readonly RendererRegionLine[];
  readonly cursor: RendererCursorState;
  readonly contentRows: number;
  readonly viewportRow: number;
}

const DEFAULT_SELECTION_STYLE: RendererCellStyle = { inverse: true };

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
    if (event.button !== 'left' && event.button !== 'none') return false;
    if (event.action !== 'press' && event.action !== 'drag' && event.action !== 'release') return false;

    const offset = this.textOffsetForMouse(options);
    if (event.action === 'release') {
      if (this.draggingSelectionAnchor === undefined) return false;
      this.moveCursorToOffset(offset, 'nearest', true, this.draggingSelectionAnchor);
      this.draggingSelectionAnchor = undefined;
      this.clearPreferredDisplayColumn();
      return true;
    }

    if (event.action === 'press') {
      if (event.shift) {
        this.moveCursorToOffset(offset, 'nearest', true);
      } else {
        this.clearSelection();
        this.setCursorFromTextOffset(offset, 'nearest');
      }
      this.draggingSelectionAnchor = this.selectionAnchor ?? this.textOffsetForCursor();
      this.clearPreferredDisplayColumn();
      return true;
    }

    this.draggingSelectionAnchor ??= this.selectionAnchor ?? this.textOffsetForCursor();
    this.moveCursorToOffset(offset, 'nearest', true, this.draggingSelectionAnchor);
    this.clearPreferredDisplayColumn();
    return true;
  }

  render(options: RendererTextInputRenderOptions): RendererTextInputRenderResult {
    const width = normalizeRenderWidth(options.width);
    this.layoutWidth = width;
    const focused = options.focused ?? this.focused;
    const style = options.style ?? this.style;
    const placeholderStyle = options.placeholderStyle ?? this.placeholderStyle;
    const selectionStyle = options.selectionStyle ?? this.selectionStyle ?? DEFAULT_SELECTION_STYLE;
    const visualLines = this.createVisualLines(width);
    const selection = this.selectionRange();
    const absoluteCursor = this.cursorToVisualPosition(visualLines);
    const height = normalizeRenderHeight(options.height);
    this.layoutHeight = height;
    const viewportRow = height === undefined
      ? 0
      : Math.min(
          Math.max(0, absoluteCursor.y - height + 1),
          Math.max(0, visualLines.length - height),
        );
    const visibleLines =
      height === undefined ? visualLines : visualLines.slice(viewportRow, viewportRow + height);

    const cursor: {
      x: number;
      y: number;
      visible: boolean;
      shape: RendererCursorShape;
      blinking?: boolean;
    } = {
      x: absoluteCursor.x,
      y: Math.max(0, absoluteCursor.y - viewportRow),
      visible: focused,
      shape: this.cursorShape,
    };
    if (this.cursorBlinking !== undefined) cursor.blinking = this.cursorBlinking;

    const lines: RendererRegionLine[] = visibleLines.map((line) =>
      this.renderVisualLine(line, {
        style,
        placeholderStyle,
        selectionStyle,
        selection,
      }),
    );

    const ghostText = options.ghostText;
    if (ghostText !== undefined && ghostText.length > 0 && selection === undefined) {
      const ghostRow = absoluteCursor.y - viewportRow;
      if (ghostRow >= 0 && ghostRow < lines.length) {
        lines[ghostRow] = composeGhostLine(
          lines[ghostRow] ?? [],
          absoluteCursor.x,
          ghostText,
          options.ghostStyle,
          width,
        );
      }
    }

    return {
      lines,
      cursor,
      contentRows: visualLines.length,
      viewportRow,
    };
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
    const normalized = this.multiline
      ? text.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
      : text.replaceAll(/[\r\n]/g, '');
    if (normalized.length === 0) return;
    const before = this.createHistorySnapshot();
    const current = this.getText();
    const selection = this.selectionRange();
    const insertAt =
      selection?.start ?? this.snapOffsetOutOfAtomicRange(this.textOffsetForCursor(), 'forward');
    const replaceEnd = selection?.end ?? insertAt;
    const selectedLength = replaceEnd - insertAt;
    const maxInsertLength =
      this.maxLength === undefined
        ? normalized.length
        : Math.max(0, this.maxLength - (current.length - selectedLength));
    if (maxInsertLength === 0 && selectedLength === 0) return;
    const nextText =
      current.slice(0, insertAt) +
      normalized.slice(0, maxInsertLength) +
      current.slice(replaceEnd);
    const nextOffset = insertAt + Math.min(normalized.length, maxInsertLength);
    this.lines = normalizeInputText(nextText);
    const rangesAfterDelete =
      selection === undefined
        ? this.atomicRanges
        : shiftAtomicRangesAfterDelete(this.atomicRanges, selection.start, selection.end);
    this.atomicRanges = shiftAtomicRangesAfterInsert(rangesAfterDelete, insertAt, nextOffset - insertAt);
    this.clearSelection();
    this.setCursorFromTextOffset(nextOffset, 'forward');
    this.clampCursor();
    this.clearPreferredDisplayColumn();
    this.pushUndoSnapshot(before);
  }

  private deleteBackward(): void {
    const before = this.createHistorySnapshot();
    if (this.deleteSelection()) {
      this.clearPreferredDisplayColumn();
      this.pushUndoSnapshot(before);
      return;
    }
    const end = this.textOffsetForCursor();
    if (end <= 0) return;
    const start = this.previousEditableOffset(end);
    this.deleteTextRange(start, end);
    this.setCursorFromTextOffset(start, 'backward');
    this.clearPreferredDisplayColumn();
    this.pushUndoSnapshot(before);
  }

  private deleteForward(): void {
    const before = this.createHistorySnapshot();
    if (this.deleteSelection()) {
      this.clearPreferredDisplayColumn();
      this.pushUndoSnapshot(before);
      return;
    }
    const start = this.textOffsetForCursor();
    const text = this.getText();
    if (start >= text.length) return;
    const end = this.nextEditableOffset(start);
    this.deleteTextRange(start, end);
    this.setCursorFromTextOffset(start, 'forward');
    this.clearPreferredDisplayColumn();
    this.pushUndoSnapshot(before);
  }

  private moveLeft(extend = false): void {
    const selection = this.selectionRange();
    const offset =
      !extend && selection !== undefined
        ? selection.start
        : this.previousEditableOffset(this.textOffsetForCursor());
    this.moveCursorToOffset(offset, 'backward', extend);
    this.clearPreferredDisplayColumn();
  }

  private moveRight(extend = false): void {
    const selection = this.selectionRange();
    const offset =
      !extend && selection !== undefined
        ? selection.end
        : this.nextEditableOffset(this.textOffsetForCursor());
    this.moveCursorToOffset(offset, 'forward', extend);
    this.clearPreferredDisplayColumn();
  }

  private moveWordLeft(extend = false): void {
    const selection = this.selectionRange();
    const offset =
      !extend && selection !== undefined
        ? selection.start
        : this.previousWordOffset(this.textOffsetForCursor());
    this.moveCursorToOffset(offset, 'backward', extend);
    this.clearPreferredDisplayColumn();
  }

  private moveWordRight(extend = false): void {
    const selection = this.selectionRange();
    const offset =
      !extend && selection !== undefined
        ? selection.end
        : this.nextWordOffset(this.textOffsetForCursor());
    this.moveCursorToOffset(offset, 'forward', extend);
    this.clearPreferredDisplayColumn();
  }

  private deleteWordBackward(): void {
    const before = this.createHistorySnapshot();
    if (this.deleteSelection()) {
      this.clearPreferredDisplayColumn();
      this.pushUndoSnapshot(before);
      return;
    }
    const end = this.textOffsetForCursor();
    const start = this.previousWordOffset(end);
    if (start === end) return;
    this.deleteTextRange(start, end);
    this.setCursorFromTextOffset(start, 'backward');
    this.clearPreferredDisplayColumn();
    this.pushUndoSnapshot(before);
  }

  private deleteWordForward(): void {
    const before = this.createHistorySnapshot();
    if (this.deleteSelection()) {
      this.clearPreferredDisplayColumn();
      this.pushUndoSnapshot(before);
      return;
    }
    const start = this.textOffsetForCursor();
    const end = this.nextWordOffset(start);
    if (start === end) return;
    this.deleteTextRange(start, end);
    this.setCursorFromTextOffset(start, 'forward');
    this.clearPreferredDisplayColumn();
    this.pushUndoSnapshot(before);
  }

  private deleteToLineStart(): void {
    const before = this.createHistorySnapshot();
    if (this.deleteSelection()) {
      this.clearPreferredDisplayColumn();
      this.pushUndoSnapshot(before);
      return;
    }
    const start = this.textOffsetForLine(this.cursor.line);
    const end = this.textOffsetForCursor();
    if (start === end) return;
    this.deleteTextRange(start, end);
    this.setCursorFromTextOffset(start, 'backward');
    this.clearPreferredDisplayColumn();
    this.pushUndoSnapshot(before);
  }

  private deleteToLineEnd(): void {
    const before = this.createHistorySnapshot();
    if (this.deleteSelection()) {
      this.clearPreferredDisplayColumn();
      this.pushUndoSnapshot(before);
      return;
    }
    const start = this.textOffsetForCursor();
    const end = this.textOffsetForLine(this.cursor.line) + this.currentLine().length;
    if (start === end) return;
    this.deleteTextRange(start, end);
    this.setCursorFromTextOffset(start, 'forward');
    this.clearPreferredDisplayColumn();
    this.pushUndoSnapshot(before);
  }

  private moveVertical(direction: -1 | 1, extend = false): void {
    if (this.moveVisualLine(direction, extend)) return;
    const move = computeHardLineVerticalMoveOffset(
      this.lines,
      this.cursor,
      direction,
      this.preferredDisplayColumn,
    );
    if (move === undefined) return;
    this.applyNavigationMove(move, extend);
  }

  private moveVisualLine(direction: -1 | 1, extend: boolean): boolean {
    const width = this.layoutWidth;
    if (width === undefined || width <= 0) return false;
    const visualLines = this.createVisualLines(width);
    if (visualLines.length === 0) return false;
    const move = computeVisualLineMoveOffset(
      this.lines,
      this.cursor,
      visualLines,
      this.visualLineIndexForCursor(visualLines),
      direction,
      this.preferredDisplayColumn,
    );
    if (move === undefined) return false;
    this.applyNavigationMove(move, extend);
    return true;
  }

  private moveParagraph(direction: -1 | 1, extend = false): void {
    const move = computeParagraphMoveOffset(
      this.lines,
      this.cursor,
      direction,
      this.getText().length,
      this.preferredDisplayColumn,
    );
    this.applyNavigationMove(move, extend);
  }

  private movePage(direction: -1 | 1, extend = false): void {
    const pageRows = Math.max(1, this.layoutHeight ?? 1);
    const width = this.layoutWidth;
    const visualLines = width === undefined ? [] : this.createVisualLines(width);
    const move = computePageMoveOffset(
      this.lines,
      this.cursor,
      visualLines,
      width === undefined ? 0 : this.visualLineIndexForCursor(visualLines),
      direction,
      pageRows,
      width,
      this.preferredDisplayColumn,
    );
    this.applyNavigationMove(move, extend);
  }

  private applyNavigationMove(move: NavigationMoveResult, extend: boolean): void {
    if (move.clearPreferred) this.clearPreferredDisplayColumn();
    else if (move.preferredColumn !== undefined) this.preferredDisplayColumn = move.preferredColumn;
    this.moveCursorToOffset(move.offset, move.bias, extend);
  }

  private createVisualLines(width: number): readonly VisualLine[] {
    return buildVisualLines(this.lines, this.placeholder, width);
  }

  private cursorToVisualPosition(visualLines: readonly VisualLine[]): { readonly x: number; readonly y: number } {
    return computeCursorVisualPosition(this.cursor, this.currentLine(), visualLines);
  }

  private visualLineIndexForCursor(visualLines: readonly VisualLine[]): number {
    return computeVisualLineIndexForCursor(this.cursor, visualLines);
  }

  private renderVisualLine(
    line: VisualLine,
    options: {
      readonly style: RendererCellStyle | undefined;
      readonly placeholderStyle: RendererCellStyle | undefined;
      readonly selectionStyle: RendererCellStyle;
      readonly selection: RendererTextInputSelectionRange | undefined;
    },
  ): RendererRegionLine {
    return renderVisualLineCells(line, this.textOffsetForLine(line.logicalLine), options);
  }

  private currentLine(): string {
    return this.lines[this.cursor.line] ?? '';
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

  private atomicRangeContainingOffset(offset: number): RendererTextInputAtomicRange | undefined {
    return findContainingAtomicRange(this.atomicRanges, offset);
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
    const width = normalizeRenderWidth(options.width ?? this.layoutWidth ?? 1);
    this.layoutWidth = width;
    const visualLines = this.createVisualLines(width);
    return computeMouseTextOffset(
      visualLines,
      normalizeViewportRow(options.viewportRow),
      normalizeMouseCoordinate(options.x),
      normalizeMouseCoordinate(options.y),
      (line) => this.textOffsetForLine(line),
    );
  }

  private createHistorySnapshot(): RendererTextInputHistorySnapshot {
    const snapshot: {
      lines: readonly string[];
      cursor: RendererTextInputCursor;
      atomicRanges: readonly RendererTextInputAtomicRange[];
      selectionAnchor?: number;
    } = {
      lines: [...this.lines],
      cursor: { ...this.cursor },
      atomicRanges: this.atomicRanges.map(cloneAtomicRange),
    };
    if (this.selectionAnchor !== undefined) snapshot.selectionAnchor = this.selectionAnchor;
    return snapshot;
  }

  private restoreHistorySnapshot(snapshot: RendererTextInputHistorySnapshot): void {
    this.lines = [...snapshot.lines];
    this.cursor = { ...snapshot.cursor };
    this.atomicRanges = snapshot.atomicRanges.map(cloneAtomicRange);
    this.selectionAnchor = snapshot.selectionAnchor;
    this.clampCursor();
    this.normalizeSelection();
    this.clearPreferredDisplayColumn();
  }

  private pushUndoSnapshot(snapshot: RendererTextInputHistorySnapshot): void {
    if (this.historyLimit <= 0 || historySnapshotsEqual(snapshot, this.createHistorySnapshot())) return;
    this.undoStack.push(snapshot);
    if (this.undoStack.length > this.historyLimit) {
      this.undoStack.splice(0, this.undoStack.length - this.historyLimit);
    }
    this.redoStack = [];
  }

  private clearPreferredDisplayColumn(): void {
    this.preferredDisplayColumn = undefined;
  }

  private clearSelection(): void {
    this.selectionAnchor = undefined;
  }
}

