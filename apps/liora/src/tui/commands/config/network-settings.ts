/**
 * Settings → Network / Proxy — read-only HTTPS_PROXY tips (SSOT §9.2).
 */

import { UsagePanelComponent } from '../../components/messages/usage-panel/index';
import { requestTUILayoutRender } from '../../utils/render/frame-render';
import {
  buildNetworkSettingsLines,
  loadNetworkGlance,
} from '../../utils/network/network-glance';

import type { SlashCommandHost } from '../hub/dispatch';

export function showNetworkSettings(host: SlashCommandHost): void {
  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) =>
      [...buildNetworkSettingsLines(loadNetworkGlance(process.env))],
    borderToken: 'primary',
    title: ' Network ',
    enterBeatSeed: 'network',
    requestRender: () =>{  requestTUILayoutRender(host.state); },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
