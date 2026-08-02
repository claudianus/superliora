/**
 * Settings → Host — runtime glance + read-only tips (Sovereign Reform §9.2 / W8).
 * No transport switch until config schema lands; status panel shows live TTFT when available.
 */

import { ChoicePickerComponent } from '../../../components/dialogs/picker/choice-picker';
import { UsagePanelComponent } from '../../../components/messages/usage-panel/index';
import { requestTUILayoutRender } from '../../../utils/render/frame-render';
import { buildHostSessionLiveLines } from '../../../utils/host/sovereign-umbrella-glance';
import {
  HOST_FUTURE_TIP,
  HOST_SOVEREIGN_UMBRELLA_TIP,
  HOST_TTFT_TIP,
  loadHostGlance,
  buildHostSettingsLines,
} from '../../../utils/host/host-glance';
import { dismissPickerDialog, mountPickerDialog } from '../../../utils/ui/mount-picker';

import type { SlashCommandHost } from '../../hub/dispatch';

export { HOST_FUTURE_TIP, HOST_SOVEREIGN_UMBRELLA_TIP, HOST_TTFT_TIP };

export function showHostSettings(host: SlashCommandHost): void {
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: 'Host',
      hint: '↑↓ · Enter · Esc',
      searchable: true,
      options: [
        {
          value: 'status',
          label: 'Host status',
          description:
            'In-process vs server client · transport · local daemon · live TTFT sample.',
        },

      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        if (value === 'status') {
          void showHostSettingsPanel(host);
          return;
        }

      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: 'Host' },
  );
}

async function showHostSettingsPanel(host: SlashCommandHost): Promise<void> {
  let sessionId: string | undefined;
  let workDir: string | undefined;
  try {
    const session = host.requireSession();
    sessionId = session.id;
    workDir = session.workDir ?? host.state.appState.workDir;
  } catch {
    workDir = host.state.appState.workDir;
  }

  const env = process.env;
  const glance = loadHostGlance({
    harness: host.harness,
    env,
    sessionId,
    workDir,
    lastStepTtft: host.state.appState.lastStepTtft ?? null,
    lastStepTtftMsWindow: host.state.appState.lastStepTtftMsWindow ?? null,
  });
  const lines = buildHostSettingsLines({
    ...glance,
    sessionLiveLines: buildHostSessionLiveLines({ env }),
  });

  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) => [...lines],
    borderToken: 'primary',
    title: ' Host ',
    enterBeatSeed: 'host',
    requestRender: () => {
      requestTUILayoutRender(host.state);
    },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
