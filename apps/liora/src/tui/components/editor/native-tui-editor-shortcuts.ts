import { Key, matchesKey, matchesPrimaryMod } from '#/tui/renderer';

import { printableChar } from '#/tui/utils/printable-key';
import { clipboardHasImage } from '#/utils/clipboard/clipboard-has-image';
import { readClipboardText } from '#/utils/clipboard/clipboard-text';

import type { TUIEditorInputMode } from './editor-contract';

export interface NativeTUIEditorShortcutHost {
  readonly inputMode: TUIEditorInputMode;
  getText(): string;
  onCtrlD?: () => void;
  onCtrlC?: () => void;
  onOpenExternalEditor?: () => void;
  onCtrlS?: () => void;
  onCtrlB?: () => boolean | void;
  onToggleToolExpand?: () => void;
  onToggleTodoExpand?: () => boolean;
  onShiftTab?: () => void;
  onHistorySearch?: () => void;
  onCommandHub?: () => void;
  onOpenJobDeck?: () => void;
  onOpenJobInbox?: () => void;
  onOpenIntentComposer?: () => void;
  onTranscriptSearch?: () => void;
  onStashToggle?: () => void;
  onTranscriptPageUp?: () => boolean;
  onTranscriptPageDown?: () => boolean;
  onTranscriptTop?: () => boolean;
  onTranscriptBottom?: () => boolean;
  onPasteImage?: () => Promise<boolean>;
  onPasteText?: (text: string) => boolean;
  onTextPaste?: () => void;
  setInputMode(mode: TUIEditorInputMode): void;
  resetPasteBurst(): void;
  applyTextPaste(raw: string, text: string): void;
  requestRender(): void;
  requestAutocomplete(options?: { readonly force?: boolean }): Promise<void>;
}

/**
 * App-level shortcuts that must run before native text mutation.
 * Used by the native input router's `handlePreEditorInput` so `?` / Ctrl-K
 * reach Command Hub instead of being inserted as characters.
 */
export function handleNativeTUIEditorAppShortcut(
  host: NativeTUIEditorShortcutHost,
  data: string,
): boolean {
  // Image paste: Cmd/Ctrl+V on all OS. Windows also keeps Alt+V because
  // many terminals steal Ctrl+V for their own paste. Shift+Insert is the
  // classic terminal paste binding (Windows Terminal, ConEmu, xterm).
  // Do not expand Alt+V into a general Windows scheme.
  if (
    matchesPrimaryMod(data, 'v') ||
    matchesKey(data, 'shift+insert') ||
    (process.platform === 'win32' && matchesKey(data, Key.alt('v')))
  ) {
    void handleNativeTUIEditorPasteMediaKey(host, data);
    return true;
  }
  if (matchesPrimaryMod(data, 'd')) {
    if (host.getText().length === 0) {
      host.onCtrlD?.();
      return true;
    }
    return false;
  }
  if (matchesPrimaryMod(data, 'c')) {
    host.onCtrlC?.();
    return true;
  }
  if (matchesPrimaryMod(data, 'g')) {
    host.onOpenExternalEditor?.();
    return true;
  }
  if (matchesPrimaryMod(data, 's')) {
    host.onCtrlS?.();
    return true;
  }
  // Cmd/Ctrl-B: always consume so idle presses can toast instead of emacs backward-char.
  if (matchesPrimaryMod(data, 'b')) {
    host.onCtrlB?.();
    return true;
  }
  // Cmd/Ctrl-O: cycle transcript density (minimal → compact → standard → full).
  if (matchesPrimaryMod(data, 'o')) {
    host.onToggleToolExpand?.();
    return true;
  }
  // Cmd/Ctrl-T: expand/collapse the todo panel; pass through when it has no overflow.
  if (matchesPrimaryMod(data, 't') && host.onToggleTodoExpand?.() === true) {
    return true;
  }
  if (matchesKey(data, 'shift+tab')) {
    host.onShiftTab?.();
    return true;
  }
  // Cmd/Ctrl-R: always consume; host toasts when the prompt is non-empty.
  if (matchesPrimaryMod(data, 'r')) {
    host.onHistorySearch?.();
    return true;
  }
  // Cmd/Ctrl-K / Cmd/Ctrl-Space: Command Hub (One-search).
  if (matchesPrimaryMod(data, 'k') || matchesPrimaryMod(data, Key.space)) {
    host.onCommandHub?.();
    return true;
  }
  // Alt+J: Conductor Job Deck (Kitty CSI-u + legacy ESC+j via matchesKey).
  if (matchesKey(data, Key.alt('j'))) {
    host.onOpenJobDeck?.();
    return true;
  }
  // Alt+I: Conductor Inbox drawer (gated inside the host callback).
  if (matchesKey(data, Key.alt('i'))) {
    host.onOpenJobInbox?.();
    return true;
  }
  // Alt+B: Intent Composer brief slots (gated inside the host callback).
  if (matchesKey(data, Key.alt('b'))) {
    host.onOpenIntentComposer?.();
    return true;
  }
  // "?": open Command Hub when the editor is empty (native pre-handler path).
  if (host.getText().length === 0 && printableChar(data) === '?') {
    host.onCommandHub?.();
    return true;
  }
  // Cmd/Ctrl-F: transcript search.
  if (matchesPrimaryMod(data, 'f')) {
    host.onTranscriptSearch?.();
    return true;
  }
  // Cmd/Ctrl-X: stash the current draft, or pop the latest stash when empty.
  if (matchesPrimaryMod(data, 'x')) {
    host.onStashToggle?.();
    return true;
  }
  if (
    host.inputMode === 'bash' &&
    host.getText().length === 0 &&
    (matchesKey(data, Key.escape) || matchesKey(data, Key.backspace))
  ) {
    host.setInputMode('prompt');
    return true;
  }
  return false;
}

