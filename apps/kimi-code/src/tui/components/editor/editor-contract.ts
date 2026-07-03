import type {
  AutocompleteProvider,
  Component,
  Focusable,
  RendererEditorCursor,
  RendererEditorTextInputTarget,
  RendererRegionLine,
} from '#/tui/renderer';

export type TUIEditorInputMode = 'prompt' | 'bash';

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

  getLines(): string[];
  getExpandedText(): string;
  getCursor(): RendererEditorCursor;
  setCursorPosition(cursor: RendererEditorCursor): void;
  insertTextAtCursor(text: string): void;
  handleInput(data: string): void;
  setArgumentHints(hints: ReadonlyMap<string, string>): void;
  setAutocompleteProvider(provider: AutocompleteProvider): void;
  isShowingAutocomplete(): boolean;
  getNativeOverlayLines?(width: number): readonly RendererRegionLine[];
  addToHistory(text: string): void;
  recordNativeInputInteraction(): void;
  reopenAutocompleteAfterNativeInput(): void;
}
