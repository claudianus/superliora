/**
 * Settings → Eyes readiness — live probe + doctor/install actions (SSOT §9.2).
 */

import { getHostPackageRoot } from '#/cli/version';
import { ChoicePickerComponent } from '../../../components/dialogs/picker/choice-picker';
import { UsagePanelComponent } from '../../../components/messages/usage-panel/index';
import { loadHarnessEyesReadiness } from '#/tui/utils/harness-eyes-readiness';
import {
  buildEyesSettingsLines,
  EYES_DOCTOR_TIP,
  EYES_SLASH_TIP,
  EYES_TEXT_ONLY_TIP,
  EYES_TOOLS_TIP,
  loadEyesSettingsGlance,
} from '#/tui/utils/eyes/eyes-glance';
import { formatErrorMessage } from '../../../utils/event-payload';
import { requestTUILayoutRender } from '../../../utils/render/frame-render';
import { dismissPickerDialog, mountPickerDialog } from '../../../utils/ui/mount-picker';

import type { SlashCommandHost } from '../../hub/dispatch';

export { EYES_DOCTOR_TIP, EYES_SLASH_TIP, EYES_TEXT_ONLY_TIP, EYES_TOOLS_TIP };

export function showEyesSettings(host: SlashCommandHost): void {
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: 'Eyes readiness',
      hint: '↑↓ · Enter · Esc',
      searchable: true,
      options: [
        {
          value: 'status',
          label: 'Eyes readiness status',
          description:
            'Live browser-use / computer-use runtime probe · doctor hints · agent tools.',
        },
        {
          value: 'probe',
          label: 'Run readiness probe',
          description: 'Same live report as /eyes — refresh browser + computer runtimes.',
        },
        {
          value: 'doctor-browser',
          label: 'Browser-use doctor tip',
          description: 'liora browser-use doctor / install — probes and Chromium deps.',
        },
        {
          value: 'doctor-computer',
          label: 'Computer-use doctor tip',
          description: 'liora computer-use doctor / install — OS permissions + capture.',
        },

      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        if (value === 'status' || value === 'probe') {
          void showEyesSettingsPanel(host);
          return;
        }
        if (value === 'doctor-browser') {
          host.showNotice(
            'Browser-use doctor',
            'Run in a shell:\n  liora browser-use doctor\n  liora browser-use install\n\n' +
              EYES_DOCTOR_TIP,
          );
          return;
        }
        if (value === 'doctor-computer') {
          host.showNotice(
            'Computer-use doctor',
            'Run in a shell:\n  liora computer-use doctor\n  liora computer-use install\n\n' +
              EYES_DOCTOR_TIP,
          );
          return;
        }

      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: 'Eyes readiness' },
  );
}

async function showEyesSettingsPanel(host: SlashCommandHost): Promise<void> {
  let glance = loadEyesSettingsGlance({});
  try {
    const report = await loadHarnessEyesReadiness({ packageRoot: getHostPackageRoot() });
    glance = loadEyesSettingsGlance({ report });
  } catch (error) {
    glance = loadEyesSettingsGlance({ loadError: formatErrorMessage(error) });
  }

  const lines = buildEyesSettingsLines(glance);
  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) => [...lines],
    borderToken: 'primary',
    title: ' Eyes readiness ',
    enterBeatSeed: 'eyes-settings',
    requestRender: () => {
      requestTUILayoutRender(host.state);
    },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}

/** Slash /eyes and legacy harness entry — same UsagePanel as Settings → Eyes status. */
export async function showHarnessEyesReadiness(host: SlashCommandHost): Promise<void> {
  await showEyesSettingsPanel(host);
}
