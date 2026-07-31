/**
 * Settings → Automatic updates — live config + env glance (SSOT §9.2).
 */

import { UsagePanelComponent } from '../../../components/messages/usage-panel/index';
import {
  buildUpgradeSettingsLines,
  loadUpgradeGlance,
} from '#/tui/utils/upgrade/upgrade-glance';
import { requestTUILayoutRender } from '../../../utils/render/frame-render';

import type { SlashCommandHost } from '../../hub/dispatch';

export function showUpgradeSettings(host: SlashCommandHost): void {
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
    requestRender: () =>{  requestTUILayoutRender(host.state); },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
