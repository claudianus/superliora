import {
  Key,
  NativeInputDecoder,
  PasteBurst,
  RendererEditorAutocompleteController,
  RendererTextInput,
  isKeyRelease,
  matchesKey,
  RENDERER_EDITOR_CONTENT_X,
  type AutocompleteProvider,
  type NativeInputEvent,
  type NativeInputKeyEvent,
  type RendererEditorAutocompleteCompletion,
  type RendererEditorAutocompleteLineStyles,
  type RendererEditorCursor,
  type RendererRegionLine,
} from '#/tui/renderer';

import type { TUIEditor, TUIEditorGhostKind, TUIEditorInputMode } from './editor-contract';
import {
  applyNativeTUIEditorAutocompleteCompletion,
  requestNativeTUIEditorAutocomplete,
  shouldQueryNativeTUIEditorAutocomplete,
} from './native-tui-editor-autocomplete';
import { dispatchNativeTUIEditorDecodedEvents } from './native-tui-editor-dispatch';
import { navigateNativeTUIEditorHistory } from './native-tui-editor-history';
import {
  buildNativeTUIEditorSurface,
  measureNativeTUIEditorLayoutRowCount,
  regionLineToText,
} from './native-tui-editor-render';
import { handleNativeTUIEditorAppShortcut } from './native-tui-editor-shortcuts';
import type { NativeTUIEditorAutocompleteHost } from './native-tui-editor-autocomplete';
import type { NativeTUIEditorDispatchHost } from './native-tui-editor-dispatch';
import type { NativeTUIEditorHistoryHost } from './native-tui-editor-history';
import type { NativeTUIEditorRenderHost } from './native-tui-editor-render';
import type { NativeTUIEditorShortcutHost } from './native-tui-editor-shortcuts';

type NativeTUIEditorInternalHost = NativeTUIEditorShortcutHost &
  NativeTUIEditorDispatchHost &
  NativeTUIEditorHistoryHost &
  NativeTUIEditorAutocompleteHost &
  NativeTUIEditorRenderHost & {
    get autocompleteOpen(): boolean;
    getOverlayLineCount(width: number): number;
    getOverlayLines(width: number): readonly RendererRegionLine[];
    getLayoutRowCountCache():
      | { width: number; text: string; overlayCount: number; ghost: string; rows: number }
      | undefined;
    setLayoutRowCountCache(
      cache:
        | { width: number; text: string; overlayCount: number; ghost: string; rows: number }
        | undefined,
    ): void;
  };

/** Debounce window for autocomplete provider queries after each keystroke. */
const DEFAULT_AUTOCOMPLETE_DEBOUNCE_MS = 80;

export interface NativeTUIEditorOptions {
  readonly requestRender?: () => void;
  readonly autocompleteMaxVisible?: number;
  readonly autocompleteDebounceMs?: number;
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
  onOpenExternalEditor?: () => void;
  onCtrlS?: () => void;
  onCtrlB?: () => boolean | void;
  onToggleToolExpand?: () => void;
  onToggleTodoExpand?: () => boolean;
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
  onInputModeChange?: (mode: TUIEditorInputMode) => void;
  onPasteImage?: () => Promise<boolean>;
  onPasteText?: (text: string) => boolean;
  onRecall?: (entry: string) => string | undefined;
  onHistoryDraftSave?: () => unknown;
  onHistoryDraftRestore?: (state: unknown) => void;
  onHistorySearch?: () => void;
  onCommandHub?: () => void;
  onOpenJobDeck?: () => void;
  onOpenJobInbox?: () => void;
  onOpenIntentComposer?: () => void;
  onTranscriptSearch?: () => void;
  onStashToggle?: () => void;
  onAcceptGhost?: () => void;
  onCycleGhost?: (direction: -1 | 1) => void;

  private readonly pasteBurst = new PasteBurst();
  private disablePasteBurst = false;
  private historyFilter: ((entry: string) => boolean) | null = null;
  private historyDraftText: string | undefined;
  private hostHistoryDraft: unknown;
  private readonly decoder: NativeInputDecoder;
  private readonly input = new RendererTextInput({ focused: true });
  private readonly autocomplete: RendererEditorAutocompleteController;
  private readonly history: string[] = [];
  private historyIndex: number | undefined;
  private argumentHints: ReadonlyMap<string, string> = new Map();
  private layoutRowCountCache:
    | { width: number; text: string; overlayCount: number; ghost: string; rows: number }
    | undefined;
  /** Last measured content width so ↑/↓ can navigate soft-wrap rows between paints. */
  private lastContentWidth: number | undefined;
  /** Ghost text (prompt intelligence) shown dimmed after the cursor. */
  private ghostText: string | undefined;
  private ghostKind: TUIEditorGhostKind = 'inline';

