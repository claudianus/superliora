/**
 * Settings → Editor — live glance + external editor picker (SSOT §9.2).
 */

import { ChoicePickerComponent } from '../../../components/dialogs/picker/choice-picker';
import { UsagePanelComponent } from '../../../components/messages/usage-panel/index';
import {
  buildEditorSettingsLines,
  EDITOR_BASH_TIP,
  EDITOR_EXTERNAL_TIP,
  EDITOR_PERSIST_TIP,
  loadEditorGlance,
} from '#/tui/utils/editor/editor-glance';
import { requestTUILayoutRender } from '../../../utils/render/frame-render';
import { dismissPickerDialog, mountPickerDialog } from '../../../utils/ui/mount-picker';
import { showEditorPicker } from '../appearance/editor-theme';

import type { SlashCommandHost } from '../../hub/dispatch';

export { EDITOR_BASH_TIP, EDITOR_EXTERNAL_TIP, EDITOR_PERSIST_TIP };

export function showEditorSettings(host: SlashCommandHost): void {
  const editor = host.state.appState.editorCommand;
  const editorLabel =
    editor === null || editor === undefined || editor.length === 0
      ? 'auto-detect'
      : editor;
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: 'Editor',
      hint: '↑↓ · Enter · Esc',
      searchable: true,
      options: [
        {
          value: 'status',
          label: 'Editor status',
          description: 'Live inputMode · external editor · VISUAL/EDITOR env.',
        },
        {
          value: 'change-editor',
          label: `Change external editor · ${editorLabel}`,
          description: 'Searchable picker — $VISUAL / $EDITOR or a fixed command.',
        },
        {
          value: 'tip-external',
          label: 'External editor tip',
          description: EDITOR_EXTERNAL_TIP,
        },
        {
          value: 'tip-bash',
          label: 'Bash mode tip',
          description: EDITOR_BASH_TIP,
        },
        {
          value: 'tip-persist',
          label: 'Persist tip',
          description: EDITOR_PERSIST_TIP,
        },
      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        if (value === 'status') {
          showEditorSettingsPanel(host);
          return;
        }
        if (value === 'change-editor') {
          showEditorPicker(host);
          return;
        }
        if (value === 'tip-external') {
          host.showStatus(EDITOR_EXTERNAL_TIP, 'info');
          return;
        }
        if (value === 'tip-bash') {
          host.showStatus(EDITOR_BASH_TIP, 'info');
          return;
        }
        if (value === 'tip-persist') {
          host.showStatus(EDITOR_PERSIST_TIP, 'info');
        }
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: 'Editor' },
  );
}

function showEditorSettingsPanel(host: SlashCommandHost): void {
  const glance = loadEditorGlance({
    inputMode: host.state.appState.inputMode,
    editorCommand: host.state.appState.editorCommand,
  });
  const lines = buildEditorSettingsLines(glance);

  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) => [...lines],
    borderToken: 'primary',
    title: ' Editor ',
    enterBeatSeed: 'editor-settings',
    requestRender: () => {
      requestTUILayoutRender(host.state);
    },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
