/**
 * Settings → Ops Theatre — read-only glance + /ops tips (SSOT §9.2).
 */

import { UsagePanelComponent } from '../../../components/messages/usage-panel/index';
import { requestTUILayoutRender } from '../../../utils/render/frame-render';
import { buildOpsTheatreSettingsLines } from '../../../utils/ops/ops-theatre-glance';

import type { SlashCommandHost } from '../../hub/dispatch';

export function showOpsTheatreSettings(host: SlashCommandHost): void {
  void showOpsTheatreSettingsPanel(host);
}

async function showOpsTheatreSettingsPanel(host: SlashCommandHost): Promise<void> {
  let pendingInterventions = host.state.appState.interventionCount;
  let oldestInterventionAgeMs = host.state.appState.oldestInterventionAgeMs;
  let staleInterventions: number | undefined;
  let sessionUnavailable = false;
  const permissionMode = host.state.appState.permissionMode;

  try {
    const status = await host.requireSession().getStatus();
    if (typeof status.pendingInterventions === 'number') {
      pendingInterventions = status.pendingInterventions;
    }
    if (typeof status.oldestInterventionAgeMs === 'number') {
      oldestInterventionAgeMs = status.oldestInterventionAgeMs;
    }
    if (typeof status.staleInterventions === 'number') {
      staleInterventions = status.staleInterventions;
    }
  } catch {
    sessionUnavailable = true;
  }

  const lines = buildOpsTheatreSettingsLines({
    pendingInterventions,
    oldestInterventionAgeMs,
    staleInterventions,
    sessionUnavailable,
    permissionMode,
  });

  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) => lines,
    borderToken: 'primary',
    title: ' Ops Theatre ',
    enterBeatSeed: 'ops',
    requestRender: () => {
      requestTUILayoutRender(host.state);
    },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
