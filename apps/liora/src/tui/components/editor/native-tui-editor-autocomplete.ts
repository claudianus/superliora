import type {
  RendererEditorAutocompleteCompletion,
  RendererEditorAutocompleteController,
  RendererEditorCursor,
} from '#/tui/renderer';

import type { TUIEditorInputMode } from './editor-contract';

export interface NativeTUIEditorAutocompleteHost {
  readonly inputMode: TUIEditorInputMode;
  getAutocompleteController(): RendererEditorAutocompleteController;
  getText(): string;
  applyAutocompleteText(text: string, cursor: RendererEditorCursor): void;
  onChange?: (text: string) => void;
}

/**
 * Cheap pre-filter before the autocomplete provider runs.
 * Keep this sync and allocation-light — it sits on the keystroke path.
 */
export function shouldQueryNativeTUIEditorAutocomplete(
  host: NativeTUIEditorAutocompleteHost,
): boolean {
  if (host.inputMode === 'bash') return true;
  if (host.getAutocompleteController().isOpen()) return true;
  const cursor = host.getCursor();
  const lines = host.getText().split('\n');
  const line = lines[cursor.line] ?? '';
  const before = line.slice(0, cursor.col);
  if (before.length === 0) return false;
  // Slash commands / args
  if (before.startsWith('/')) return true;
  // @file mentions
  if (before.includes('@')) return true;
  // Relative / home / absolute path fragments after whitespace
  const tokenStart = Math.max(before.lastIndexOf(' '), before.lastIndexOf('\t')) + 1;
  const token = before.slice(tokenStart);
  if (token.startsWith('./') || token.startsWith('../') || token.startsWith('~/')) return true;
  if (token.startsWith('/') && token.length > 1) return true;
  // Continuation of a path token (foo/bar)
  if (token.includes('/') && !token.startsWith('http://') && !token.startsWith('https://')) {
    return true;
  }
  return false;
}

export async function requestNativeTUIEditorAutocomplete(
  host: NativeTUIEditorAutocompleteHost,
  options: { readonly force?: boolean } = {},
): Promise<void> {
  // Plain prose has no autocomplete trigger. Skip the debounce timer + provider
  // round-trip that used to fire on every printable keystroke.
  if (options.force !== true && !shouldQueryNativeTUIEditorAutocomplete(host)) {
    if (host.getAutocompleteController().isOpen()) host.getAutocompleteController().close(true);
    return;
  }
  await host.getAutocompleteController().request(host, options);
}

export function applyNativeTUIEditorAutocompleteCompletion(
  host: NativeTUIEditorAutocompleteHost,
  result: RendererEditorAutocompleteCompletion,
  requestAutocomplete: (options?: { readonly force?: boolean }) => Promise<void>,
): void {
  const before = host.getText();
  host.applyAutocompleteText(result.lines.join('\n'), {
    line: result.cursorLine,
    col: result.cursorCol,
  });
  if (host.getText() !== before) host.onChange?.(host.getText());
  void requestAutocomplete({ force: host.inputMode === 'bash' });
}