/**
 * Ctrl+V / Alt+V handler. Pastes a clipboard image when one is available
 * (the host reads the OS clipboard natively); otherwise pastes clipboard
 * text so the shortcut still behaves like a paste. Clipboard text also
 * passes through the drop detector, so a copied file list attaches as
 * media exactly like a terminal drop.
 */
export async function handleNativeTUIEditorPasteMediaKey(
  host: NativeTUIEditorShortcutHost,
  raw: string,
): Promise<void> {
  const handler = host.onPasteImage;
  if (handler !== undefined) {
    try {
      if ((await handler())) return;
    } catch {
      // Fall through — retry / text paste below.
    }
  }

  // Shared has-media probe with the footer hint. When the first attach attempt
  // fails but the clipboard still holds an image (native false-negative race,
  // transient PowerShell miss), retry once instead of silently swallowing the
  // paste. A permanent attach miss then falls through to text paste so Ctrl/Alt+V
  // never no-ops for the user.
  try {
    if (await clipboardHasImage()) {
      if (handler !== undefined) {
        try {
          if ((await handler())) return;
        } catch {
          // Fall through to text paste.
        }
      }
    }
  } catch {
    // Probe failed; allow text paste.
  }

  let text: string | null = null;
  try {
    text = await readClipboardText();
  } catch {
    text = null;
  }
  if (text === null || text.length === 0) return;
  const pasteText = text;

  if (host.onPasteText?.(pasteText) === true) return;

  host.onTextPaste?.();
  host.resetPasteBurst();
  host.applyTextPaste(raw, pasteText);
  host.requestRender();
  void host.requestAutocomplete({ force: host.inputMode === 'bash' });
}

export function handleNativeTUIEditorEmptyPromptNavigation(
  host: NativeTUIEditorShortcutHost,
  key: string,
): boolean {
  switch (key) {
    case 'pageup':
      return host.onTranscriptPageUp?.() === true;
    case 'pagedown':
      return host.onTranscriptPageDown?.() === true;
    case 'home':
      return host.onTranscriptTop?.() === true;
    case 'end':
      return host.onTranscriptBottom?.() === true;
    default:
      return false;
  }
}
