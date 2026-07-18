import { Key, matchesKey } from '#/tui/renderer';
import { isPrintableChar, printableChar } from '#/tui/utils/printable-key';
import { sanitizeApiKeyValue } from '#/tui/utils/sanitize-api-key';

const PROMPT = '> ';
const BRACKET_PASTE_START = '\u001B[200~';
const BRACKET_PASTE_END = '\u001B[201~';

/**
 * Minimal single-line text input for dialog boxes.
 *
 * Replaces the legacy pi-tui `Input` with a small local implementation that
 * depends only on the renderer package's printable-key helpers.
 */
export class Input {
  focused = false;
  onSubmit?: (value: string) => void;
  onEscape?: () => void;

  private value = '';
  private cursor = 0;
  private pasteBuffer: string | undefined;

  getValue(): string {
    return this.value;
  }

  setValue(value: string): void {
    this.value = value;
    this.cursor = value.length;
  }

  handleInput(data: string): void {
    if (this.handleBracketedPaste(data)) return;

    if (matchesKey(data, Key.escape)) {
      this.onEscape?.();
      return;
    }
    if (matchesKey(data, Key.enter)) {
      this.onSubmit?.(this.value);
      return;
    }
    if (matchesKey(data, Key.backspace)) {
      if (this.cursor > 0) {
        this.value = this.value.slice(0, this.cursor - 1) + this.value.slice(this.cursor);
        this.cursor--;
      }
      return;
    }
    if (matchesKey(data, Key.delete)) {
      if (this.cursor < this.value.length) {
        this.value = this.value.slice(0, this.cursor) + this.value.slice(this.cursor + 1);
      }
      return;
    }
    if (matchesKey(data, Key.left) || matchesKey(data, Key.ctrl('b'))) {
      this.cursor = Math.max(0, this.cursor - 1);
      return;
    }
    if (matchesKey(data, Key.right) || matchesKey(data, Key.ctrl('f'))) {
      this.cursor = Math.min(this.value.length, this.cursor + 1);
      return;
    }
    if (matchesKey(data, Key.home)) {
      this.cursor = 0;
      return;
    }
    if (matchesKey(data, Key.end)) {
      this.cursor = this.value.length;
      return;
    }

    const char = printableChar(data);
    // Reject CSI/Kitty leftovers and multi-byte control junk. Clean multi-char
    // pastes (non-bracketed) still insert when every code point is printable.
    if (char === undefined || !isInsertableText(char)) return;

    this.insert(char);
  }

  invalidate(): void {}

  render(width: number): string[] {
    const contentWidth = Math.max(0, width - PROMPT.length);
    const displayValue = this.value.length > contentWidth
      ? this.value.slice(this.value.length - contentWidth)
      : this.value;
    const line = PROMPT + displayValue;
    if (!this.focused || displayValue.length === 0) {
      return [line];
    }
    // Place the cursor on the last displayed character so the terminal
    // cursor follows the end of the typed text.
    return [line];
  }

  private handleBracketedPaste(data: string): boolean {
    if (this.pasteBuffer !== undefined) {
      this.appendPasteChunk(data);
      return true;
    }

    const start = data.indexOf(BRACKET_PASTE_START);
    if (start === -1) return false;

    this.pasteBuffer = '';
    const before = data.slice(0, start);
    if (isInsertableText(before)) this.insert(before);
    this.appendPasteChunk(data.slice(start + BRACKET_PASTE_START.length));
    return true;
  }

  private appendPasteChunk(data: string): void {
    if (this.pasteBuffer === undefined) return;

    this.pasteBuffer += data;
    const end = this.pasteBuffer.indexOf(BRACKET_PASTE_END);
    if (end === -1) return;

    const pasted = this.pasteBuffer.slice(0, end);
    const remaining = this.pasteBuffer.slice(end + BRACKET_PASTE_END.length);
    this.pasteBuffer = undefined;
    this.insert(sanitizeApiKeyValue(pasted));
    if (remaining.length > 0) this.handleInput(remaining);
  }

  private insert(text: string): void {
    if (text.length === 0) return;
    this.value = this.value.slice(0, this.cursor) + text + this.value.slice(this.cursor);
    this.cursor += text.length;
  }
}

function isInsertableText(text: string): boolean {
  if (text.length === 0) return false;
  if (text.length === 1) return isPrintableChar(text);
  for (const char of text) {
    if (!isPrintableChar(char)) return false;
  }
  return true;
}
