/**
 * Settings → Context — working-set glance + memory tips (SSOT §9.2, W9).
 * Preset changes: /context or Harness → Context working set.
 */

import { homedir } from 'node:os';

import { ChoicePickerComponent } from '../../../components/dialogs/picker/choice-picker';
import { UsagePanelComponent } from '../../../components/messages/usage-panel/index';
import { requestTUILayoutRender } from '../../../utils/render/frame-render';
import {
  buildContextSettingsLines,
  CONTEXT_INSTRUCTION_SOFT_TIP,
  CONTEXT_LEARNING_SOFT_TIP,
  CONTEXT_WORKING_SET_TIP,
  discoverInstructionFiles,
  type ContextMemoryGlance,
} from '#/tui/utils/agent/context-glance';
import {
  contextWorkingSetSnapshotFromLoopControl,
  formatTokenCount,
  matchContextWorkingSetPreset,
} from '#/tui/utils/agent/context-working-set';
import { dismissPickerDialog, mountPickerDialog } from '../../../utils/ui/mount-picker';
import { getDataDir } from '#/utils/paths';
import { showContextWorkingSetPicker } from './context';
import { showCompactionSettings } from './compaction-settings';

import type { SlashCommandHost } from '../../hub/dispatch';

export { CONTEXT_INSTRUCTION_SOFT_TIP, CONTEXT_LEARNING_SOFT_TIP, CONTEXT_WORKING_SET_TIP };

export function showContextSettings(host: SlashCommandHost): void {
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: 'Context',
      hint: '↑↓ · Enter · Esc',
      searchable: true,
      options: [
        {
          value: 'status',
          label: 'Context status',
          description:
            'Working-set preset · soft/async caps · instruction files · Liora Recall counts.',
        },
        {
          value: 'working-set',
          label: 'Change working-set…',
          description: 'economy | balanced | deep | full — soft/async caps before auto-compact.',
        },
        {
          value: 'compaction',
          label: 'Compaction…',
          description: 'Threshold glance · manual /compact · micro-compaction tips.',
        },

      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        if (value === 'status') {
          void showContextSettingsPanel(host);
          return;
        }
        if (value === 'working-set') {
          void showContextWorkingSetPicker(host);
          return;
        }
        if (value === 'compaction') {
          showCompactionSettings(host);
          return;
        }

      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: 'Context' },
  );
}

async function loadMemoryGlance(host: SlashCommandHost): Promise<ContextMemoryGlance> {
  try {
    return { stats: await host.harness.memory.stats() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { statsError: message };
  }
}

async function showContextSettingsPanel(host: SlashCommandHost): Promise<void> {
  let presetLine = 'Working-set preset: balanced (engine default)';
  let capLine = 'Caps: soft/async from loopControl defaults';

  try {
    const config = await host.harness.getConfig({ reload: true });
    const loop = config.loopControl;
    const presetId = matchContextWorkingSetPreset({
      maxWorkingSetTokens: loop?.maxWorkingSetTokens,
      asyncWorkingSetTokens: loop?.asyncWorkingSetTokens,
    });
    const snap = contextWorkingSetSnapshotFromLoopControl(loop ?? {});
    presetLine = `Working-set preset: ${presetId ?? 'custom'}`;
    capLine = `Caps: soft ${formatTokenCount(snap.maxWorkingSetTokens)} · async ${formatTokenCount(snap.asyncWorkingSetTokens)}`;
  } catch {
    /* keep defaults */
  }

  const workDir = host.state.appState.workDir ?? process.cwd();
  const brandHome = host.harness.homeDir ?? getDataDir();
  const memory = await loadMemoryGlance(host);
  const instructionHits = discoverInstructionFiles({
    workDir,
    brandHome,
    realHome: homedir(),
  });

  const lines = buildContextSettingsLines({
    presetLine,
    capLine,
    instruction: { hits: instructionHits },
    memory,
  });

  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) => [...lines],
    borderToken: 'primary',
    title: ' Context ',
    enterBeatSeed: 'context-settings',
    requestRender: () => {
      requestTUILayoutRender(host.state);
    },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
