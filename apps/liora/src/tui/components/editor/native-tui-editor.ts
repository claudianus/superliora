import {
  Key,
  NativeInputDecoder,
  RendererEditorAutocompleteController,
  RendererTextInput,
  isKeyRelease,
  matchesKey,
  measureRendererEditorSurfaceLayout,
  measureRendererEditorSurfaceNaturalRows,
  RENDERER_EDITOR_CONTENT_RIGHT_INSET,
  RENDERER_EDITOR_CONTENT_X,
  RENDERER_EDITOR_SHELL_MODE_LABEL,
  renderRendererEditorSurface,
  resolveRendererEditorSurfaceStyles,
  type RendererEditorAutocompleteLineStyles,
  type AutocompleteProvider,
  type RendererEditorAutocompleteCompletion,
  type RendererEditorCursor,
  type RendererRegionLine,
} from '#/tui/renderer';

import { printableChar } from '#/tui/utils/printable-key';

import type { TUIEditor, TUIEditorInputMode } from './editor-contract';

export interface NativeTUIEditorOptions {
  readonly requestRender?: () => void;
  readonly autocompleteMaxVisible?: number;
}

export class NativeTUIEditor implements TUIEditor {
  focused = false;
  inputMode: TUIEditorInputMode = 'prompt';
  connectedAbove = false;
  borderHighlighted = false;
  borderColor: (text: string) => string = (text) => text;

  onSubmit?: (text: string) => void;
  onChange?: (text: string) => void;
  onEscape?: () => void;
  onCtrlD?: () => void;
  onCtrlC?: () => void;
  onToggleToolExpand?: () => void;
  onOpenExternalEditor?: () => void;
  onCtrlS?: () => void;
  onCtrlB?: () => boolean;
  onToggleTodoExpand?: () => boolean;
  onUndo?: () => void;
  onNonEscapeInput?: () => void;
  onInsertNewline?: () => void;
  onTextPaste?: () => void;
  onUpArrowEmpty?: () => boolean;
  onDownArrowEmpty?: () => boolean;
  onTranscriptPageUp?: () => boolean;
  onTranscriptPageDown?: () => boolean;
  onTranscriptTop?: () => boolean;
  onTranscriptBottom?: () => boolean;
  onShiftTab?: () => void;
  onShiftTabUltra?: () => void;
  onInputModeChange?: (mode: TUIEditorInputMode) => void;
  onPasteImage?: () => Promise<boolean>;

  private readonly decoder = new NativeInputDecoder();
  private readonly input = new RendererTextInput({ focused: true });
  private readonly autocomplete: RendererEditorAutocompleteController;
  private readonly history: string[] = [];
  private historyIndex: number | undefined;
  private argumentHints: ReadonlyMap<string, string> = new Map();

  constructor(private readonly options: NativeTUIEditorOptions = {}) {
    this.autocomplete = new RendererEditorAutocompleteController({
      requestRender: options.requestRender,
      maxVisible: options.autocompleteMaxVisible,
    });
  }

  getText(): string {
    return this.input.getText();
  }

  getExpandedText(): string {
    return this.getText();
  }

  getLines(): string[] {
    return [...this.input.getLines()];
  }

  getCursor(): RendererEditorCursor {
    const cursor = this.input.getCursor();
    return { line: cursor.line, col: cursor.column };
  }

  setCursorPosition(cursor: RendererEditorCursor): void {
    this.input.setCursor({ line: cursor.line, column: cursor.col });
  }

  setText(text: string): void {
    this.setTextInternal(text, true);
    this.closeAutocomplete(false);
  }

  insertTextAtCursor(text: string): void {
    this.applyInputMutation(() =>
      this.input.handleInput({ type: 'paste', raw: text, text }),
    );
  }

  setArgumentHints(hints: ReadonlyMap<string, string>): void {
    this.argumentHints = hints;
  }

  setAutocompleteProvider(provider: AutocompleteProvider): void {
    this.autocomplete.setProvider(provider);
  }

  isShowingAutocomplete(): boolean {
    return this.autocomplete.isOpen();
  }

  addToHistory(text: string): void {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    if (this.history.at(-1) === trimmed) return;
    this.history.push(trimmed);
    this.historyIndex = undefined;
  }

  recordNativeInputInteraction(): void {
    this.onNonEscapeInput?.();
  }

  reopenAutocompleteAfterNativeInput(): void {
    void this.requestAutocomplete({ force: this.inputMode === 'bash' });
  }

  invalidate(): void {}

