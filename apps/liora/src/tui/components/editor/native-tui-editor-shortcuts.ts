import { Key, matchesKey } from '#/tui/renderer';

import { printableChar } from '#/tui/utils/printable-key';
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
  // Ctrl+V (Alt+V on Windows, where terminals reserve Ctrl+V for their own
  // paste): paste an image from the OS clipboard. Falls through to a text
  // paste when the clipboard holds no image so the key never dead-ends.
  // Restores the binding the legacy editor had before the native rewrite.
  const pasteMediaKey = process.platform === 'win32' ? Key.alt('v') : Key.ctrl('v');
  if (matchesKey(data, pasteMediaKey)) {
    void handleNativeTUIEditorPasteMediaKey(host, data);
    return true;
  }
  if (matchesKey(data, Key.ctrl('d'))) {
    if (host.getText().length === 0) {
      host.onCtrlD?.();
      return true;
    }
    return false;
  }
  if (matchesKey(data, Key.ctrl('c'))) {
    host.onCtrlC?.();
    return true;
  }
  if (matchesKey(data, Key.ctrl('g'))) {
    host.onOpenExternalEditor?.();
    return true;
  }
  if (matchesKey(data, Key.ctrl('s'))) {
    host.onCtrlS?.();
    return true;
  }
  // Ctrl-B: always consume so idle presses can toast instead of emacs backward-char.
  if (matchesKey(data, Key.ctrl('b'))) {
    host.onCtrlB?.();
    return true;
  }
  // Ctrl-O: cycle transcript density (minimal → compact → standard → full).
  if (matchesKey(data, Key.ctrl('o'))) {
    host.onToggleToolExpand?.();
    return true;
  }
  // Ctrl-T: expand/collapse the todo panel; pass through when it has no overflow.
  if (matchesKey(data, Key.ctrl('t')) && host.onToggleTodoExpand?.() === true) {
    return true;
  }
  if (matchesKey(data, 'shift+tab')) {
    host.onShiftTab?.();
    return true;
  }
  // Ctrl-R: always consume; host toasts when the prompt is non-empty.
  if (matchesKey(data, Key.ctrl('r'))) {
    host.onHistorySearch?.();
    return true;
  }
  // Ctrl-K / Ctrl-Space: Command Hub (One-search).
  if (matchesKey(data, Key.ctrl('k')) || matchesKey(data, Key.ctrl(Key.space))) {
    host.onCommandHub?.();
    return true;
  }
  // Alt+J: Conductor Job Deck (Kitty CSI-u + legacy ESC+j via matchesKey).
  if (matchesKey(data, Key.alt('j'))) {
    host.onOpenJobDeck?.();
    return true;
  }
  // "?": open Command Hub when the editor is empty (native pre-handler path).
  if (host.getText().length === 0 && printableChar(data) === '?') {
    host.onCommandHub?.();
    return true;
  }
  // Ctrl-F: transcript search.
  if (matchesKey(data, Key.ctrl('f'))) {
    host.onTranscriptSearch?.();
    return true;
  }
  // Ctrl-X: stash the current draft, or pop the latest stash when empty.
  if (matchesKey(data, Key.ctrl('x'))) {
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
      // Fall through to a text paste below.
    }
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
