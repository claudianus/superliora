/**
 * Settings → Experiments — live feature flags from config (SSOT §9.2).
 * Read-only glance; toggles via Settings → Harness → Experiments.
 */

import { ChoicePickerComponent } from '../../../components/dialogs/picker/choice-picker';
import { UsagePanelComponent } from '../../../components/messages/usage-panel/index';
import { requestTUILayoutRender } from '../../../utils/render/frame-render';
import { dismissPickerDialog, mountPickerDialog } from '../../../utils/ui/mount-picker';
import {
  buildExperimentsSettingsLines,
  EXPERIMENTS_CODEGRAPH_TIP,
  EXPERIMENTS_FEATURE_FLAGS_TIP,
  type ExperimentsGlanceInput,
} from '#/tui/utils/experiments/experiments-glance';

import type { SlashCommandHost } from '../../hub/dispatch';

export {
  EXPERIMENTS_CODEGRAPH_TIP,
  EXPERIMENTS_FEATURE_FLAGS_TIP,
};

async function loadExperimentsGlance(host: SlashCommandHost): Promise<ExperimentsGlanceInput> {
  try {
    const features = await host.harness.getExperimentalFeatures();
    return { features };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { loadError: message };
  }
}

export function showExperimentsSettings(host: SlashCommandHost): void {
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: 'Experiments',
      hint: '↑↓ · Enter · Esc',
      searchable: true,
      options: [
        {
          value: 'status',
          label: 'Experiments status',
          description:
            'Live feature flags from config + env · per-flag ON/OFF · override sources (read-only).',
        },

      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        if (value === 'status') {
          void showExperimentsSettingsPanel(host);
          return;
        }

      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: 'Experiments' },
  );
}

async function showExperimentsSettingsPanel(host: SlashCommandHost): Promise<void> {
  const glance = await loadExperimentsGlance(host);
  const lines = buildExperimentsSettingsLines(glance);

  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) => [...lines],
    borderToken: 'primary',
    title: ' Experiments ',
    enterBeatSeed: 'experiments-settings',
    requestRender: () => {
      requestTUILayoutRender(host.state);
    },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
