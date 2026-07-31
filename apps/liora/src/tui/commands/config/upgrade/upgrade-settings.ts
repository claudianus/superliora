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

export { UPGRADE_AUTO_INSTALL_TIP, UPGRADE_ENV_TIP, UPGRADE_MANUAL_TIP };

export function showUpgradeSettings(host: SlashCommandHost): void {
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: 'Automatic updates',
      hint: '↑↓ · Enter · Esc',
      searchable: true,
      options: [
        {
          value: 'status',
          label: 'Update status',
          description: 'auto_install · env overrides · pending notice · config path.',
        },
        {
          value: 'tip-auto-install',
          label: 'Auto-install tip',
          description: UPGRADE_AUTO_INSTALL_TIP,
        },
        {
          value: 'tip-manual',
          label: 'Manual upgrade tip',
          description: UPGRADE_MANUAL_TIP,
        },
        {
          value: 'tip-env',
          label: 'Env disable tip',
          description: UPGRADE_ENV_TIP,
        },
      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        if (value === 'status') {
          showUpgradeSettingsPanel(host);
          return;
        }
        if (value === 'tip-auto-install') {
          host.showStatus(UPGRADE_AUTO_INSTALL_TIP, 'info');
          return;
        }
        if (value === 'tip-manual') {
          host.showStatus(UPGRADE_MANUAL_TIP, 'info');
          return;
        }
        if (value === 'tip-env') {
          host.showStatus(UPGRADE_ENV_TIP, 'info');
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
    title: ' Automatic updates ',
    enterBeatSeed: 'upgrade-settings',
    requestRender: () => {
      requestTUILayoutRender(host.state);
    },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