  constructor(private readonly options: NativeTUIEditorOptions = {}) {
    this.autocomplete = new RendererEditorAutocompleteController({
      requestRender: options.requestRender,
      maxVisible: options.autocompleteMaxVisible,
      debounceMs: options.autocompleteDebounceMs ?? DEFAULT_AUTOCOMPLETE_DEBOUNCE_MS,
    });
    // Bare ESC is buffered briefly so multi-byte CSI sequences can complete.
    // Without onResolvedEvents the timer has no delivery path and Esc is dropped
    // (handleInput / non-streaming callers). Wire async resolve back into the
    // same key pipeline the synchronous decode path uses.
    this.decoder = new NativeInputDecoder({
      onResolvedEvents: (events) => {
        this.dispatchDecodedNativeEvents(events);
      },
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
    // Caret move invalidates any suffix ghost (would otherwise paint mid-buffer).
    this.clearGhost();
  }

  applyNativeTextInputSync(text: string, cursor: RendererEditorCursor): void {
    const before = this.getText();
    const beforeCursor = this.getCursor();
    if (text !== before) {
      this.input.setText(text);
      this.historyIndex = undefined;
    }
    this.input.setCursor({ line: cursor.line, column: cursor.col });
    // Any native sync that changes text OR caret must drop ghost so a stale
    // suffix cannot overwrite committed display cells after the new caret.
    if (
      text !== before ||
      beforeCursor.line !== cursor.line ||
      beforeCursor.col !== cursor.col
    ) {
      this.clearGhost();
    }
    if (text !== before) this.onChange?.(text);
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

  setGhostText(text: string | undefined, kind: TUIEditorGhostKind): void {
    // Inline ghost is a suffix-only overlay after the caret. Refuse mid-buffer
    // paints so dimmed completion cells cannot replace already-committed text
    // that still lives after the cursor on the same visual line.
    if (
      text !== undefined &&
      kind === 'inline' &&
      !this.isInlineGhostCaretAtBufferEnd()
    ) {
      if (this.ghostText === undefined && this.ghostKind === kind) {
        // Nothing to clear; still record kind for callers that query it.
        this.ghostKind = kind;
        return;
      }
      this.ghostText = undefined;
      this.ghostKind = kind;
      this.layoutRowCountCache = undefined;
      this.options.requestRender?.();
      return;
    }
    this.ghostText = text;
    this.ghostKind = kind;
    this.layoutRowCountCache = undefined;
    this.options.requestRender?.();
  }

  getGhostText(): string | undefined {
    return this.ghostText;
  }

  addToHistory(text: string): void {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    if (this.history.at(-1) === trimmed) return;
    this.history.push(trimmed);
    this.historyIndex = undefined;
  }

  setDisablePasteBurst(disabled: boolean): void {
    this.disablePasteBurst = disabled;
    if (disabled) this.pasteBurst.reset();
  }

  setHistoryFilter(filter: ((entry: string) => boolean) | null): void {
    this.historyFilter = filter;
  }

  recordNativeInputInteraction(): void {
    this.onNonEscapeInput?.();
  }

  reopenAutocompleteAfterNativeInput(): void {
    void this.requestAutocomplete({ force: this.inputMode === 'bash' });
  }

  handleAutocompleteNavigation(event: NativeInputKeyEvent): boolean {
    if (!this.autocomplete.isOpen()) return false;
    if (event.eventType === 'release') return false;
    const result = this.autocomplete.handleNativeInput(event, this);
    if (!result.handled) return false;
    if (result.completion !== undefined) this.applyAutocompleteCompletion(result.completion);
    return true;
  }

  invalidate(): void {}

  handleInput(data: string): void {
    const normalized = data;
    if (isKeyRelease(normalized)) return;
    if (!matchesKey(normalized, Key.escape)) this.onNonEscapeInput?.();

    if (handleNativeTUIEditorAppShortcut(this.asInternalHost(), normalized)) return;

    // Keep soft-wrap navigation width in sync even when the last frame was
    // skipped (e.g. pure-input typing holdoff). Without this, ↑/↓ falls back
    // to logical lines only and feels stuck on long single-line drafts.
    if (this.lastContentWidth !== undefined) {
      this.input.setLayoutWidth(this.lastContentWidth);
    }

    const events = this.decoder.decode(normalized);
    this.dispatchDecodedNativeEvents(events, normalized);
  }

  /**
   * Shared key pipeline for sync decode() results and bare-ESC timer resolve.
   * `rawInput` is the original string chunk when available (bash `!` trigger).
   */
  private dispatchDecodedNativeEvents(
    events: readonly NativeInputEvent[],
    rawInput?: string,
  ): void {
    dispatchNativeTUIEditorDecodedEvents(this.asInternalHost(), events, rawInput);
  }

  render(width: number): string[] {
    return this.getNativeRegionLines(width).map(regionLineToText);
  }

  getNativeRegionLines(width: number): readonly RendererRegionLine[] {
    return this.buildNativeEditorSurface(width).lines;
  }

  getNativeLayoutRowCount(width: number): number {
    return measureNativeTUIEditorLayoutRowCount(this.asInternalHost(), width);
  }

  getNativeOverlayLines(
    width: number,
    styles?: RendererEditorAutocompleteLineStyles,
  ): readonly RendererRegionLine[] {
    const contentWidth = Math.max(1, Math.floor(width) - RENDERER_EDITOR_CONTENT_X - 1);
    return this.autocomplete.overlayLines(contentWidth, styles);
  }

  /**
   * App-level shortcuts that must run before native text mutation.
   * Used by the native input router's `handlePreEditorInput` so `?` / Ctrl-K
   * reach Command Hub instead of being inserted as characters.
   */
  tryHandleAppShortcut(data: string): boolean {
    return handleNativeTUIEditorAppShortcut(this.asInternalHost(), data);
  }

  private buildNativeEditorSurface(width: number) {
    return buildNativeTUIEditorSurface(this.asInternalHost(), width);
  }

  private submit(): void {
    const text = this.getExpandedText();
    this.closeAutocomplete(false);
    if (text.trim().length > 0 && this.inputMode !== 'bash') this.addToHistory(text);
    this.setTextInternal('', true);
    this.historyIndex = undefined;
    // IME: double-defer so macOS hangul composition has time to flush any
    // pending character to stdin before we hand the text downstream.
    // See https://github.com/anomalyco/opencode/pull/22041 for the same fix.
    setTimeout(() => setTimeout(() => this.onSubmit?.(text), 0), 0);
  }

  private navigateHistory(direction: -1 | 1): void {
    navigateNativeTUIEditorHistory(this.asInternalHost(), direction);
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
    const beforeCursor = this.getCursor();
    const handled = mutate();
    if (!handled) return false;
    const after = this.getText();
    const afterCursor = this.getCursor();
    const textChanged = after !== before;
    const cursorChanged =
      afterCursor.line !== beforeCursor.line || afterCursor.col !== beforeCursor.col;
    // Keystroke or caret move: drop ghost immediately so a late LLM paint cannot
    // race back over the display. onChange stays text-only.
    if (textChanged || cursorChanged) {
      this.clearGhost();
    }
    if (textChanged) {
      this.historyIndex = undefined;
      this.onChange?.(after);
    }
    return true;
  }

  /**
   * True when the caret is at the end of the last line — the only safe place for
   * an inline suffix ghost that must not cover committed characters.
   */
  private isInlineGhostCaretAtBufferEnd(): boolean {
    const lines = this.input.getLines();
    const cursor = this.input.getCursor();
    if (cursor.line !== lines.length - 1) return false;
    const line = lines[cursor.line] ?? '';
    // Treat mid-cluster positions as "not at end" so a ghost cannot paint over
    // the trailing half of a Hangul/emoji cluster that still lives in the buffer.
    return cursor.column >= line.length;
  }

  private setTextInternal(text: string, notify: boolean): void {
    const before = this.getText();
    this.input.setText(text);
    if (text !== before) this.clearGhost();
    if (notify && this.getText() !== before) this.onChange?.(this.getText());
  }

  private setInputMode(mode: TUIEditorInputMode): void {
    if (this.inputMode === mode) return;
    this.inputMode = mode;
    this.onInputModeChange?.(mode);
  }

  private async requestAutocomplete(options: { readonly force?: boolean } = {}): Promise<void> {
    await requestNativeTUIEditorAutocomplete(this.asInternalHost(), options);
  }

  private shouldQueryAutocomplete(): boolean {
    return shouldQueryNativeTUIEditorAutocomplete(this.asInternalHost());
  }

  private closeAutocomplete(requestRender: boolean): boolean {
    return this.autocomplete.close(requestRender);
  }

  private clearGhost(): void {
    if (this.ghostText === undefined) return;
    this.ghostText = undefined;
    this.layoutRowCountCache = undefined;
    this.options.requestRender?.();
  }

  private acceptGhost(): void {
    const ghost = this.ghostText;
    if (ghost === undefined) return;
    if (this.ghostKind === 'inline') {
      this.applyInputMutation(() =>
        this.input.handleInput({ type: 'paste', raw: ghost, text: ghost }),
      );
    } else {
      this.setTextInternal(ghost, true);
    }
    this.ghostText = undefined;
    this.layoutRowCountCache = undefined;
    this.onAcceptGhost?.();
    this.options.requestRender?.();
  }

  private applyAutocompleteCompletion(
    result: RendererEditorAutocompleteCompletion,
  ): void {
    applyNativeTUIEditorAutocompleteCompletion(
      this.asInternalHost(),
      result,
      (opts) => this.requestAutocomplete(opts),
    );
  }

  private applyAutocompleteText(text: string, cursor: RendererEditorCursor): void {
    this.input.setText(text);
    this.setCursorPosition(cursor);
  }

  private getTextInput(): RendererTextInput {
    return this.input;
  }

  private getPasteBurst(): PasteBurst {
    return this.pasteBurst;
  }

  private getGhostKind(): TUIEditorGhostKind {
    return this.ghostKind;
  }

  private restoreHistoryText(text: string): void {
    this.setTextInternal(text, true);
  }

  private getAutocompleteController(): RendererEditorAutocompleteController {
    return this.autocomplete;
  }

  private resetPasteBurst(): void {
    this.pasteBurst.reset();
  }

  private applyTextPaste(raw: string, text: string): void {
    this.applyPromptAwareMutation(
      () => this.input.handleInput({ type: 'paste', raw, text }),
      text,
    );
  }

  private requestRender(): void {
    this.options.requestRender?.();
  }

  private getDisablePasteBurst(): boolean {
    return this.disablePasteBurst;
  }

  private getHistory(): readonly string[] {
    return this.history;
  }

  private getHistoryIndex(): number | undefined {
    return this.historyIndex;
  }

  private setHistoryIndex(index: number | undefined): void {
    this.historyIndex = index;
  }

  private getHistoryFilter(): ((entry: string) => boolean) | null {
    return this.historyFilter;
  }

  private getHistoryDraftText(): string | undefined {
    return this.historyDraftText;
  }

  private setHistoryDraftText(text: string | undefined): void {
    this.historyDraftText = text;
  }

  private getHostHistoryDraft(): unknown {
    return this.hostHistoryDraft;
  }

  private setHostHistoryDraft(state: unknown): void {
    this.hostHistoryDraft = state;
  }

  private setLastContentWidth(width: number): void {
    this.lastContentWidth = width;
  }

  private get autocompleteOpen(): boolean {
    return this.autocomplete.isOpen();
  }

  private getOverlayLineCount(width: number): number {
    return this.getNativeOverlayLines(width).length;
  }

  private getOverlayLines(width: number): readonly RendererRegionLine[] {
    return this.getNativeOverlayLines(width);
  }

  private getLayoutRowCountCache():
    | { width: number; text: string; overlayCount: number; ghost: string; rows: number }
    | undefined {
    return this.layoutRowCountCache;
  }

  private setLayoutRowCountCache(
    cache:
      | { width: number; text: string; overlayCount: number; ghost: string; rows: number }
      | undefined,
  ): void {
    this.layoutRowCountCache = cache;
  }

  private asInternalHost(): NativeTUIEditorInternalHost {
    return this as unknown as NativeTUIEditorInternalHost;
  }
}
