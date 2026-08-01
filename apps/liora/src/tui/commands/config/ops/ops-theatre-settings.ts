/**
 * Settings → Ops Theatre — live open actions + glance (SSOT §9.2).
 */

import { ChoicePickerComponent } from '../../../components/dialogs/picker/choice-picker';
import { UsagePanelComponent } from '../../../components/messages/usage-panel/index';
import { requestTUILayoutRender } from '../../../utils/render/frame-render';
import {
  buildOpsTheatreSettingsLines,
  OPS_THEATRE_GIT_TIP,
  OPS_THEATRE_LAYOUT_TIP,
  OPS_THEATRE_OPEN_TIP,
  OPS_THEATRE_PREMIUM_TIP,
  OPS_THEATRE_STEER_TIP,
  OPS_THEATRE_TRAY_TIP,
} from '../../../utils/ops/ops-theatre-glance';
import { dismissPickerDialog, mountPickerDialog } from '../../../utils/ui/mount-picker';
import { showOpsTheatre } from '../../ops/ops-theatre';
import { showFleetStatus } from '../../ops/fleet-status';
import { showPremiumSettings } from '../premium/premium-settings';

import type { SlashCommandHost } from '../../hub/dispatch';

export {
  OPS_THEATRE_GIT_TIP,
  OPS_THEATRE_LAYOUT_TIP,
  OPS_THEATRE_OPEN_TIP,
  OPS_THEATRE_PREMIUM_TIP,
  OPS_THEATRE_STEER_TIP,
  OPS_THEATRE_TRAY_TIP,
};

export function showOpsTheatreSettings(host: SlashCommandHost): void {
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: 'Ops Theatre',
      hint: '↑↓ · Enter · Esc',
      searchable: true,
      options: [
        {
          value: 'status',
          label: 'Ops Theatre status',
          description: 'Live intervention queue · permission · layout tips.',
        },
        {
          value: 'open',
          label: 'Open Ops Theatre',
          description: 'Full runtime theatre — git · fleet · steer · interrupt tray.',
        },
        {
          value: 'fleet',
          label: 'Fleet status',
          description: 'Parallel workers · governance · /ops fleet glance.',
        },
        {
          value: 'premium',
          label: 'Visual Quality…',
          description: 'Dopamine Ops cues share the same motion / PQ gate.',
        },
        {
          value: 'tip-open',
          label: 'Open theatre tip',
          description: OPS_THEATRE_OPEN_TIP,
        },
        {
          value: 'tip-layout',
          label: 'Layout tip',
          description: OPS_THEATRE_LAYOUT_TIP,
        },
        {
          value: 'tip-git',
          label: 'Git tip',
          description: OPS_THEATRE_GIT_TIP,
        },
        {
          value: 'tip-tray',
          label: 'Interrupt tray tip',
          description: OPS_THEATRE_TRAY_TIP,
        },
        {
          value: 'tip-steer',
          label: 'Steer tip',
          description: OPS_THEATRE_STEER_TIP,
        },
        {
          value: 'tip-premium',
          label: 'Dopamine Ops tip',
          description: OPS_THEATRE_PREMIUM_TIP,
        },
      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        if (value === 'status') {
          void showOpsTheatreSettingsPanel(host);
          return;
        }
        if (value === 'open') {
          void showOpsTheatre(host);
          return;
        }
        if (value === 'fleet') {
          void showFleetStatus(host);
          return;
        }
        if (value === 'premium') {
          showPremiumSettings(host);
          return;
        }
        if (value === 'tip-open') {
          host.showStatus(OPS_THEATRE_OPEN_TIP, 'info');
          return;
        }
        if (value === 'tip-layout') {
          host.showStatus(OPS_THEATRE_LAYOUT_TIP, 'info');
          return;
        }
        if (value === 'tip-git') {
          host.showStatus(OPS_THEATRE_GIT_TIP, 'info');
          return;
        }
        if (value === 'tip-tray') {
          host.showStatus(OPS_THEATRE_TRAY_TIP, 'info');
          return;
        }
        if (value === 'tip-steer') {
          host.showStatus(OPS_THEATRE_STEER_TIP, 'info');
          return;
        }
        if (value === 'tip-premium') {
          host.showStatus(OPS_THEATRE_PREMIUM_TIP, 'info');
        }
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: 'Ops' },
  );
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
