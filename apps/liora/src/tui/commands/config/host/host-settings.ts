/**
 * Settings → Host — read-only in-process vs server runtime (Sovereign Reform §9 / W8).
 * Full server URL + ACP wiring lands in W8; no transport switch control here.
 */

import { UsagePanelComponent } from '../../../components/messages/usage-panel/index';
import { requestTUILayoutRender } from '../../../utils/render/frame-render';
import { buildHostSessionLiveLines } from '../../../utils/host/sovereign-umbrella-glance';
import { loadHostGlance, buildHostSettingsLines } from '../../../utils/host/host-glance';

import type { SlashCommandHost } from '../../hub/dispatch';

export function showHostSettings(host: SlashCommandHost): void {
  void showHostSettingsPanel(host);
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
    requestRender: () =>{  requestTUILayoutRender(host.state); },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
