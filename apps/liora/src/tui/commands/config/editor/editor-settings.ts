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
import { saveTuiConfig } from '#/tui/config';
import { EDITOR_PRESETS } from '#/tui/utils/settings/editor-presets';
import { SETTINGS_PRESETS_ROW, showSettingPresetsPicker } from '#/tui/utils/settings/show-setting-presets';
import { formatErrorMessage } from '#/tui/utils/event-payload';
import { showEditorPicker } from '../appearance/editor-theme';
import { tuiConfigFromHost } from '../appearance/tui-persist';

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
        SETTINGS_PRESETS_ROW,
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

      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        if (value === 'presets') {
          showSettingPresetsPicker(host, {
            title: 'Editor / notifications presets',
            catalog: EDITOR_PRESETS,
            onApply: async (preset) => {
              try {
                await saveTuiConfig(tuiConfigFromHost(host, { ...preset.patch }));
                if (preset.patch.notifications !== undefined) {
                  host.setAppState({ notifications: preset.patch.notifications });
                }
                if (preset.patch.disablePasteBurst !== undefined) {
                  host.setAppState({ disablePasteBurst: preset.patch.disablePasteBurst });
                }
                host.showStatus(`Editor preset "${preset.label}" applied.`, 'success');
              } catch (error) {
                host.showError(`Failed to save editor preset: ${formatErrorMessage(error)}`);
              }
            },
          });
          return;
        }
        if (value === 'status') {
          showEditorSettingsPanel(host);
          return;
        }
        if (value === 'change-editor') {
          showEditorPicker(host);
          return;
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
