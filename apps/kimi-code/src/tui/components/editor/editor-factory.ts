import type { RendererRootUI } from '#/tui/renderer';

import type { TUIEditorBackend } from '../../types';
import { CustomEditor } from './custom-editor';
import type { TUIEditor } from './editor-contract';
import { NativeTUIEditor } from './native-tui-editor';

export interface TUIEditorFactoryOptions {
  readonly backend?: TUIEditorBackend;
}

export function createTUIEditor(
  ui: RendererRootUI,
  options: TUIEditorFactoryOptions = {},
): TUIEditor {
  if (options.backend === 'native') {
    return new NativeTUIEditor({
      requestRender: () => {
        ui.requestRender();
      },
    });
  }
  return new CustomEditor(ui);
}
