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
      title: 'Keyboard',
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
        {
          value: 'tip-registry',
          label: 'Keymap registry tip',
          description: 'keymap.ts SSOT — footer tips, Command Hub, /help consume this list.',
        },
        {
          value: 'tip-help',
          label: '/help shortcut tip',
          description: 'Full keyboard shortcut reference panel in the TUI.',
        },
        {
          value: 'tip-command-hub',
          label: 'Command Hub tip',
          description: 'Ctrl-K menu · ? when the prompt is empty.',
        },
        {
          value: 'tip-future',
          label: 'Future keybinding editor tip',
          description: 'Custom keybinding editor — future slice (read-only here).',
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
        if (value === 'tip-registry') {
          host.showStatus(KEYBINDINGS_REGISTRY_TIP, 'info');
          return;
        }
        if (value === 'tip-help') {
          host.showStatus(KEYBINDINGS_HELP_TIP, 'info');
          return;
        }
        if (value === 'tip-command-hub') {
          host.showStatus(KEYBINDINGS_COMMAND_HUB_TIP, 'info');
          return;
        }
        if (value === 'tip-future') {
          host.showStatus(KEYBINDINGS_FUTURE_EDITOR_TIP, 'info');
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
    title: ' Keybindings ',
    enterBeatSeed: 'keybindings',
    requestRender: () => {
      requestTUILayoutRender(host.state);
    },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