  handleInput(data: string): void {
    const normalized = data;
    if (isKeyRelease(normalized)) return;
    if (!matchesKey(normalized, Key.escape)) this.onNonEscapeInput?.();

    if (this.handleAppShortcut(normalized)) return;

    const events = this.decoder.decode(normalized);
    if (this.autocomplete.isOpen()) {
      for (const event of events) {
        if (event.type !== 'key' || event.eventType === 'release') continue;
        const result = this.autocomplete.handleNativeInput(event, this);
        if (!result.handled) continue;
        if (result.completion !== undefined) {
          this.applyAutocompleteCompletion(result.completion);
        }
        return;
      }
    }

    for (const event of events) {
      if (event.type === 'paste') {
        this.onTextPaste?.();
        this.applyPromptAwareMutation(() => this.input.handleInput(event), event.text);
        continue;
      }
      if (event.type !== 'key') continue;
      if (event.eventType === 'release') continue;

      if (event.key === 'enter' && !event.shift && event.raw === '\r') {
        this.submit();
        continue;
      }
      if (event.key === 'up' && this.getText().length === 0) {
        if (this.onUpArrowEmpty?.() === true) continue;
        this.navigateHistory(-1);
        continue;
      }
      if (event.key === 'down' && this.getText().length === 0) {
        if (this.onDownArrowEmpty?.() === true) continue;
        this.navigateHistory(1);
        continue;
      }
      if (this.getText().length === 0 && this.handleEmptyPromptNavigation(event.key)) {
        continue;
      }
      if (event.key === 'escape') {
        if (this.closeAutocomplete(true)) {
          continue;
        } else if (this.inputMode === 'bash' && this.getText().length === 0) {
          this.setInputMode('prompt');
        } else {
          this.onEscape?.();
        }
        continue;
      }
      if (event.key === 'tab') continue;

      const trigger = printableChar(normalized);
      if (
        this.inputMode === 'prompt' &&
        trigger === '!' &&
        this.getText().length === 0
      ) {
        this.setInputMode('bash');
        continue;
      }

      const changed = this.applyPromptAwareMutation(() => this.input.handleInput(event));
      if (!changed) continue;
      if (event.key === 'enter') this.onInsertNewline?.();
      void this.requestAutocomplete({ force: this.inputMode === 'bash' });
    }
  }

  render(width: number): string[] {
    return this.buildNativeEditorSurface(width).lines.map(regionLineToText);
  }

  getNativeLayoutRowCount(width: number): number {
    const safeWidth = Math.max(1, Math.floor(width));
    const overlayLines = this.getNativeOverlayLines(safeWidth);
    const contentWidth = Math.max(
      1,
      safeWidth - RENDERER_EDITOR_CONTENT_X - RENDERER_EDITOR_CONTENT_RIGHT_INSET,
    );
    const content = this.input.render({
      width: contentWidth,
      height: 1,
      focused: this.focused,
    });
    return measureRendererEditorSurfaceNaturalRows(overlayLines, content.contentRows);
  }

  getNativeOverlayLines(
    width: number,
    styles?: RendererEditorAutocompleteLineStyles,
  ): readonly RendererRegionLine[] {
    const contentWidth = Math.max(1, Math.floor(width) - RENDERER_EDITOR_CONTENT_X - 1);
    return this.autocomplete.overlayLines(contentWidth, styles);
  }

  private handleAppShortcut(data: string): boolean {
    if (matchesKey(data, Key.ctrl('d'))) {
      if (this.getText().length === 0) {
        this.onCtrlD?.();
        return true;
      }
      return false;
    }
    if (matchesKey(data, Key.ctrl('c'))) {
      this.onCtrlC?.();
      return true;
    }
    if (matchesKey(data, Key.ctrl('g'))) {
      this.onOpenExternalEditor?.();
      return true;
    }
    if (matchesKey(data, Key.ctrl('o'))) {
      this.onToggleToolExpand?.();
      return true;
    }
    if (matchesKey(data, Key.ctrl('s'))) {
      this.onCtrlS?.();
      return true;
    }
    if (matchesKey(data, Key.ctrl('b')) && this.onCtrlB?.() === true) return true;
    if (matchesKey(data, Key.ctrl('t')) && this.onToggleTodoExpand?.() === true) return true;
    if (matchesKey(data, 'ctrl+shift+tab')) {
      this.onShiftTabUltra?.();
      return true;
    }
    if (matchesKey(data, 'shift+tab')) {
      this.onShiftTab?.();
      return true;
    }
    if (matchesKey(data, Key.ctrl('-'))) {
      this.onUndo?.();
      return true;
    }
    if (
      this.inputMode === 'bash' &&
      this.getText().length === 0 &&
      (matchesKey(data, Key.escape) || matchesKey(data, Key.backspace))
    ) {
      this.setInputMode('prompt');
      return true;
    }
    return false;
  }

