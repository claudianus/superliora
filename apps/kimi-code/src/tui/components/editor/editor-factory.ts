import type { RendererRootUI } from '#/tui/renderer';

import type { TUIEditor } from './editor-contract';
import { NativeTUIEditor } from './native-tui-editor';

export function createTUIEditor(ui: RendererRootUI): TUIEditor {
  return new NativeTUIEditor({
    requestRender: () => {
      ui.requestRender();
    },
  });
}
