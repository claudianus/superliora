import { describe, expect, it, vi } from 'vitest';

import { NativeTUIEditor } from '#/tui/components/editor/native-tui-editor';
import { restoreInputText } from '#/tui/controllers/dialogs/modal-shell';
import type { DialogsHost } from '#/tui/controllers/dialogs/types';

vi.mock('#/tui/utils/render/frame-render', () => ({
  requestTUIContentRender: vi.fn(),
  requestTUILayoutRender: vi.fn(),
  flushSuppressedTUIFrame: vi.fn(),
}));

function makeHost(editor: NativeTUIEditor) {
  const statuses: string[] = [];
  const host = {
    state: {
      editor,
      editorContainer: {
        clear: vi.fn(),
        addChild: vi.fn(),
      },
      ui: { setFocus: vi.fn() },
      activeDialog: null,
      centerModalStack: [],
    },
    showStatus: (message: string) => {
      statuses.push(message);
    },
    updateEditorBorderHighlight: vi.fn(),
    nativeInputModalDispose: undefined,
  } as unknown as DialogsHost;
  return { host, statuses };
}

describe('restoreInputText prompt leak', () => {
  it('rejects stack / compileUnsafe blobs and keeps the current draft', () => {
    const editor = new NativeTUIEditor();
    editor.setText('safe draft');
    const { host, statuses } = makeHost(editor);

    restoreInputText(host, { closeAllCenterModals: vi.fn(), refreshOpenCommandHub: vi.fn() }, [
      'Error: compileUnsafe',
      '    at foo (dist-native/intermediates/main.cjs:1:1)',
      '    at Module._load (node:internal/modules/cjs/loader:1:1)',
    ].join('\n'));

    expect(editor.getText()).toBe('safe draft');
    expect(statuses.length).toBeGreaterThan(0);
  });

  it('restores an ordinary draft', () => {
    const editor = new NativeTUIEditor();
    editor.setText('old');
    const { host } = makeHost(editor);

    restoreInputText(
      host,
      { closeAllCenterModals: vi.fn(), refreshOpenCommandHub: vi.fn() },
      'please restore this draft',
    );

    expect(editor.getText()).toBe('please restore this draft');
  });
});