  private handleEmptyPromptNavigation(key: string): boolean {
    switch (key) {
      case 'pageup':
        return this.onTranscriptPageUp?.() === true;
      case 'pagedown':
        return this.onTranscriptPageDown?.() === true;
      case 'home':
        return this.onTranscriptTop?.() === true;
      case 'end':
        return this.onTranscriptBottom?.() === true;
      default:
        return false;
    }
  }

  private submit(): void {
    const text = this.getExpandedText();
    this.closeAutocomplete(false);
    if (text.trim().length > 0 && this.inputMode !== 'bash') this.addToHistory(text);
    this.setTextInternal('', true);
    this.historyIndex = undefined;
    this.onSubmit?.(text);
  }

  private navigateHistory(direction: -1 | 1): void {
    if (this.history.length === 0) return;
    const current = this.historyIndex ?? this.history.length;
    const next = Math.max(0, Math.min(this.history.length, current + direction));
    this.historyIndex = next === this.history.length ? undefined : next;
    this.setTextInternal(this.historyIndex === undefined ? '' : this.history[this.historyIndex] ?? '', true);
  }

  private applyPromptAwareMutation(
    mutate: () => boolean,
    insertedText?: string,
  ): boolean {
    const wasEmptyPrompt = this.inputMode === 'prompt' && this.getText().length === 0;
    const changed = this.applyInputMutation(mutate);
    if (!changed) return false;

    if (
      wasEmptyPrompt &&
      this.inputMode === 'prompt' &&
      (insertedText ?? this.getText()).startsWith('!')
    ) {
      this.setInputMode('bash');
      if (this.getText().startsWith('!')) this.setTextInternal(this.getText().slice(1), true);
    }
    return true;
  }

  private applyInputMutation(mutate: () => boolean): boolean {
    const before = this.getText();
    const handled = mutate();
    if (!handled) return false;
    const after = this.getText();
    if (after !== before) {
      this.historyIndex = undefined;
      this.onChange?.(after);
    }
    return true;
  }

  private setTextInternal(text: string, notify: boolean): void {
    const before = this.getText();
    this.input.setText(text);
    if (notify && this.getText() !== before) this.onChange?.(this.getText());
  }

  private setInputMode(mode: TUIEditorInputMode): void {
    if (this.inputMode === mode) return;
    this.inputMode = mode;
    this.onInputModeChange?.(mode);
  }

  private async requestAutocomplete(options: { readonly force?: boolean } = {}): Promise<void> {
    await this.autocomplete.request(this, options);
  }

  private closeAutocomplete(requestRender: boolean): boolean {
    return this.autocomplete.close(requestRender);
  }

  private applyAutocompleteCompletion(
    result: RendererEditorAutocompleteCompletion,
  ): void {
    const before = this.getText();
    this.input.setText(result.lines.join('\n'));
    this.setCursorPosition({ line: result.cursorLine, col: result.cursorCol });
    if (this.getText() !== before) this.onChange?.(this.getText());
    void this.requestAutocomplete({ force: this.inputMode === 'bash' });
  }

  private buildNativeEditorSurface(width: number) {
    const safeWidth = Math.max(1, Math.floor(width));
    const contentWidth = Math.max(
      1,
      safeWidth - RENDERER_EDITOR_CONTENT_X - RENDERER_EDITOR_CONTENT_RIGHT_INSET,
    );
    const overlayLines = this.getNativeOverlayLines(safeWidth);
    const content = this.input.render({
      width: contentWidth,
      focused: this.focused,
    });
    const surfaceLayout = measureRendererEditorSurfaceLayout({
      height: measureRendererEditorSurfaceNaturalRows(overlayLines, content.contentRows),
      overlays: overlayLines,
    });
    return renderRendererEditorSurface({
      width: safeWidth,
      frameRows: surfaceLayout.frameRows,
      content,
      argumentHint: this.inputMode === 'bash'
        ? undefined
        : {
            text: this.getText(),
            cursor: this.getCursor(),
            hints: this.argumentHints,
            width: contentWidth,
          },
      prompt: this.inputMode === 'bash' ? '!' : '>',
      topLabel: this.inputMode === 'bash' ? RENDERER_EDITOR_SHELL_MODE_LABEL : undefined,
      connectedAbove: this.connectedAbove && !this.borderHighlighted,
      overlays: surfaceLayout.overlayLines,
      slashTokenStyle: this.inputMode === 'bash'
        ? undefined
        : resolveRendererEditorSurfaceStyles({
            commandMode: false,
            focused: this.focused,
          }).slashTokenStyle,
    });
  }
}

function regionLineToText(line: RendererRegionLine): string {
  if (typeof line === 'string') return line;
  return line.map((cell) => cell.char).join('');
}
