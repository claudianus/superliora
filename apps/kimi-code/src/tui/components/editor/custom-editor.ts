/**
 * Custom editor extending pi-tui Editor with app-level keybindings.
 */

import {
  Editor,
  highlightRendererEditorSlashToken,
  injectRendererEditorArgumentHint,
  injectRendererEditorPromptSymbol,
  isKeyRelease,
  matchesKey,
  Key,
  SelectList,
  wrapRendererEditorSideBorders,
  type RendererRootUI,
  type SelectItem,
} from '#/tui/renderer';

import { currentTheme } from '#/tui/theme';
import { createEditorTheme } from '#/tui/theme/pi-tui-theme';
import {
  getActiveAppearancePreferences,
  resolveAmbientEffectMode,
  shouldRenderAmbientEffects,
} from '#/tui/utils/appearance-effects';

import { printableChar } from '#/tui/utils/printable-key';

import { extractAtPrefix } from './file-mention-provider';
import type { TUIEditor } from './editor-contract';
import { WrappingSelectList } from './wrapping-select-list';

const PASTE_MARKER_RE = /\[paste #(\d+)(?: (?:\+\d+ lines|\d+ chars))?\]/g;
const BRACKET_PASTE_START = '\u001B[200~';
const BRACKET_PASTE_END = '\u001B[201~';

// Kitty keyboard protocol CSI-u sequence: ESC [ keycode ; modifier[:eventType] u.
// We intentionally match only the simple two-field form — enough to rewrite
// `ctrl+<LETTER>` with caps_lock into `ctrl+<letter>` without caps_lock.
// oxlint-disable-next-line no-control-regex -- ESC (\x1b) is required to match CSI
const KITTY_CSI_U = /^\u001B\[(\d+);(\d+)((?::\d+)*)u$/;
// Kitty modifier bit layout: shift=1, alt=2, ctrl=4, super=8, hyper=16,
// meta=32, caps_lock=64, num_lock=128. Reported value is `mask + 1`.
const CAPS_LOCK_BIT = 64;
const CTRL_BIT = 4;
const SHIFT_BIT = 1;

interface AutocompleteInternals {
  cancelAutocomplete(): void;
  readonly autocompleteAbort?: AbortController;
  readonly autocompleteDebounceTimer?: ReturnType<typeof setTimeout>;
}

interface AutocompleteListFactoryInternals {
  createAutocompleteList?: (prefix: string, items: SelectItem[]) => SelectList;
}

interface AutocompleteTriggerInternals {
  tryTriggerAutocomplete: (explicitTab?: boolean) => void;
  requestAutocomplete: (options: { force: boolean; explicitTab: boolean }) => void;
}

interface EditorCursorStateInternals {
  state: {
    lines: string[];
    cursorLine: number;
    cursorCol: number;
  };
  preferredVisualCol: number | undefined;
  snappedFromCursorCol: number | undefined;
}

// Mirror pi-tui's private SLASH_COMMAND_SELECT_LIST_LAYOUT
// (dist/components/editor.js); keep in sync when bumping pi-tui.
const SLASH_COMMAND_SELECT_LIST_LAYOUT = {
  minPrimaryColumnWidth: 12,
  maxPrimaryColumnWidth: 32,
} as const;

/**
 * Workaround for the legacy editor path when Kitty keyboard protocol is active
 * AND caps_lock is on. In that state terminals emit, e.g., `ESC[68;69u` for
 * ctrl+d (codepoint=68=`D`, modifier=ctrl|caps_lock). The renderer-owned
 * matcher accepts that form, but the inherited editor implementation still
 * sees raw input when we fall through to `super.handleInput()`.
 *
 * We rewrite the sequence back to its unlocked form before dispatching,
 * but only when ctrl is held and shift is not — i.e. exactly the
 * `ctrl+<letter>` case. Plain uppercase (caps_lock only, no ctrl) and
 * explicit ctrl+shift+<letter> are left alone.
 */
export function normalizeCapsLockedCtrl(data: string): string {
  const m = data.match(KITTY_CSI_U);
  if (m === null) return data;
  const codepoint = Number(m[1]);
  const modifierPlus1 = Number(m[2]);
  const tail = m[3] ?? '';
  if (!Number.isFinite(codepoint) || !Number.isFinite(modifierPlus1)) return data;
  const modifier = modifierPlus1 - 1;
  if ((modifier & CAPS_LOCK_BIT) === 0) return data;
  if ((modifier & CTRL_BIT) === 0) return data;
  if ((modifier & SHIFT_BIT) !== 0) return data;
  if (codepoint < 65 || codepoint > 90) return data;
  const loweredCodepoint = codepoint + 32;
  const strippedModifier = (modifier & ~CAPS_LOCK_BIT) + 1;
  return `\u001B[${String(loweredCodepoint)};${String(strippedModifier)}${tail}u`;
}

function getNewlineInput(data: string): string | undefined {
  if (data === '\n' || data === '\u001B\r' || data === '\u001B[13;2~') return data;
  if (matchesKey(data, Key.ctrl('j'))) return '\n';
  return undefined;
}

type LegacyEditorTUI = ConstructorParameters<typeof Editor>[0];

export class CustomEditor extends Editor implements TUIEditor {
  public onEscape?: () => void;
  public onCtrlD?: () => void;
  public onCtrlC?: () => void;
  public onToggleToolExpand?: () => void;
  public onOpenExternalEditor?: () => void;
  public onCtrlS?: () => void;
  /** Return `true` to consume Ctrl+B; return `false`/`undefined` to fall through to the editor default (cursor-left). */
  public onCtrlB?: () => boolean;
  /** Return `true` to consume Ctrl+T (the todo list had overflow to toggle); return `false`/`undefined` to fall through to the editor default. */
  public onToggleTodoExpand?: () => boolean;
  public onUndo?: () => void;
  public onNonEscapeInput?: () => void;
  public onInsertNewline?: () => void;
  public onTextPaste?: () => void;
  /**
   * Called when ↑ is pressed in an empty editor. Return `true` to consume
   * the key (e.g. recalled a queued message); return `false` to fall
   * through so pi-tui's built-in history navigation runs.
   */
  public onUpArrowEmpty?: () => boolean;
  public onDownArrowEmpty?: () => boolean;
  public onTranscriptPageUp?: () => boolean;
  public onTranscriptPageDown?: () => boolean;
  public onTranscriptTop?: () => boolean;
  public onTranscriptBottom?: () => boolean;
  public onShiftTab?: () => void;
  public onShiftTabUltra?: () => void;
  /** 'bash' when entering a `!` shell command. The `!` is never part of the
   *  text buffer — it is a separate mode + prompt symbol (see handleInput). */
  public inputMode: 'prompt' | 'bash' = 'prompt';
  public onInputModeChange?: (mode: 'prompt' | 'bash') => void;
  public connectedAbove = false;
  public borderHighlighted = false;
  /**
   * Called when the user triggers "paste image" (Ctrl-V on Unix,
   * Alt-V on Windows — Ctrl-V is terminal-reserved there). Return
   * `true` to consume the key (image was read and handled); return
   * `false` to let the key fall through to the normal paste path.
   * The callback may be async; pi-tui awaits it before dispatching
   * the next keystroke.
   */
  public onPasteImage?: () => Promise<boolean>;

  private consumingPaste = false;
  private consumeBuffer = '';
  private argumentHints: ReadonlyMap<string, string> = new Map();
  private lastInteractionAtMs = 0;

  setArgumentHints(hints: ReadonlyMap<string, string>): void {
    this.argumentHints = hints;
  }

  constructor(tui: RendererRootUI) {
    // paddingX: 4 reserves column 0 for the left vertical border (│),
    // column 1 as a single space between border and prompt, column 2 for
    // the `>` prompt token, and column 3 as the space between prompt and
    // content. The right side mirrors with 3 padding columns and the right
    // border at the last column.
    const theme = createEditorTheme();
    super(tui as LegacyEditorTUI, theme, { paddingX: 4 });

    // The inherited editor keeps `createAutocompleteList` private; shadow it with an
    // instance property so slash command menus render descriptions wrapped
    // to at most two lines. Non-slash completion (paths, @ mentions) keeps
    // the renderer's single-line list.
    (this as unknown as AutocompleteListFactoryInternals).createAutocompleteList = (
      prefix,
      items,
    ) => {
      if (prefix.startsWith('/')) {
        return new WrappingSelectList(
          items,
          this.getAutocompleteMaxVisible(),
          theme.selectList,
          SLASH_COMMAND_SELECT_LIST_LAYOUT,
        );
      }
      return new SelectList(items, this.getAutocompleteMaxVisible(), theme.selectList);
    };
    const triggerInternals = this as unknown as AutocompleteTriggerInternals;
    triggerInternals.tryTriggerAutocomplete = (explicitTab = false) => {
      triggerInternals.requestAutocomplete({ force: this.inputMode === 'bash', explicitTab });
    };
  }

  setCursorPosition(cursor: { readonly line: number; readonly col: number }): void {
    const internals = this as unknown as EditorCursorStateInternals;
    const lines = this.getLines();
    const line = clampEditorCursorCoordinate(cursor.line, 0, Math.max(0, lines.length - 1));
    const currentLine = lines[line] ?? '';
    const col = clampEditorCursorCoordinate(cursor.col, 0, currentLine.length);
    internals.state.cursorLine = line;
    internals.state.cursorCol = col;
    internals.preferredVisualCol = undefined;
    internals.snappedFromCursorCol = undefined;
  }

  recordNativeInputInteraction(): void {
    this.lastInteractionAtMs = Date.now();
    this.onNonEscapeInput?.();
  }

  reopenAutocompleteAfterNativeInput(): void {
    this.reopenAutocompleteAfterInput();
  }

  private expandPasteMarkerAtCursor(): boolean {
    const { line, col } = this.getCursor();
    const lines = this.getLines();
    const currentLine = lines[line] ?? '';

    for (const match of currentLine.matchAll(PASTE_MARKER_RE)) {
      const start = match.index;
      const end = start + match[0].length;
      if (col < start || col > end) continue;

      const pasteId = Number(match[1]);
      const pastes = (this as unknown as { pastes: Map<number, string> }).pastes;
      const content = pastes.get(pasteId);
      if (content === undefined) return false;

      const text = this.getText();
      const offset = lines.slice(0, line).reduce((sum, l) => sum + l.length + 1, 0) + start;
      const newText = text.slice(0, offset) + content + text.slice(offset + match[0].length);
      this.setText(newText);
      return true;
    }
    return false;
  }

  private hasAutocompleteActivity(): boolean {
    const autocomplete = this as unknown as AutocompleteInternals;
    return (
      this.isShowingAutocomplete() ||
      autocomplete.autocompleteAbort !== undefined ||
      autocomplete.autocompleteDebounceTimer !== undefined
    );
  }

  private cancelAutocompleteActivity(): void {
    // pi-tui exposes `isShowingAutocomplete()` but keeps cancellation private.
    // Kimi needs Esc to win over app-level cancel while the slash menu request is active.
    (this as unknown as AutocompleteInternals).cancelAutocomplete();
  }

  override render(width: number): string[] {
    const lines = super.render(width);
    if (lines.length < 3) return lines;
    const firstContentIdx = 1;
    const isBash = this.inputMode === 'bash';
    const text = this.getText().trimStart();
    if (text.startsWith('/') && !isBash) {
      // Paint only the FIRST editor content line; multi-line slash commands
      // are not a thing in practice.
      const original = lines[firstContentIdx];
      if (original !== undefined) {
        const highlighted = highlightRendererEditorSlashToken(
          original,
          (token) => currentTheme.boldFg('primary', token),
        );
        if (highlighted !== undefined) {
          lines[firstContentIdx] = highlighted;
        }
      }
    }
    const hint = this.computeArgumentHint();
    if (hint !== undefined) {
      const line = lines[firstContentIdx];
      if (line !== undefined) {
        lines[firstContentIdx] = injectRendererEditorArgumentHint(
          line,
          hint,
          this.getText().length,
          width,
          (text) => currentTheme.fg('textDim', text),
        );
      }
    }
    const firstContent = lines[firstContentIdx];
    const pulseInput = this.shouldPulseInput();
    if (firstContent !== undefined) {
      const withPrompt = injectRendererEditorPromptSymbol(
        firstContent,
        isBash ? '!' : '>',
        isBash
          ? (s) => this.borderColor(s)
          : pulseInput
            ? (s) => currentTheme.boldFg('glow', s)
            : undefined,
      );
      if (withPrompt !== undefined) {
        lines[firstContentIdx] = withPrompt;
      }
    }
    // `this.borderColor` is pi-tui's per-render paint function. The host may
    // overwrite it (e.g. plan-mode / slash-context highlight via
    // `editor.borderColor = chalk.hex(primary)`), so we route corners and
    // side bars through the same hook to stay in sync.
    const borderPaint = (s: string): string =>
      pulseInput && !isBash && !this.borderHighlighted
        ? currentTheme.fg('glow', s)
        : this.borderColor(s);
    return wrapRendererEditorSideBorders(lines, borderPaint, {
      connectedAbove: this.connectedAbove && !this.borderHighlighted,
      label: isBash ? ` ${currentTheme.boldFg('shellMode', '! shell mode')} ` : undefined,
    });
  }

  private computeArgumentHint(): string | undefined {
    if (this.inputMode === 'bash') return undefined;
    const text = this.getText();
    const match = /^\/(\S+)( ?)$/.exec(text);
    if (match === null) return undefined;
    const cmd = match[1];
    const trailingSpace = match[2] ?? '';
    if (cmd === undefined) return undefined;
    const hint = this.argumentHints.get(cmd);
    if (hint === undefined) return undefined;
    const { line, col } = this.getCursor();
    if (line !== 0) return undefined;
    const currentLine = this.getLines()[0] ?? '';
    if (col !== currentLine.length) return undefined;
    return trailingSpace.length > 0 ? hint : ` ${hint}`;
  }

  override handleInput(data: string): void {
    const normalized = normalizeCapsLockedCtrl(data);
    if (isKeyRelease(normalized)) {
      return;
    }
    if (!matchesKey(normalized, Key.escape)) {
      this.lastInteractionAtMs = Date.now();
      this.onNonEscapeInput?.();
    }

    // When a paste marker was just expanded, discard the trailing bracketed
    // paste data that the terminal sends alongside the Ctrl-V keystroke.
    if (this.consumingPaste) {
      this.consumeBuffer += normalized;
      if (this.consumeBuffer.includes(BRACKET_PASTE_END)) {
        this.consumingPaste = false;
        this.consumeBuffer = '';
      }
      return;
    }

    // If a bracketed paste arrives while the cursor sits on an existing
    // paste marker, expand that marker instead of pasting new content.
    if (normalized.includes(BRACKET_PASTE_START) && this.expandPasteMarkerAtCursor()) {
      if (!normalized.includes(BRACKET_PASTE_END)) {
        this.consumingPaste = true;
      }
      return;
    }

    // Paste image binding — platform-aware:
    //   Windows terminals reserve Ctrl-V for their own paste handling
    //   (e.g. Windows Terminal's Ctrl+V shortcut), so we listen for
    //   Alt-V there. Everywhere else Ctrl-V pastes. When the host
    //   reports no image available, we fall through to pi-tui's
      //   inherited text paste path so clipboard text still works.
    const pasteKey = process.platform === 'win32' ? 'alt+v' : Key.ctrl('v');
    if (matchesKey(normalized, pasteKey)) {
      if (this.expandPasteMarkerAtCursor()) {
        return;
      }
      if (this.onPasteImage !== undefined) {
        const handler = this.onPasteImage;
        void handler().then((handled) => {
          if (!handled) {
            this.onTextPaste?.();
            super.handleInput.call(this, normalized);
          }
        });
        return;
      }
    }

    if (matchesKey(normalized, Key.ctrl('d'))) {
      if (this.getText().length === 0) {
        this.onCtrlD?.();
        return;
      }
    }

    if (matchesKey(normalized, Key.ctrl('c'))) {
      this.onCtrlC?.();
      return;
    }

    if (matchesKey(normalized, Key.ctrl('g'))) {
      this.onOpenExternalEditor?.();
      return;
    }

    if (matchesKey(normalized, Key.ctrl('o'))) {
      this.onToggleToolExpand?.();
      return;
    }

    if (matchesKey(normalized, Key.ctrl('s'))) {
      this.onCtrlS?.();
      return;
    }

    if (matchesKey(normalized, Key.ctrl('b'))) {
      // Only consume the key when the handler actually detached something;
      // otherwise fall through so readline's backward-char still works at the
      // idle prompt.
      if (this.onCtrlB?.() === true) return;
    }

    if (matchesKey(normalized, Key.ctrl('t'))) {
      // Only consume the key when the todo list actually has overflow to
      // expand/collapse; otherwise fall through to the editor default.
      if (this.onToggleTodoExpand?.() === true) return;
    }

    if (matchesKey(normalized, 'ctrl+shift+tab')) {
      this.onShiftTabUltra?.();
      return;
    }

    if (matchesKey(normalized, 'shift+tab')) {
      this.onShiftTab?.();
      return;
    }

    if (matchesKey(normalized, Key.ctrl('-'))) {
      this.onUndo?.();
    }

    // Exit bash mode: Backspace/Escape on an empty `!` prompt returns to prompt
    // mode. Because the `!` is not in the buffer, "deleting" it is really
    // "delete on empty bash input".
    if (
      this.inputMode === 'bash' &&
      this.getText().length === 0 &&
      (matchesKey(normalized, Key.escape) || matchesKey(normalized, Key.backspace))
    ) {
      this.inputMode = 'prompt';
      this.onInputModeChange?.('prompt');
      return;
    }

    const newlineInput = getNewlineInput(normalized);
    if (newlineInput !== undefined) {
      this.onInsertNewline?.();
      super.handleInput(newlineInput);
      return;
    }

    if (matchesKey(normalized, Key.up)) {
      if (this.getText().length === 0 && this.onUpArrowEmpty) {
        if (this.onUpArrowEmpty()) return;
        // fall through to super so Editor's built-in history navigation runs
      }
    }

    if (matchesKey(normalized, Key.down)) {
      if (this.getText().length === 0 && this.onDownArrowEmpty) {
        if (this.onDownArrowEmpty()) return;
      }
    }

    if (this.getText().length === 0 && !this.hasAutocompleteActivity()) {
      if (matchesKey(normalized, Key.pageUp) && this.onTranscriptPageUp?.() === true) return;
      if (matchesKey(normalized, Key.pageDown) && this.onTranscriptPageDown?.() === true) return;
      if (matchesKey(normalized, Key.home) && this.onTranscriptTop?.() === true) return;
      if (matchesKey(normalized, Key.end) && this.onTranscriptBottom?.() === true) return;
    }

    if (matchesKey(normalized, Key.escape)) {
      if (this.hasAutocompleteActivity()) {
        this.cancelAutocompleteActivity();
        return;
      }
      this.onEscape?.();
      return;
    }

    // Swallow Tab while the autocomplete dropdown is closed so it does not
    // trigger pi-tui's built-in file completion. When the dropdown is open,
    // fall through so pi-tui can still accept the selected item with Tab.
    if (matchesKey(normalized, Key.tab) && !this.isShowingAutocomplete()) {
      return;
    }

    // Enter bash mode: typing `!` at the start of an empty prompt. The `!` is
    // not inserted into the buffer — it becomes the mode + prompt symbol, so the
    // cursor never has to skip over it and submit never has to strip it.
    if (
      this.inputMode === 'prompt' &&
      printableChar(normalized) === '!' &&
      this.getText().length === 0
    ) {
      this.inputMode = 'bash';
      this.onInputModeChange?.('bash');
      return;
    }

    const emptyPromptBeforeInput = this.inputMode === 'prompt' && this.getText().length === 0;
    super.handleInput(normalized);

    // Enter bash mode when `!...` is pasted into an empty prompt. The typed path
    // above handles the single `!` keystroke; this catches bracketed / Ctrl-V
    // pastes whose content starts with `!`. Strip the leading `!` so the buffer
    // holds only the command, exactly like the typed path.
    if (emptyPromptBeforeInput && this.inputMode === 'prompt' && this.getText().startsWith('!')) {
      this.inputMode = 'bash';
      this.onInputModeChange?.('bash');
      this.setText(this.getText().slice(1));
    }

    this.reopenAutocompleteAfterInput();
  }

  private reopenAutocompleteAfterInput(): void {
    if (this.isShowingAutocomplete()) return;
    const { line, col } = this.getCursor();
    const textBeforeCursor = this.getLines()[line]?.slice(0, col) ?? '';
    const editor = this as unknown as {
      requestAutocomplete?: (options: { force: boolean; explicitTab: boolean }) => void;
    };
    if (editor.requestAutocomplete === undefined) return;
    const trigger = (): void => {
      // Use force:false so slash-aware logic runs: commands with argument
      // completions return their subcommands, commands without them return
      // null. force:true would bypass the slash branch and fall through to
      // path completion, wrongly popping up the file list.
      editor.requestAutocomplete?.({ force: false, explicitTab: false });
    };

    // Reopen path / argument completion right after a `/` is typed
    // (e.g. `/add-dir /` or an `@dir/` mention).
    if (textBeforeCursor.endsWith('/')) {
      const isAtMention = extractAtPrefix(textBeforeCursor) !== null;
      if (isAtMention) {
        trigger();
      } else if (this.inputMode === 'bash') {
        if (textBeforeCursor.trimStart() !== '/') {
          editor.requestAutocomplete?.({ force: true, explicitTab: false });
        }
      } else {
        const isSlashArgument = textBeforeCursor.startsWith('/') && textBeforeCursor.includes(' ');
        if (isSlashArgument) {
          trigger();
        }
      }
      return;
    }

    // After accepting a slash command name via Tab, pi-tui inserts a trailing
    // space and closes the menu without triggering argument completion. Reopen
    // it so subcommands (e.g. `/goal ` → status/pause/…) show immediately.
    if (
      this.inputMode !== 'bash' &&
      textBeforeCursor.endsWith(' ') &&
      textBeforeCursor.startsWith('/') &&
      textBeforeCursor.includes(' ')
    ) {
      trigger();
    }
  }

  private shouldPulseInput(): boolean {
    if (Date.now() - this.lastInteractionAtMs > 420) return false;
    const appearance = getActiveAppearancePreferences();
    return (
      shouldRenderAmbientEffects(appearance) && resolveAmbientEffectMode(appearance) === 'premium'
    );
  }
}

function clampEditorCursorCoordinate(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}
