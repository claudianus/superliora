import type {
  AutocompleteProvider,
  Component,
  Focusable,
  NativeInputKeyEvent,
  RendererEditorAutocompleteLineStyles,
  RendererEditorCursor,
  RendererEditorTextInputTarget,
  RendererRegionLine,
} from '#/tui/renderer';

export type TUIEditorInputMode = 'prompt' | 'bash';

/**
 * Kind of inline ghost text shown after the editor cursor.
 * - `inline`: next-words continuation of the text being typed.
 * - `suggestion`: a recommended next task shown while the editor is empty.
 */
export type TUIEditorGhostKind = 'inline' | 'suggestion';

export interface TUIEditor
  extends Component,
    Focusable,
    RendererEditorTextInputTarget {
  inputMode: TUIEditorInputMode;
  connectedAbove: boolean;
  borderHighlighted: boolean;
  borderColor: (text: string) => string;

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
  /** History recall adapter (used by the native editor's history browse). */
  onRecall?: (entry: string) => string | undefined;
  onHistoryDraftSave?: () => unknown;
  onHistoryDraftRestore?: (state: unknown) => void;
  /** Opens the input-history fuzzy-search dialog (Ctrl-R). */
  onHistorySearch?: () => void;
  /** Opens the command palette (Ctrl-Space). */
  onCommandPalette?: () => void;
  /** Opens the transcript search overlay (Ctrl-F). */
  onTranscriptSearch?: () => void;
  /** Re-sends the last failed user turn (Ctrl-Y when idle + last turn failed). */
  onRetryLastTurn?: () => void;
  /**
   * Ghost text (prompt intelligence) callbacks. `onAcceptGhost` fires when Tab
   * confirms the visible ghost text; `onCycleGhost` fires when ↑/↓ rotates the
   * suggestion candidates while the editor is empty.
   */
  onAcceptGhost?: () => void;
  onCycleGhost?: (direction: -1 | 1) => void;

  getLines(): string[];
  getExpandedText(): string;
  getCursor(): RendererEditorCursor;
  setCursorPosition(cursor: RendererEditorCursor): void;
  insertTextAtCursor(text: string): void;
  handleInput(data: string): void;
  setArgumentHints(hints: ReadonlyMap<string, string>): void;
  setAutocompleteProvider(provider: AutocompleteProvider): void;
  isShowingAutocomplete(): boolean;
  /**
   * Set or clear the dimmed ghost text rendered after the cursor. Pass
   * `undefined` to clear. `kind` distinguishes inline completion from an
   * empty-editor next-task suggestion (which ↑/↓ can cycle).
   */
  setGhostText(text: string | undefined, kind: TUIEditorGhostKind): void;
  /** Currently visible ghost text, or `undefined` when none. */
  getGhostText?(): string | undefined;
  getNativeLayoutRowCount?(width: number): number;
  getNativeRegionLines?(width: number): readonly RendererRegionLine[];
  getNativeOverlayLines?(
    width: number,
    styles?: RendererEditorAutocompleteLineStyles,
  ): readonly RendererRegionLine[];
  addToHistory(text: string): void;
  recordNativeInputInteraction(): void;
  reopenAutocompleteAfterNativeInput(): void;
  applyNativeTextInputSync?(text: string, cursor: RendererEditorCursor): void;
  /**
   * Handle a structured native key event for autocomplete navigation (up/down/
   * enter/tab/escape). Returns true when the autocomplete menu consumed the
   * event, so the input router can skip the cursor-key fallback that would
   * otherwise swallow up/down as vertical cursor movement.
   */
  handleAutocompleteNavigation?(event: NativeInputKeyEvent): boolean;
}
