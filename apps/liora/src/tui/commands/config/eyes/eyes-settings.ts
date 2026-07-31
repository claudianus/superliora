/**
 * Settings → Eyes readiness — live browser/computer runtime glance (SSOT §9.2).
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
            'Live browser-use / computer-use runtime probe · doctor hints · agent tools (read-only).',
        },
        {
          value: 'tip-slash',
          label: '/eyes tip',
          description: 'Same live report from slash command or Settings → Eyes readiness.',
        },
        {
          value: 'tip-doctor',
          label: 'Doctor / install tip',
          description: 'liora browser-use · computer-use doctor/install — probes and OS permissions.',
        },
        {
          value: 'tip-tools',
          label: 'Agent tools tip',
          description: 'BrowserStatus / VerifySurface · ComputerCapture / ComputerAct when wired.',
        },
        {
          value: 'tip-text-only',
          label: 'Text-only fallback tip',
          description: 'Missing runtimes do not block text work · Harness links eyes/hands surface.',
        },
      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        if (value === 'status') {
          void showEyesSettingsPanel(host);
          return;
        }
        if (value === 'tip-slash') {
          host.showStatus(EYES_SLASH_TIP, 'info');
          return;
        }
        if (value === 'tip-doctor') {
          host.showStatus(EYES_DOCTOR_TIP, 'info');
          return;
        }
        if (value === 'tip-tools') {
          host.showStatus(EYES_TOOLS_TIP, 'info');
          return;
        }
        if (value === 'tip-text-only') {
          host.showStatus(EYES_TEXT_ONLY_TIP, 'info');
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
