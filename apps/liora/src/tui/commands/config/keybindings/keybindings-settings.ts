/**
 * Settings → Keyboard / Keybindings — read-only keymap tips (SSOT §9.2).
 */

import { ChoicePickerComponent } from '../../../components/dialogs/picker/choice-picker';
import { UsagePanelComponent } from '../../../components/messages/usage-panel/index';
import { requestTUILayoutRender } from '../../../utils/render/frame-render';
import {
  buildKeybindingsSettingsLines,
  KEYBINDINGS_COMMAND_HUB_TIP,
  KEYBINDINGS_FUTURE_EDITOR_TIP,
  KEYBINDINGS_HELP_TIP,
  KEYBINDINGS_REGISTRY_TIP,
  loadKeybindingsGlance,
} from '../../../utils/keymap/keybindings-glance';
import { dismissPickerDialog, mountPickerDialog } from '../../../utils/ui/mount-picker';

import type { SlashCommandHost } from '../../hub/dispatch';
import { ttui } from '../../../utils/tui-i18n';

export {
  KEYBINDINGS_COMMAND_HUB_TIP,
  KEYBINDINGS_FUTURE_EDITOR_TIP,
  KEYBINDINGS_HELP_TIP,
  KEYBINDINGS_REGISTRY_TIP,
};

export function showKeybindingsSettings(host: SlashCommandHost): void {
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: ttui('tui.settings.pane.keybindings.title'),
      hint: '↑↓ · Enter · Esc',
      searchable: true,
      options: [
        {
          value: 'status',
          label: 'Keybindings status',
          description:
            'Live keymap registry counts · Mission / Ops / Fleet samples · shortcut SSOT tips.',
        },
        {
          value: 'help',
          label: 'Open /help shortcuts',
          description: 'Full keyboard shortcut reference panel in the TUI.',
        },
        {
          value: 'command-hub',
          label: 'Open Command Hub',
          description: 'Ctrl-K menu · searchable slash commands and settings.',
        },

      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        if (value === 'status') {
          showKeybindingsSettingsPanel(host);
          return;
        }
        if (value === 'help') {
          host.showHelpPanel();
          return;
        }
        if (value === 'command-hub') {
          host.showCommandHub?.();
          return;
        }

      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: 'Keyboard / Keybindings' },
  );
}

function showKeybindingsSettingsPanel(host: SlashCommandHost): void {
  const glance = loadKeybindingsGlance();
  const lines = buildKeybindingsSettingsLines(glance);

  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) => [...lines],
    borderToken: 'primary',
    title: ttui('tui.settings.pane.keybindings.panelTitle'),
    enterBeatSeed: 'keybindings',
    requestRender: () => {
      requestTUILayoutRender(host.state);
    },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
