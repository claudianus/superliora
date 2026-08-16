import {
  type NativeInputEvent,
  type RendererEditorAutocompleteCompletion,
  type RendererEditorAutocompleteController,
  type RendererTextInput,
  PasteBurst,
} from '#/tui/renderer';

import { printableChar } from '#/tui/utils/printable-key';

import {
  handleNativeTUIEditorEmptyPromptNavigation,
  type NativeTUIEditorShortcutHost,
} from './native-tui-editor-shortcuts';

export interface NativeTUIEditorDispatchHost extends NativeTUIEditorShortcutHost {
  getAutocompleteController(): RendererEditorAutocompleteController;
  getTextInput(): RendererTextInput;
  getPasteBurst(): PasteBurst;
  getDisablePasteBurst(): boolean;
  getGhostText(): string | undefined;
  getText(): string;
  getLines(): string[];
  getCursor(): import('#/tui/renderer').RendererEditorCursor;
  isBrowsingHistory(): boolean;
  onPasteText?: (text: string) => boolean;
  onTextPaste?: () => void;
  onInsertNewline?: () => void;
  onUpArrowEmpty?: () => boolean;
  onDownArrowEmpty?: () => boolean;
  onEscape?: () => void;
  navigateHistory(direction: -1 | 1): void;
  closeAutocomplete(requestRender: boolean): boolean;
  clearGhost(): void;
  acceptGhost(): void;
  shouldQueryAutocomplete(): boolean;
  applyPromptAwareMutation(mutate: () => boolean, insertedText?: string): boolean;
  submit(): void;
  applyAutocompleteCompletion(result: RendererEditorAutocompleteCompletion): void;
}

/**
 * Shared key pipeline for sync decode() results and bare-ESC timer resolve.
 * `rawInput` is the original string chunk when available (bash `!` trigger).
 */
export function dispatchNativeTUIEditorDecodedEvents(
  host: NativeTUIEditorDispatchHost,
  events: readonly NativeInputEvent[],
  rawInput?: string,
): void {
  if (host.getAutocompleteController().isOpen()) {
    for (const event of events) {
      if (event.type !== 'key' || event.eventType === 'release') continue;
      const result = host.getAutocompleteController().handleNativeInput(event, host);
      if (!result.handled) continue;
      if (result.completion !== undefined) {
        host.applyAutocompleteCompletion(result.completion);
      }
      return;
    }
  }

  for (const event of events) {
    if (event.type === 'paste') {
      // Terminal file drops arrive as a bracketed paste of file paths
      // (iTerm2 / Ghostty / WezTerm / Kitty default mode all insert the
      // dropped paths as text). Give the host first claim on the paste so
      // dropped media becomes attachments instead of raw path text.
      if (host.onPasteText?.(event.text) === true) {
        host.resetPasteBurst();
        continue;
      }
      host.onTextPaste?.();
      host.resetPasteBurst();
      host.applyPromptAwareMutation(() => host.getTextInput().handleInput(event), event.text);
      continue;
    }
    if (event.type !== 'key') continue;
    if (event.eventType === 'release') continue;

    if (event.key === 'enter' && !event.shift && event.raw === '\r') {
      if (
        !host.getDisablePasteBurst() &&
        host.getPasteBurst().shouldInsertNewlineInsteadOfSubmit(Date.now())
      ) {
        host.applyPromptAwareMutation(() => host.getTextInput().handleInput(event));
        host.getPasteBurst().extendWindow(Date.now());
        host.onInsertNewline?.();
        continue;
      }
      host.resetPasteBurst();
      host.submit();
      continue;
    }
    if (event.key === 'up' && shouldNavigateNativeTUIEditorHistory(host)) {
      // Empty-prompt ↑ is bash-style history (or queue/BTW via onUpArrowEmpty).
      // After the first restore, keep browsing while historyIndex is set.
      // Next-task ghost stays a suffix overlay; Tab accepts, arrows do not cycle.
      if (host.getText().length === 0 && host.onUpArrowEmpty?.() === true) continue;
      host.navigateHistory(-1);
      continue;
    }
    if (event.key === 'down' && shouldNavigateNativeTUIEditorHistory(host)) {
      if (host.getText().length === 0 && host.onDownArrowEmpty?.() === true) continue;
      host.navigateHistory(1);
      continue;
    }
    if (host.getText().length === 0 && handleNativeTUIEditorEmptyPromptNavigation(host, event.key)) {
      continue;
    }
    if (event.key === 'escape') {
      if (host.closeAutocomplete(true)) {
        continue;
      } else if (host.getGhostText() !== undefined) {
        host.clearGhost();
      } else if (host.inputMode === 'bash' && host.getText().length === 0) {
        host.setInputMode('prompt');
      } else {
        host.onEscape?.();
      }
      continue;
    }
    if (event.key === 'tab') {
      if (host.getAutocompleteController().isOpen()) {
        // Open-menu Tab is handled by handleAutocompleteNavigation (native path).
        // Legacy string path should not steal focus while the menu is open.
        continue;
      }
      if (host.getGhostText() !== undefined) {
        host.acceptGhost();
        continue;
      }
      // No ghost: open autocomplete when the line has a known trigger (/ @ path)
      // or bash mode. Avoid Tab spam on plain prose (no force).
      if (host.shouldQueryAutocomplete() || host.inputMode === 'bash') {
        void host.requestAutocomplete({ force: true });
      }
      continue;
    }

    const triggerSource = rawInput ?? event.raw;
    const trigger = printableChar(triggerSource);
    if (
      host.inputMode === 'prompt' &&
      trigger === '!' &&
      host.getText().length === 0
    ) {
      host.setInputMode('bash');
      continue;
    }

    const changed = host.applyPromptAwareMutation(() => host.getTextInput().handleInput(event));
    if (!changed) {
      if (!host.getDisablePasteBurst() && event.key !== 'enter') {
        host.resetPasteBurst();
      }
      continue;
    }
    if (!host.getDisablePasteBurst() && event.type === 'key') {
      const printable = printableChar(event.raw);
      if (printable !== undefined) {
        host.getPasteBurst().onPlainChar(Date.now());
      } else if (event.key !== 'enter') {
        host.resetPasteBurst();
      }
    }
    if (event.key === 'enter') host.onInsertNewline?.();
    void host.requestAutocomplete({ force: host.inputMode === 'bash' });
  }
}

/** Empty prompt, or still walking a recalled history entry. */
export function shouldNavigateNativeTUIEditorHistory(
  host: Pick<NativeTUIEditorDispatchHost, 'getText' | 'isBrowsingHistory'>,
): boolean {
  return host.getText().length === 0 || host.isBrowsingHistory();
}
