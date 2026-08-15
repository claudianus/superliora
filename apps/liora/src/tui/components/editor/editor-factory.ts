import type { RendererRootUI } from '#/tui/renderer';

import { ttui } from '../../utils/tui-i18n';
import type { TUIEditor } from './editor-contract';
import { NativeTUIEditor } from './native-tui-editor';

export function createTUIEditor(
  ui: RendererRootUI,
  options: { readonly onPromptLeak?: (message: string) => void } = {},
): TUIEditor {
  return new NativeTUIEditor({
    requestRender: () => {
      ui.requestRender();
    },
    onPromptLeak: options.onPromptLeak,
    leakBlockedMessage: ttui('tui.prompt.leak_blocked'),
  });
}

/** Attach showStatus after the transcript host exists. */
export function bindTUIEditorPromptLeak(
  editor: TUIEditor,
  onPromptLeak: (message: string) => void,
): void {
  if (editor instanceof NativeTUIEditor) {
    editor.setOnPromptLeak(onPromptLeak);
  }
}
