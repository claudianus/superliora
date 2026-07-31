/**
 * Settings → Network / Proxy — read-only HTTPS_PROXY tips (SSOT §9.2).
 */

import { ChoicePickerComponent } from '../../../components/dialogs/picker/choice-picker';
import { UsagePanelComponent } from '../../../components/messages/usage-panel/index';
import { requestTUILayoutRender } from '../../../utils/render/frame-render';
import {
  buildNetworkSettingsLines,
  loadNetworkGlance,
  NETWORK_NO_PROXY_TIP,
  NETWORK_PROXY_TIP,
  NETWORK_SOCKS_TIP,
} from '../../../utils/network/network-glance';
import { dismissPickerDialog, mountPickerDialog } from '../../../utils/ui/mount-picker';

import type { SlashCommandHost } from '../../hub/dispatch';

export { NETWORK_NO_PROXY_TIP, NETWORK_PROXY_TIP, NETWORK_SOCKS_TIP };

export function showNetworkSettings(host: SlashCommandHost): void {
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: 'Network',
      hint: '↑↓ · Enter · Esc',
      searchable: true,
      options: [
        {
          value: 'status',
          label: 'Network status',
          description:
            'Outbound proxy posture · live HTTP_PROXY / HTTPS_PROXY / NO_PROXY env · SOCKS detection.',
        },
        {
          value: 'tip-proxy',
          label: 'HTTP(S) proxy tip',
          description: 'HTTP_PROXY · HTTPS_PROXY · ALL_PROXY — set before `liora` starts.',
        },
        {
          value: 'tip-no-proxy',
          label: 'NO_PROXY tip',
          description: 'Bypass hosts · localhost auto-bypass · NO_PROXY=* (advanced).',
        },
        {
          value: 'tip-socks',
          label: 'SOCKS & egress tip',
          description: 'SOCKS schemes · MCP localhost stays direct · sandbox egress complement.',
        },
      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        if (value === 'status') {
          showNetworkSettingsPanel(host);
          return;
        }
        if (value === 'tip-proxy') {
          host.showStatus(NETWORK_PROXY_TIP, 'info');
          return;
        }
        if (value === 'tip-no-proxy') {
          host.showStatus(NETWORK_NO_PROXY_TIP, 'info');
          return;
        }
        if (value === 'tip-socks') {
          host.showStatus(NETWORK_SOCKS_TIP, 'info');
        }
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: 'Network / Proxy' },
  );
}

function showNetworkSettingsPanel(host: SlashCommandHost): void {
  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) =>
      [...buildNetworkSettingsLines(loadNetworkGlance(process.env))],
    borderToken: 'primary',
    title: ' Network ',
    enterBeatSeed: 'network',
    requestRender: () => {
      requestTUILayoutRender(host.state);
    },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
