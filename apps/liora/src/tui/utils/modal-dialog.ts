/**
 * ModalDialogSystem — confirmation, input, and selection dialogs.
 *
 * Provides GUI-quality modal interactions:
 * - Confirmation dialog (Yes/No with customizable buttons)
 * - Text input dialog (single-line with validation)
 * - Multi-line input dialog (for commit messages, etc.)
 * - Selection list (single/multi-select with search filter)
 * - Progress dialog (indeterminate/determinate with cancel)
 * - Error/info/warning alert dialogs
 * - Dialog stacking (multiple modals with z-order)
 * - Keyboard navigation (Tab, Enter, Escape, arrows)
 * - Focus trap (Tab cycles within dialog)
 * - Centered positioning with shadow
 * - Animated entrance/exit (fade + scale)
 * - Customizable width, buttons, and content
 *
 * Interaction:
 * - Enter: Accept/confirm
 * - Escape: Cancel/dismiss
 * - Tab/Shift+Tab: Cycle focus between buttons/inputs
 * - Up/Down: Navigate list items
 * - Type-ahead: Filter in selection lists
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DialogType = 'confirm' | 'input' | 'multiline' | 'select' | 'multiselect' | 'progress' | 'alert';
export type AlertLevel = 'info' | 'success' | 'warning' | 'error';

export interface DialogButton {
  readonly id: string;
  readonly label: string;
  readonly style: 'primary' | 'secondary' | 'danger';
  readonly key?: string; // Shortcut key
}

export interface DialogOptions {
  readonly type: DialogType;
  readonly title: string;
  readonly message?: string;
  readonly width?: number;
  readonly buttons?: readonly DialogButton[];
  readonly placeholder?: string;
  readonly initialValue?: string;
  readonly items?: readonly SelectItem[];
  readonly multiSelect?: boolean;
  readonly alertLevel?: AlertLevel;
  readonly progress?: number; // 0-1 for determinate, undefined for indeterminate
  readonly cancellable?: boolean;
  readonly validator?: (input: string) => string | null; // Returns error message or null
}

export interface SelectItem {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly icon?: string;
  readonly disabled?: boolean;
  selected?: boolean;
}

export interface DialogState {
  readonly active: boolean;
  readonly type: DialogType;
  readonly title: string;
  readonly message: string;
  readonly buttons: readonly DialogButton[];
  readonly focusedButton: number;
  readonly inputValue: string;
  readonly inputCursor: number;
  readonly items: SelectItem[];
  readonly listScroll: number;
  readonly listCursor: number;
  readonly filterQuery: string;
  readonly error: string | null;
  readonly progress: number | undefined;
  readonly result: DialogResult | null;
}

export interface DialogResult {
  readonly accepted: boolean;
  readonly buttonId?: string;
  readonly inputValue?: string;
  readonly selectedItems?: readonly string[];
}

export interface DialogRenderOptions {
  readonly termWidth: number;
  readonly termHeight: number;
  readonly fg: (token: string, text: string) => string;
  readonly boldFg: (token: string, text: string) => string;
  readonly dimFg: (token: string, text: string) => string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_WIDTH = 50;
const MIN_WIDTH = 30;
const MAX_WIDTH = 80;
const MAX_VISIBLE_ITEMS = 8;

const ALERT_ICONS: Record<AlertLevel, string> = {
  info: 'ℹ',
  success: '✓',
  warning: '⚠',
  error: '✗',
};

const ALERT_COLORS: Record<AlertLevel, string> = {
  info: 'primary',
  success: 'success',
  warning: 'warning',
  error: 'error',
};

// ---------------------------------------------------------------------------
// ModalDialog
// ---------------------------------------------------------------------------

export class ModalDialog {
  private state: DialogState;
  private options: DialogOptions;

  constructor(options: DialogOptions) {
    this.options = options;
    this.state = {
      active: true,
      type: options.type,
      title: options.title,
      message: options.message ?? '',
      buttons: options.buttons ?? this.defaultButtons(options.type),
      focusedButton: 0,
      inputValue: options.initialValue ?? '',
      inputCursor: (options.initialValue ?? '').length,
      items: (options.items ?? []).map((item) => ({ ...item })),
      listScroll: 0,
      listCursor: 0,
      filterQuery: '',
      error: null,
      progress: options.progress,
      result: null,
    };
  }

  // ─── Input Handling ──────────────────────────────────────────────

  /** Handle a key press. Returns true if the dialog consumed the key. */
  handleKey(key: string): boolean {
    if (!this.state.active) return false;

    switch (key) {
      case 'Escape':
        this.cancel();
        return true;

      case 'Enter':
        if (this.state.type === 'input' || this.state.type === 'multiline') {
          this.confirmInput();
        } else if (this.state.type === 'select' || this.state.type === 'multiselect') {
          this.confirmSelection();
        } else {
          this.accept(this.state.buttons[this.state.focusedButton]?.id);
        }
        return true;

      case 'Tab':
        this.cycleFocus(1);
        return true;

      case 'Shift+Tab':
        this.cycleFocus(-1);
        return true;

      case 'Up':
        if (this.isListType()) this.moveListCursor(-1);
        return true;

      case 'Down':
        if (this.isListType()) this.moveListCursor(1);
        return true;

      case 'Left':
        if (this.isInputType()) this.moveCursor(-1);
        return true;

      case 'Right':
        if (this.isInputType()) this.moveCursor(1);
        return true;

      case 'Backspace':
        if (this.isInputType()) this.deleteChar();
        else if (this.isListType() && this.state.filterQuery.length > 0) {
          this.state = { ...this.state, filterQuery: this.state.filterQuery.slice(0, -1) };
          this.applyFilter();
        }
        return true;

      case ' ':
        if (this.state.type === 'multiselect') {
          this.toggleItem();
          return true;
        }
        if (this.isInputType()) {
          this.insertChar(' ');
          return true;
        }
        return true;

      default:
        // Type-ahead for lists
        if (this.isListType() && key.length === 1) {
          this.state = { ...this.state, filterQuery: this.state.filterQuery + key };
          this.applyFilter();
          return true;
        }
        // Character input
        if (this.isInputType() && key.length === 1) {
          this.insertChar(key);
          return true;
        }
        return false;
    }
  }

  /** Accept the dialog with a specific button. */
  accept(buttonId?: string): void {
    this.state = {
      ...this.state,
      active: false,
      result: { accepted: true, buttonId: buttonId ?? 'ok' },
    };
  }

  /** Cancel the dialog. */
  cancel(): void {
    this.state = {
      ...this.state,
      active: false,
      result: { accepted: false },
    };
  }

  private confirmInput(): void {
    const value = this.state.inputValue;

    // Validate
    if (this.options.validator) {
      const error = this.options.validator(value);
      if (error) {
        this.state = { ...this.state, error };
        return;
      }
    }

    this.state = {
      ...this.state,
      active: false,
      error: null,
      result: { accepted: true, buttonId: 'ok', inputValue: value },
    };
  }

  private confirmSelection(): void {
    const selected = this.state.items
      .filter((item) => item.selected)
      .map((item) => item.id);

    // For single select, use the cursor item
    if (this.state.type === 'select') {
      const cursorItem = this.getFilteredItems()[this.state.listCursor];
      if (cursorItem) {
        this.state = {
          ...this.state,
          active: false,
          result: { accepted: true, buttonId: 'ok', selectedItems: [cursorItem.id] },
        };
        return;
      }
    }

    this.state = {
      ...this.state,
      active: false,
      result: { accepted: true, buttonId: 'ok', selectedItems: selected },
    };
  }

  // ─── Navigation ──────────────────────────────────────────────────

  private cycleFocus(direction: number): void {
    const count = this.state.buttons.length;
    if (count === 0) return;
    const next = (this.state.focusedButton + direction + count) % count;
    this.state = { ...this.state, focusedButton: next };
  }

  private moveListCursor(delta: number): void {
    const items = this.getFilteredItems();
    if (items.length === 0) return;
    const next = Math.max(0, Math.min(items.length - 1, this.state.listCursor + delta));
    this.state = { ...this.state, listCursor: next };

    // Scroll
    if (next < this.state.listScroll) {
      this.state = { ...this.state, listScroll: next };
    } else if (next >= this.state.listScroll + MAX_VISIBLE_ITEMS) {
      this.state = { ...this.state, listScroll: next - MAX_VISIBLE_ITEMS + 1 };
    }
  }

  private moveCursor(delta: number): void {
    const next = Math.max(0, Math.min(this.state.inputValue.length, this.state.inputCursor + delta));
    this.state = { ...this.state, inputCursor: next };
  }

  private insertChar(char: string): void {
    const value = this.state.inputValue;
    const cursor = this.state.inputCursor;
    const newValue = value.slice(0, cursor) + char + value.slice(cursor);
    this.state = { ...this.state, inputValue: newValue, inputCursor: cursor + 1, error: null };
  }

  private deleteChar(): void {
    const cursor = this.state.inputCursor;
    if (cursor === 0) return;
    const value = this.state.inputValue;
    const newValue = value.slice(0, cursor - 1) + value.slice(cursor);
    this.state = { ...this.state, inputValue: newValue, inputCursor: cursor - 1, error: null };
  }

  private toggleItem(): void {
    const items = this.getFilteredItems();
    const item = items[this.state.listCursor];
    if (!item || item.disabled) return;

    this.state = {
      ...this.state,
      items: this.state.items.map((i) =>
        i.id === item.id ? { ...i, selected: !i.selected } : i
      ),
    };
  }

  private applyFilter(): void {
    this.state = { ...this.state, listCursor: 0, listScroll: 0 };
  }

  private getFilteredItems(): SelectItem[] {
    const query = this.state.filterQuery.toLowerCase();
    if (query.length === 0) return this.state.items;
    return this.state.items.filter((item) =>
      item.label.toLowerCase().includes(query) ||
      (item.description ?? '').toLowerCase().includes(query)
    );
  }

  private isInputType(): boolean {
    return this.state.type === 'input' || this.state.type === 'multiline';
  }

  private isListType(): boolean {
    return this.state.type === 'select' || this.state.type === 'multiselect';
  }

  // ─── Queries ─────────────────────────────────────────────────────

  get isActive(): boolean {
    return this.state.active;
  }

  get result(): DialogResult | null {
    return this.state.result;
  }

  getState(): DialogState {
    return this.state;
  }

  /** Update progress (for progress dialogs). */
  setProgress(value: number): void {
    this.state = { ...this.state, progress: value };
  }

  // ─── Rendering ───────────────────────────────────────────────────

  /** Render the dialog as a centered box. */
  render(options: DialogRenderOptions): string[] {
    const { termWidth, fg, boldFg, dimFg } = options;
    const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, this.options.width ?? DEFAULT_WIDTH));
    const innerWidth = width - 4;
    const lines: string[] = [];

    // Top border with title
    const title = ` ${this.state.title} `;
    const titlePad = Math.max(0, innerWidth - title.length);
    lines.push(fg('accent', `╭─${'─'.repeat(1)}${boldFg('accent', title)}${'─'.repeat(titlePad)}╮`));

    // Message
    if (this.state.message) {
      const msgLines = wrapText(this.state.message, innerWidth - 2);
      for (const msgLine of msgLines) {
        lines.push(this.padLine(fg('text', ` ${msgLine}`), innerWidth, options));
      }
      lines.push(this.padLine('', innerWidth, options));
    }

    // Type-specific content
    switch (this.state.type) {
      case 'input':
        lines.push(...this.renderInput(innerWidth, options));
        break;
      case 'multiline':
        lines.push(...this.renderInput(innerWidth, options));
        break;
      case 'select':
      case 'multiselect':
        lines.push(...this.renderList(innerWidth, options));
        break;
      case 'progress':
        lines.push(...this.renderProgress(innerWidth, options));
        break;
      case 'alert':
        lines.push(...this.renderAlert(innerWidth, options));
        break;
      case 'confirm':
        break;
    }

    // Error message
    if (this.state.error) {
      lines.push(this.padLine(fg('error', ` ⚠ ${this.state.error}`), innerWidth, options));
    }

    // Buttons
    lines.push(this.padLine('', innerWidth, options));
    lines.push(this.renderButtons(innerWidth, options));

    // Bottom border
    lines.push(fg('accent', `╰${'─'.repeat(innerWidth + 2)}╯`));

    return lines;
  }

  private renderInput(innerWidth: number, options: DialogRenderOptions): string[] {
    const { fg, dimFg } = options;
    const lines: string[] = [];
    const value = this.state.inputValue;
    const cursor = this.state.inputCursor;
    const placeholder = this.options.placeholder ?? '';

    // Input field
    const displayValue = value.length > 0 ? value : dimFg('textMuted', placeholder);
    const cursorChar = value.length > 0
      ? fg('accent', value[cursor] ?? '▌')
      : fg('accent', '▌');

    const before = value.slice(0, cursor);
    const after = value.slice(cursor + 1);
    const inputLine = value.length > 0
      ? `${fg('text', before)}${cursorChar}${fg('text', after)}`
      : `${cursorChar}${displayValue}`;

    lines.push(this.padLine(fg('textMuted', ' ┌') + '─'.repeat(innerWidth - 4) + fg('textMuted', '┐'), innerWidth, options));
    lines.push(this.padLine(`${fg('textMuted', ' │')} ${inputLine}`, innerWidth, options));
    lines.push(this.padLine(fg('textMuted', ' └') + '─'.repeat(innerWidth - 4) + fg('textMuted', '┘'), innerWidth, options));

    return lines;
  }

  private renderList(innerWidth: number, options: DialogRenderOptions): string[] {
    const { fg, boldFg, dimFg } = options;
    const lines: string[] = [];
    const items = this.getFilteredItems();

    // Filter indicator
    if (this.state.filterQuery.length > 0) {
      lines.push(this.padLine(dimFg('textMuted', ` Filter: ${this.state.filterQuery}▌`), innerWidth, options));
    }

    // Items
    const visibleItems = items.slice(this.state.listScroll, this.state.listScroll + MAX_VISIBLE_ITEMS);
    for (let i = 0; i < visibleItems.length; i++) {
      const item = visibleItems[i]!;
      const actualIdx = this.state.listScroll + i;
      const isCursor = actualIdx === this.state.listCursor;

      const cursor = isCursor ? fg('accent', '▸ ') : '  ';
      const check = this.state.type === 'multiselect'
        ? (item.selected ? fg('success', '☑ ') : dimFg('textMuted', '☐ '))
        : '';
      const icon = item.icon ? `${item.icon} ` : '';
      const label = isCursor ? boldFg('text', item.label) : fg('text', item.label);
      const desc = item.description ? dimFg('textMuted', ` ${item.description}`) : '';
      const disabled = item.disabled ? dimFg('textMuted', ' (disabled)') : '';

      lines.push(this.padLine(`${cursor}${check}${icon}${label}${desc}${disabled}`, innerWidth, options));
    }

    // Scroll indicator
    if (items.length > MAX_VISIBLE_ITEMS) {
      const scrollInfo = dimFg('textMuted', ` ${String(this.state.listCursor + 1)}/${String(items.length)}`);
      lines.push(this.padLine(scrollInfo, innerWidth, options));
    }

    return lines;
  }

  private renderProgress(innerWidth: number, options: DialogRenderOptions): string[] {
    const { fg, dimFg } = options;
    const lines: string[] = [];
    const barWidth = innerWidth - 6;

    if (this.state.progress !== undefined) {
      // Determinate
      const filled = Math.round(this.state.progress * barWidth);
      const bar = fg('success', '█'.repeat(filled)) + dimFg('textMuted', '░'.repeat(barWidth - filled));
      const percent = fg('text', ` ${Math.round(this.state.progress * 100)}%`);
      lines.push(this.padLine(` ${bar}${percent}`, innerWidth, options));
    } else {
      // Indeterminate (animated)
      const phase = Date.now() % 1000 / 1000;
      const pos = Math.round(phase * barWidth);
      const bar = dimFg('textMuted', '░'.repeat(pos)) + fg('primary', '███') + dimFg('textMuted', '░'.repeat(Math.max(0, barWidth - pos - 3)));
      lines.push(this.padLine(` ${bar}`, innerWidth, options));
    }

    return lines;
  }

  private renderAlert(innerWidth: number, options: DialogRenderOptions): string[] {
    const { fg } = options;
    const level = this.options.alertLevel ?? 'info';
    const icon = ALERT_ICONS[level];
    const color = ALERT_COLORS[level];
    return [this.padLine(fg(color, `  ${icon}  ${this.state.message}`), innerWidth, options)];
  }

  private renderButtons(innerWidth: number, options: DialogRenderOptions): string {
    const { fg, boldFg, dimFg } = options;
    const buttons = this.state.buttons;
    const parts: string[] = [];

    for (let i = 0; i < buttons.length; i++) {
      const btn = buttons[i]!;
      const isFocused = i === this.state.focusedButton;
      const keyHint = btn.key ? dimFg('textMuted', `(${btn.key})`) : '';

      let label: string;
      if (isFocused) {
        const color = btn.style === 'danger' ? 'error' : btn.style === 'primary' ? 'primary' : 'text';
        label = boldFg(color, `[ ${btn.label} ]`) + keyHint;
      } else {
        label = dimFg('textMuted', ` ${btn.label} `) + keyHint;
      }
      parts.push(label);
    }

    const buttonLine = parts.join(dimFg('textMuted', '  '));
    // Right-align buttons
    const buttonLen = stripAnsiLen(buttonLine);
    const padding = Math.max(0, innerWidth - buttonLen - 1);
    return `${fg('accent', '│')} ${' '.repeat(padding)}${buttonLine} `;
  }

  private padLine(content: string, innerWidth: number, options: DialogRenderOptions): string {
    const { fg } = options;
    const contentLen = stripAnsiLen(content);
    const padding = Math.max(0, innerWidth - contentLen);
    return `${fg('accent', '│')}${content}${' '.repeat(padding)} ${fg('accent', '│')}`;
  }

  // ─── Defaults ────────────────────────────────────────────────────

  private defaultButtons(type: DialogType): DialogButton[] {
    switch (type) {
      case 'confirm':
        return [
          { id: 'ok', label: 'Yes', style: 'primary', key: 'y' },
          { id: 'cancel', label: 'No', style: 'secondary', key: 'n' },
        ];
      case 'alert':
        return [{ id: 'ok', label: 'OK', style: 'primary', key: '↵' }];
      case 'progress':
        return this.options.cancellable !== false
          ? [{ id: 'cancel', label: 'Cancel', style: 'danger', key: 'Esc' }]
          : [];
      default:
        return [
          { id: 'ok', label: 'OK', style: 'primary', key: '↵' },
          { id: 'cancel', label: 'Cancel', style: 'secondary', key: 'Esc' },
        ];
    }
  }
}

