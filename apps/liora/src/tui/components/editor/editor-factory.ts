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
    onPromptLeak: options.onPromptLeak ?? (() => {
      // Tests and headless hosts still reject leaked diagnostics without a
      // transcript sink. Production wiring supplies showStatus.
    }),
    leakBlockedMessage: ttui('tui.prompt.leak_blocked'),
  });
}
