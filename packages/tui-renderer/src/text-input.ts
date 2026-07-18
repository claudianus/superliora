import type { RendererCell, RendererCellStyle } from './cell-buffer';
import type { RendererRegionLine } from './compositor';
import type { NativeInputEvent, NativeInputKeyEvent, NativeInputMouseEvent } from './input-events';
import type { RendererCursorShape, RendererCursorState } from './terminal-output';
import { displayClusterWidth, measureDisplayWidth, textToCells } from './text-metrics';

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

interface TextCluster {
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly width: number;
}

interface VisualLine {
  readonly text: string;
  readonly logicalLine: number;
  readonly start: number;
  readonly end: number;
  readonly width: number;
  readonly placeholder?: boolean;
}

interface RendererTextInputHistorySnapshot {
  readonly lines: readonly string[];
  readonly cursor: RendererTextInputCursor;
  readonly atomicRanges: readonly RendererTextInputAtomicRange[];
  readonly selectionAnchor?: number;
}

const graphemeSegmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : undefined;

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

    return {
      lines: visibleLines.map((line) =>
        this.renderVisualLine(line, {
          style,
          placeholderStyle,
          selectionStyle,
          selection,
        }),
      ),
      cursor,
      contentRows: visualLines.length,
      viewportRow,
    };
  }

  private handleKey(event: NativeInputKeyEvent): boolean {
    if (event.eventType === 'release') return false;
    if (event.key === 'character') {
      if (event.ctrl) return this.handleControlCharacter(event);
      if (event.alt) return this.handleAltCharacter(event);
      if (event.text === undefined || event.alt) return false;
      this.insertText(event.text);
      return true;
    }

    switch (event.key) {
      case 'enter':
        if (!this.multiline) return false;
        this.insertText('\n');
        return true;
      case 'backspace':
        if (event.alt || event.ctrl) this.deleteWordBackward();
        else this.deleteBackward();
        return true;
      case 'delete':
        if (event.alt || event.ctrl) this.deleteWordForward();
        else this.deleteForward();
        return true;
      case 'left':
        if (event.alt || event.ctrl) this.moveWordLeft(event.shift);
        else this.moveLeft(event.shift);
        return true;
      case 'right':
        if (event.alt || event.ctrl) this.moveWordRight(event.shift);
        else this.moveRight(event.shift);
        return true;
      case 'up':
        if (event.alt || event.ctrl) {
          this.moveParagraph(-1, event.shift);
          return true;
        }
        this.moveVertical(-1, event.shift);
        return true;
      case 'down':
        if (event.alt || event.ctrl) {
          this.moveParagraph(1, event.shift);
          return true;
        }
        this.moveVertical(1, event.shift);
        return true;
      case 'pageup':
        this.movePage(-1, event.shift);
        return true;
      case 'pagedown':
        this.movePage(1, event.shift);
        return true;
      case 'home':
        this.moveCursorToOffset(
          event.ctrl ? 0 : this.textOffsetForLine(this.cursor.line),
          'forward',
          event.shift,
        );
        this.clearPreferredDisplayColumn();
        return true;
      case 'end':
        this.moveCursorToOffset(
          event.ctrl
            ? this.getText().length
            : this.textOffsetForLine(this.cursor.line) + this.currentLine().length,
          'backward',
          event.shift,
        );
        this.clearPreferredDisplayColumn();
        return true;
      case 'tab':
      case 'escape':
      case 'insert':
      case 'f1':
      case 'f2':
      case 'f3':
      case 'f4':
      case 'f5':
      case 'f6':
        return false;
      case 'f7':
        this.selectAll();
        return true;
      case 'f8':
      case 'f9':
      case 'f10':
      case 'f11':
      case 'f12':
      case 'menu':
        return false;
    }
  }

  private handleAltCharacter(event: NativeInputKeyEvent): boolean {
    const text = event.text;
    if (text === undefined) return false;
    switch (text.toLowerCase()) {
      case 'b':
        this.moveWordLeft(event.shift);
        return true;
      case 'f':
        this.moveWordRight(event.shift);
        return true;
      case 'd':
        this.deleteWordForward();
        return true;
      default:
        return false;
    }
  }

  private handleControlCharacter(event: NativeInputKeyEvent): boolean {
    const text = event.text;
    if (text === undefined) return false;
    switch (text.toLowerCase()) {
      case 'a':
        if (event.shift) this.selectAll();
        else this.moveCursorToOffset(this.textOffsetForLine(this.cursor.line), 'forward', false);
        this.clearPreferredDisplayColumn();
        return true;
      case 'e':
        this.moveCursorToOffset(
          this.textOffsetForLine(this.cursor.line) + this.currentLine().length,
          'backward',
          false,
        );
        this.clearPreferredDisplayColumn();
        return true;
      case 'b':
        this.moveLeft();
        return true;
      case 'f':
        this.moveRight();
        return true;
      case 'h':
        this.deleteBackward();
        return true;
      case 'd':
        this.deleteForward();
        return true;
      case 'w':
        this.deleteWordBackward();
        return true;
      case 'u':
        this.deleteToLineStart();
        return true;
      case 'k':
        this.deleteToLineEnd();
        return true;
      case 'z':
        if (event.shift) this.redo();
        else this.undo();
        return true;
      case 'y':
        this.redo();
        return true;
      default:
        return false;
    }
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
    // Prefer soft-wrapped visual rows when width is known so long single-line
    // prompts and hard-wrapped paragraphs feel continuous under ↑/↓.
    if (this.moveVisualLine(direction, extend)) return;
    const nextLine = this.cursor.line + direction;
    if (nextLine < 0 || nextLine >= this.lines.length) return;
    const targetColumn = this.preferredColumn();
    const offset =
      this.textOffsetForLine(nextLine) +
      columnAtDisplayWidth(this.lines[nextLine] ?? '', targetColumn);
    this.moveCursorToOffset(offset, direction > 0 ? 'forward' : 'backward', extend);
  }

  private moveVisualLine(direction: -1 | 1, extend: boolean): boolean {
    const width = this.layoutWidth;
    if (width === undefined || width <= 0) return false;
    const visualLines = this.createVisualLines(width);
    if (visualLines.length === 0) return false;
    const index = this.visualLineIndexForCursor(visualLines);
    const next = visualLines[index + direction];
    if (next === undefined) return false;

    const current = visualLines[index]!;
    const targetColumn = this.preferredVisualColumn(current);
    // Place the caret on the next visual row at the sticky display column.
    // Clamp into the visual segment so soft-wrap boundaries stay stable.
    const columnInNext = columnAtDisplayWidth(next.text, targetColumn);
    const nextColumn = Math.min(next.end, next.start + columnInNext);
    this.moveCursorToOffset(
      this.textOffsetForLine(next.logicalLine) + nextColumn,
      direction > 0 ? 'forward' : 'backward',
      extend,
    );
    return true;
  }

  /**
   * Jump by blank-line paragraph (or to document start/end). Used for Alt/Ctrl+↑/↓
   * so long multi-line drafts can be scanned quickly without holding the arrow.
   */
  private moveParagraph(direction: -1 | 1, extend = false): void {
    const targetLine = findParagraphTargetLine(this.lines, this.cursor.line, direction);
    if (targetLine === this.cursor.line && direction < 0 && this.cursor.line === 0) {
      this.moveCursorToOffset(0, 'forward', extend);
      this.clearPreferredDisplayColumn();
      return;
    }
    if (
      targetLine === this.cursor.line &&
      direction > 0 &&
      this.cursor.line === this.lines.length - 1
    ) {
      this.moveCursorToOffset(this.getText().length, 'backward', extend);
      this.clearPreferredDisplayColumn();
      return;
    }
    const targetColumn = this.preferredColumn();
    const offset =
      this.textOffsetForLine(targetLine) +
      columnAtDisplayWidth(this.lines[targetLine] ?? '', targetColumn);
    this.moveCursorToOffset(offset, direction > 0 ? 'forward' : 'backward', extend);
  }

  private movePage(direction: -1 | 1, extend = false): void {
    const pageRows = Math.max(1, this.layoutHeight ?? 1);
    if (this.layoutWidth === undefined) {
      const targetLine = clampInteger(this.cursor.line + direction * pageRows, 0, this.lines.length - 1);
      const targetColumn = this.preferredColumn();
      const offset = this.textOffsetForLine(targetLine) + columnAtDisplayWidth(this.lines[targetLine] ?? '', targetColumn);
      this.moveCursorToOffset(offset, direction > 0 ? 'forward' : 'backward', extend);
      return;
    }

    const visualLines = this.createVisualLines(this.layoutWidth);
    const currentIndex = this.visualLineIndexForCursor(visualLines);
    const targetIndex = clampInteger(currentIndex + direction * pageRows, 0, visualLines.length - 1);
    const current = visualLines[currentIndex]!;
    const target = visualLines[targetIndex]!;
    const targetColumn = this.preferredVisualColumn(current);
    const targetOffset = target.start + columnAtDisplayWidth(target.text, targetColumn);
    this.moveCursorToOffset(
      this.textOffsetForLine(target.logicalLine) + Math.min(target.end, targetOffset),
      direction > 0 ? 'forward' : 'backward',
      extend,
    );
  }

  private createVisualLines(width: number): readonly VisualLine[] {
    if (this.getText().length === 0 && this.placeholder !== undefined) {
      return wrapLogicalLine(this.placeholder, 0, width, true);
    }
    return this.lines.flatMap((line, index) => wrapLogicalLine(line, index, width, false));
  }

  private cursorToVisualPosition(visualLines: readonly VisualLine[]): { readonly x: number; readonly y: number } {
    const fallbackY = Math.max(0, visualLines.length - 1);
    for (let y = 0; y < visualLines.length; y++) {
      const visual = visualLines[y]!;
      if (visual.logicalLine !== this.cursor.line) continue;
      if (this.cursor.column < visual.start || this.cursor.column > visual.end) continue;
      if (
        this.cursor.column === visual.end &&
        y + 1 < visualLines.length &&
        visualLines[y + 1]?.logicalLine === this.cursor.line &&
        visualLines[y + 1]?.start === visual.end
      ) {
        continue;
      }
      return {
        x: measureDisplayWidth(this.currentLine().slice(visual.start, this.cursor.column)),
        y,
      };
    }
    return { x: 0, y: fallbackY };
  }

  private visualLineIndexForCursor(visualLines: readonly VisualLine[]): number {
    for (let index = 0; index < visualLines.length; index++) {
      const visual = visualLines[index]!;
      if (visual.logicalLine !== this.cursor.line) continue;
      if (this.cursor.column < visual.start || this.cursor.column > visual.end) continue;
      if (
        this.cursor.column === visual.end &&
        index + 1 < visualLines.length &&
        visualLines[index + 1]?.logicalLine === this.cursor.line &&
        visualLines[index + 1]?.start === visual.end
      ) {
        continue;
      }
      return index;
    }
    return Math.max(0, visualLines.length - 1);
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
    if (line.placeholder === true || options.selection === undefined) {
      return textToCells(line.text, line.placeholder === true ? options.placeholderStyle : options.style);
    }

    const lineStartOffset = this.textOffsetForLine(line.logicalLine);
    const cells: RendererCell[] = [];
    for (const cluster of splitClusters(line.text)) {
      const clusterStart = lineStartOffset + line.start + cluster.start;
      const clusterEnd = lineStartOffset + line.start + cluster.end;
      const selected = rangesOverlap(
        clusterStart,
        clusterEnd,
        options.selection.start,
        options.selection.end,
      );
      const style = selected ? mergeCellStyles(options.style, options.selectionStyle) : options.style;
      cells.push(...textToCells(cluster.text, style));
    }
    return cells;
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
    let offset = 0;
    for (let line = 0; line < this.cursor.line; line++) {
      offset += (this.lines[line] ?? '').length + 1;
    }
    return offset + this.cursor.column;
  }

  private textOffsetForLine(line: number): number {
    let offset = 0;
    const bounded = Math.max(0, Math.min(this.lines.length - 1, Math.floor(line)));
    for (let index = 0; index < bounded; index++) {
      offset += (this.lines[index] ?? '').length + 1;
    }
    return offset;
  }

  private cursorForTextOffset(offset: number): RendererTextInputCursor {
    let remaining = Math.max(0, offset);
    for (let line = 0; line < this.lines.length; line++) {
      const text = this.lines[line] ?? '';
      if (remaining <= text.length) {
        return { line, column: snapColumnToBoundary(text, remaining) };
      }
      remaining -= text.length + 1;
    }
    const lastLine = this.lines.length - 1;
    return {
      line: lastLine,
      column: this.lines[lastLine]?.length ?? 0,
    };
  }

  private truncateToMaxLength(): void {
    if (this.maxLength === undefined) return;
    const text = this.getText();
    if (text.length <= this.maxLength) return;
    this.lines = normalizeInputText(text.slice(0, this.maxLength));
    this.atomicRanges = normalizeAtomicRanges(this.atomicRanges, this.getText());
  }

  private previousEditableOffset(offset: number): number {
    const text = this.getText();
    const bounded = Math.max(0, Math.min(text.length, offset));
    const endingRange = this.atomicRanges.find((range) => range.end === bounded);
    if (endingRange !== undefined) return endingRange.start;
    const previous = previousClusterBoundary(text, bounded);
    const containingRange = this.atomicRangeContainingOffset(previous);
    return containingRange?.start ?? previous;
  }

  private nextEditableOffset(offset: number): number {
    const text = this.getText();
    const bounded = Math.max(0, Math.min(text.length, offset));
    const startingRange = this.atomicRanges.find((range) => range.start === bounded);
    if (startingRange !== undefined) return startingRange.end;
    const next = nextClusterBoundary(text, bounded);
    const containingRange = this.atomicRangeContainingOffset(next);
    return containingRange?.end ?? next;
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
    const text = this.getText();
    const bounded = Math.max(0, Math.min(text.length, offset));
    const range = this.atomicRangeContainingOffset(bounded);
    if (range === undefined) return bounded;
    if (bias === 'backward') return range.start;
    if (bias === 'forward') return range.end;
    return bounded - range.start <= range.end - bounded ? range.start : range.end;
  }

  private atomicRangeContainingOffset(offset: number): RendererTextInputAtomicRange | undefined {
    return this.atomicRanges.find((range) => range.start < offset && offset < range.end);
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
    let expandedStart = start;
    let expandedEnd = end;
    let changed = true;
    while (changed) {
      changed = false;
      for (const range of this.atomicRanges) {
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
    const viewportRow = normalizeViewportRow(options.viewportRow);
    const visualIndex = Math.max(0, Math.min(visualLines.length - 1, viewportRow + normalizeMouseCoordinate(options.y)));
    const visualLine = visualLines[visualIndex] ?? visualLines.at(-1);
    if (visualLine === undefined || visualLine.placeholder === true) return 0;
    const column = columnAtDisplayWidth(visualLine.text, normalizeMouseCoordinate(options.x));
    return this.textOffsetForLine(visualLine.logicalLine) + Math.min(visualLine.end, visualLine.start + column);
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

  private preferredColumn(): number {
    const column =
      this.preferredDisplayColumn ?? measureDisplayWidth(this.currentLine().slice(0, this.cursor.column));
    this.preferredDisplayColumn = column;
    return column;
  }

  private preferredVisualColumn(visualLine: VisualLine): number {
    const column =
      this.preferredDisplayColumn ??
      measureDisplayWidth(this.currentLine().slice(visualLine.start, this.cursor.column));
    this.preferredDisplayColumn = column;
    return column;
  }

  private clearPreferredDisplayColumn(): void {
    this.preferredDisplayColumn = undefined;
  }

  private clearSelection(): void {
    this.selectionAnchor = undefined;
  }
}

type AtomicCursorBias = 'backward' | 'forward' | 'nearest';

function normalizeAtomicRanges(
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

function shiftAtomicRangesAfterInsert(
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

function shiftAtomicRangesAfterDelete(
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

function snapTextOffsetToBoundary(
  text: string,
  offset: number,
  bias: AtomicCursorBias,
): number {
  const clamped = Math.max(0, Math.min(text.length, Math.floor(offset)));
  if (clamped === 0 || clamped === text.length) return clamped;
  for (const cluster of splitClusters(text)) {
    if (cluster.start === clamped || cluster.end === clamped) return clamped;
    if (cluster.start < clamped && clamped < cluster.end) {
      if (bias === 'nearest') {
        return clamped - cluster.start <= cluster.end - clamped ? cluster.start : cluster.end;
      }
      return bias === 'backward' ? cluster.start : cluster.end;
    }
    if (cluster.start > clamped) return bias === 'backward' ? 0 : cluster.start;
  }
  return clamped;
}

function rangesOverlap(start: number, end: number, otherStart: number, otherEnd: number): boolean {
  return start < otherEnd && otherStart < end;
}

function mergeCellStyles(
  base: RendererCellStyle | undefined,
  overlay: RendererCellStyle,
): RendererCellStyle {
  if (base === undefined) return overlay;
  return { ...base, ...overlay };
}

function cloneAtomicRange(range: RendererTextInputAtomicRange): RendererTextInputAtomicRange {
  const clone: { start: number; end: number; id?: string } = {
    start: range.start,
    end: range.end,
  };
  if (range.id !== undefined) clone.id = range.id;
  return clone;
}

function historySnapshotsEqual(
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

function normalizeInputText(text: string): string[] {
  const normalized = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  const lines = normalized.split('\n');
  return lines.length === 0 ? [''] : lines;
}

function normalizeMaxLength(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value < 0) return undefined;
  return Math.floor(value);
}

function normalizeHistoryLimit(value: number | undefined): number {
  if (value === undefined) return 100;
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

function normalizeRenderWidth(value: number): number {
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.floor(value);
}

function normalizeViewportRow(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

function normalizeMouseCoordinate(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

function normalizeOptionalLayoutWidth(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value < 1) return undefined;
  return Math.floor(value);
}

function normalizeRenderHeight(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value < 1) return undefined;
  return Math.floor(value);
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function wrapLogicalLine(
  line: string,
  logicalLine: number,
  width: number,
  placeholder: boolean,
): readonly VisualLine[] {
  if (line.length === 0) return [{ text: '', logicalLine, start: 0, end: 0, width: 0, placeholder }];

  const clusters = splitClusters(line);
  const out: VisualLine[] = [];
  let current = '';
  let currentWidth = 0;
  let start = clusters[0]?.start ?? 0;
  let end = start;

  for (const cluster of clusters) {
    if (currentWidth > 0 && currentWidth + cluster.width > width) {
      out.push({ text: current, logicalLine, start, end, width: currentWidth, placeholder });
      current = '';
      currentWidth = 0;
      start = cluster.start;
      end = cluster.start;
    }
    current += cluster.text;
    currentWidth += cluster.width;
    end = cluster.end;
  }

  out.push({ text: current, logicalLine, start, end, width: currentWidth, placeholder });
  return out;
}

function splitClusters(text: string): readonly TextCluster[] {
  if (graphemeSegmenter !== undefined) {
    return Array.from(graphemeSegmenter.segment(text), (segment) => ({
      text: segment.segment,
      start: segment.index,
      end: segment.index + segment.segment.length,
      width: displayClusterWidth(segment.segment),
    }));
  }

  const clusters: TextCluster[] = [];
  let index = 0;
  for (const char of Array.from(text)) {
    clusters.push({
      text: char,
      start: index,
      end: index + char.length,
      width: displayClusterWidth(char),
    });
    index += char.length;
  }
  return clusters;
}

function previousClusterBoundary(text: string, column: number): number {
  const clamped = Math.max(0, Math.min(text.length, column));
  let previous = 0;
  for (const cluster of splitClusters(text)) {
    if (cluster.end >= clamped) return cluster.start;
    previous = cluster.start;
  }
  return previous;
}

function nextClusterBoundary(text: string, column: number): number {
  const clamped = Math.max(0, Math.min(text.length, column));
  for (const cluster of splitClusters(text)) {
    if (cluster.end > clamped) return cluster.end;
  }
  return text.length;
}

function previousWordBoundary(text: string, offset: number): number {
  let cursor = Math.max(0, Math.min(text.length, offset));
  while (cursor > 0) {
    const previous = previousClusterBoundary(text, cursor);
    if (!isWhitespaceCluster(text.slice(previous, cursor))) break;
    cursor = previous;
  }
  while (cursor > 0) {
    const previous = previousClusterBoundary(text, cursor);
    if (isWhitespaceCluster(text.slice(previous, cursor))) break;
    cursor = previous;
  }
  return cursor;
}

function nextWordBoundary(text: string, offset: number): number {
  let cursor = Math.max(0, Math.min(text.length, offset));
  while (cursor < text.length) {
    const next = nextClusterBoundary(text, cursor);
    if (!isWhitespaceCluster(text.slice(cursor, next))) break;
    cursor = next;
  }
  while (cursor < text.length) {
    const next = nextClusterBoundary(text, cursor);
    if (isWhitespaceCluster(text.slice(cursor, next))) break;
    cursor = next;
  }
  return cursor;
}

function isWhitespaceCluster(text: string): boolean {
  return /^\s+$/u.test(text);
}

function snapColumnToBoundary(text: string, column: number): number {
  const clamped = Math.max(0, Math.min(text.length, Math.floor(column)));
  if (clamped === 0 || clamped === text.length) return clamped;
  let previous = 0;
  for (const cluster of splitClusters(text)) {
    if (cluster.start === clamped || cluster.end === clamped) return clamped;
    if (cluster.start > clamped) return previous;
    previous = cluster.end;
  }
  return previous;
}

function columnAtDisplayWidth(text: string, targetWidth: number): number {
  let width = 0;
  for (const cluster of splitClusters(text)) {
    if (width + cluster.width > targetWidth) return cluster.start;
    width += cluster.width;
    if (width === targetWidth) return cluster.end;
  }
  return text.length;
}

/**
 * Blank-line paragraph navigation: skip empty lines, then land on the first
 * non-empty line of the next/previous block. Falls back to document edges.
 */
function findParagraphTargetLine(
  lines: readonly string[],
  fromLine: number,
  direction: -1 | 1,
): number {
  if (lines.length === 0) return 0;
  const last = lines.length - 1;
  let line = clampInteger(fromLine, 0, last);

  const isBlank = (index: number): boolean => (lines[index] ?? '').trim().length === 0;

  if (direction < 0) {
    // Move to the start of the current paragraph, or the previous one.
    if (line > 0 && !isBlank(line) && !isBlank(line - 1)) {
      while (line > 0 && !isBlank(line - 1)) line -= 1;
      return line;
    }
    line = Math.max(0, line - 1);
    while (line > 0 && isBlank(line)) line -= 1;
    while (line > 0 && !isBlank(line - 1)) line -= 1;
    return line;
  }

  // direction > 0: jump past the current paragraph to the next non-empty block.
  if (line < last && !isBlank(line)) {
    while (line < last && !isBlank(line + 1)) line += 1;
    line = Math.min(last, line + 1);
  } else {
    line = Math.min(last, line + 1);
  }
  while (line < last && isBlank(line)) line += 1;
  return line;
}
