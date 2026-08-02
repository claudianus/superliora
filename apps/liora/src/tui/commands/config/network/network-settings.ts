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

      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        if (value === 'status') {
          showNetworkSettingsPanel(host);
          return;
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
