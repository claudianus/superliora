import type { NativeInputKeyEvent } from './input-events';
import type { AtomicCursorBias } from './text-input-selection';

/**
 * Key and chord dispatch for `RendererTextInput`. The class implements
 * `RendererTextInputKeyActions` and delegates structured key events here so
 * input routing stays separate from mutable editor state.
 */

export interface RendererTextInputKeyActions {
  readonly multiline: boolean;
  insertText(text: string): void;
  deleteBackward(): void;
  deleteForward(): void;
  deleteWordBackward(): void;
  deleteWordForward(): void;
  deleteToLineStart(): void;
  deleteToLineEnd(): void;
  moveLeft(extend?: boolean): void;
  moveRight(extend?: boolean): void;
  moveWordLeft(extend?: boolean): void;
  moveWordRight(extend?: boolean): void;
  moveVertical(direction: -1 | 1, extend?: boolean): void;
  moveParagraph(direction: -1 | 1, extend?: boolean): void;
  movePage(direction: -1 | 1, extend?: boolean): void;
  moveCursorToOffset(offset: number, bias: AtomicCursorBias, extend: boolean): void;
  cursorLine(): number;
  textOffsetForLine(line: number): number;
  currentLineLength(): number;
  textLength(): number;
  clearPreferredDisplayColumn(): void;
  selectAll(): void;
  undo(): void;
  redo(): void;
}

export function dispatchTextInputKey(
  event: NativeInputKeyEvent,
  actions: RendererTextInputKeyActions,
): boolean {
  if (event.eventType === 'release') return false;
  if (event.key === 'character') {
    if (event.ctrl) return dispatchTextInputControlCharacter(event, actions);
    if (event.alt) return dispatchTextInputAltCharacter(event, actions);
    if (event.text === undefined || event.alt) return false;
    actions.insertText(event.text);
    return true;
  }

  switch (event.key) {
    case 'enter':
      if (!actions.multiline) return false;
      actions.insertText('\n');
      return true;
    case 'backspace':
      if (event.alt || event.ctrl) actions.deleteWordBackward();
      else actions.deleteBackward();
      return true;
    case 'delete':
      if (event.alt || event.ctrl) actions.deleteWordForward();
      else actions.deleteForward();
      return true;
    case 'left':
      if (event.alt || event.ctrl) actions.moveWordLeft(event.shift);
      else actions.moveLeft(event.shift);
      return true;
    case 'right':
      if (event.alt || event.ctrl) actions.moveWordRight(event.shift);
      else actions.moveRight(event.shift);
      return true;
    case 'up':
      if (event.alt || event.ctrl) {
        actions.moveParagraph(-1, event.shift);
        return true;
      }
      actions.moveVertical(-1, event.shift);
      return true;
    case 'down':
      if (event.alt || event.ctrl) {
        actions.moveParagraph(1, event.shift);
        return true;
      }
      actions.moveVertical(1, event.shift);
      return true;
    case 'pageup':
      actions.movePage(-1, event.shift);
      return true;
    case 'pagedown':
      actions.movePage(1, event.shift);
      return true;
    case 'home':
      actions.moveCursorToOffset(
        event.ctrl ? 0 : actions.textOffsetForLine(actions.cursorLine()),
        'forward',
        event.shift,
      );
      actions.clearPreferredDisplayColumn();
      return true;
    case 'end':
      actions.moveCursorToOffset(
        event.ctrl
          ? actions.textLength()
          : actions.textOffsetForLine(actions.cursorLine()) + actions.currentLineLength(),
        'backward',
        event.shift,
      );
      actions.clearPreferredDisplayColumn();
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
      actions.selectAll();
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

function dispatchTextInputAltCharacter(
  event: NativeInputKeyEvent,
  actions: RendererTextInputKeyActions,
): boolean {
  const text = event.text;
  if (text === undefined) return false;
  switch (text.toLowerCase()) {
    case 'b':
      actions.moveWordLeft(event.shift);
      return true;
    case 'f':
      actions.moveWordRight(event.shift);
      return true;
    case 'd':
      actions.deleteWordForward();
      return true;
    default:
      return false;
  }
}

function dispatchTextInputControlCharacter(
  event: NativeInputKeyEvent,
  actions: RendererTextInputKeyActions,
): boolean {
  const text = event.text;
  if (text === undefined) return false;
  switch (text.toLowerCase()) {
    case 'a':
      if (event.shift) actions.selectAll();
      else actions.moveCursorToOffset(actions.textOffsetForLine(actions.cursorLine()), 'forward', false);
      actions.clearPreferredDisplayColumn();
      return true;
    case 'e':
      actions.moveCursorToOffset(
        actions.textOffsetForLine(actions.cursorLine()) + actions.currentLineLength(),
        'backward',
        false,
      );
      actions.clearPreferredDisplayColumn();
      return true;
    case 'b':
      actions.moveLeft();
      return true;
    case 'f':
      actions.moveRight();
      return true;
    case 'h':
      actions.deleteBackward();
      return true;
    case 'd':
      actions.deleteForward();
      return true;
    case 'w':
      actions.deleteWordBackward();
      return true;
    case 'u':
      actions.deleteToLineStart();
      return true;
    case 'k':
      actions.deleteToLineEnd();
      return true;
    case 'z':
      if (event.shift) actions.redo();
      else actions.undo();
      return true;
    case 'y':
      actions.redo();
      return true;
    default:
      return false;
  }
}
