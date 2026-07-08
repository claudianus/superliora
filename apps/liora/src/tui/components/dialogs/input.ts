import { Key, matchesKey } from '#/tui/renderer';
import { printableChar } from '#/tui/utils/printable-key';

const PROMPT = '> ';

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

  getValue(): string {
    return this.value;
  }

  setValue(value: string): void {
    this.value = value;
    this.cursor = value.length;
  }

  handleInput(data: string): void {
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
    if (char === undefined) return;

    this.value = this.value.slice(0, this.cursor) + char + this.value.slice(this.cursor);
    this.cursor += char.length;
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
}
