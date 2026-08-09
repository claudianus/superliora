/**
 * Settings → Automatic updates — ChoicePicker + live glance (SSOT §9.2).
 */

import { ChoicePickerComponent } from '../../../components/dialogs/picker/choice-picker';
import { UsagePanelComponent } from '../../../components/messages/usage-panel/index';
import {
  buildUpgradeSettingsLines,
  loadUpgradeGlance,
  UPGRADE_AUTO_INSTALL_TIP,
  UPGRADE_ENV_TIP,
  UPGRADE_MANUAL_TIP,
} from '#/tui/utils/upgrade/upgrade-glance';
import { requestTUILayoutRender } from '../../../utils/render/frame-render';
import { dismissPickerDialog, mountPickerDialog } from '../../../utils/ui/mount-picker';

import type { SlashCommandHost } from '../../hub/dispatch';
import { handleUpgradeCommand } from '../../info/upgrade';
import { showUpdatePreferencePicker } from './update-preference';
import { ttui } from '../../../utils/tui-i18n';

export { UPGRADE_AUTO_INSTALL_TIP, UPGRADE_ENV_TIP, UPGRADE_MANUAL_TIP };

export function showUpgradeSettings(host: SlashCommandHost): void {
  const autoInstall = host.state.appState.upgrade.autoInstall;
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: ttui('tui.settings.pane.upgrade.title'),
      hint: '↑↓ · Enter · Esc',
      searchable: true,
      options: [
        {
          value: 'studio',
          label: 'Open Upgrade Studio',
          description: 'Check for updates, install with live progress, manage preferences.',
        },
        {
          value: 'status',
          label: 'Update status',
          description: 'auto_install · env overrides · pending notice · config path.',
        },
        {
          value: 'auto-install',
          label: `Auto-install · ${autoInstall ? 'on' : 'off'}`,
          description: 'Persist tui.toml upgrade.auto_install via preference picker.',
        },

      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        if (value === 'studio') {
          void handleUpgradeCommand(host);
          return;
        }
        if (value === 'status') {
          showUpgradeSettingsPanel(host);
          return;
        }
        if (value === 'auto-install') {
          showUpdatePreferencePicker(host);
          return;
        }

      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: 'Updates' },
  );
}

function showUpgradeSettingsPanel(host: SlashCommandHost): void {
  const glance = loadUpgradeGlance({
    autoInstall: host.state.appState.upgrade.autoInstall,
    version: host.state.appState.version,
    updateNotice: host.state.appState.updateNotice,
  });
  const lines = buildUpgradeSettingsLines(glance);

  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) => [...lines],
    borderToken: 'primary',
    title: ttui('tui.settings.pane.upgrade.panelTitle'),
    enterBeatSeed: 'upgrade-settings',
    requestRender: () => {
      requestTUILayoutRender(host.state);
    },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