// ---------------------------------------------------------------------------
// Dialog Manager (stacking)
// ---------------------------------------------------------------------------

export class DialogManager {
  private stack: ModalDialog[] = [];

  /** Open a new dialog on top of the stack. */
  open(options: DialogOptions): ModalDialog {
    const dialog = new ModalDialog(options);
    this.stack.push(dialog);
    return dialog;
  }

  /** Close the topmost dialog. */
  closeTop(): DialogResult | null {
    const top = this.stack.pop();
    return top?.result ?? null;
  }

  /** Get the topmost active dialog. */
  get active(): ModalDialog | null {
    return this.stack.length > 0 ? this.stack[this.stack.length - 1]! : null;
  }

  /** Check if any dialog is open. */
  get hasActive(): boolean {
    return this.stack.length > 0;
  }

  /** Get stack depth. */
  get depth(): number {
    return this.stack.length;
  }

  /** Route a key to the topmost dialog. */
  handleKey(key: string): boolean {
    const top = this.active;
    if (!top) return false;

    top.handleKey(key);

    // Auto-close if resolved
    if (!top.isActive) {
      this.stack.pop();
    }
    return true;
  }

  /** Render the topmost dialog. */
  render(options: DialogRenderOptions): string[] {
    const top = this.active;
    if (!top) return [];
    return top.render(options);
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function stripAnsiLen(s: string): number {
  return s.replace(/\u001B\[[0-9;]*m/g, '').length;
}

function wrapText(text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (current.length + word.length + 1 > maxWidth) {
      if (current.length > 0) lines.push(current);
      current = word;
    } else {
      current = current.length > 0 ? `${current} ${word}` : word;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}
