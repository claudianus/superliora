/**
 * Settings → Compaction — status panel + threshold/keep/micro tips (SSOT §9.2).
 * Read-only glance at loopControl keys; manual reclaim via /compact.
 */

import { ChoicePickerComponent } from '../../../components/dialogs/picker/choice-picker';
import { UsagePanelComponent } from '../../../components/messages/usage-panel/index';
import { requestTUILayoutRender } from '../../../utils/render/frame-render';
import { dismissPickerDialog, mountPickerDialog } from '../../../utils/ui/mount-picker';
import {
  contextWorkingSetSnapshotFromLoopControl,
  formatTokenCount,
  matchContextWorkingSetPreset,
} from '#/tui/utils/agent/context-working-set';
import {
  buildCompactionSettingsLines,
  COMPACTION_KEEP_TOKENS_TIP,
  COMPACTION_MICRO_TIP,
  COMPACTION_THRESHOLD_TIP,
  resolveLastCompactionFromTranscript,
  type CompactionSessionGlance,
  type CompactionThresholdGlance,
} from '#/tui/utils/compaction/compaction-glance';

import { handleCompactCommand } from '../plan/plan';
import { showContextWorkingSetPicker } from './context';

import type { SlashCommandHost } from '../../hub/dispatch';

export { COMPACTION_KEEP_TOKENS_TIP, COMPACTION_MICRO_TIP, COMPACTION_THRESHOLD_TIP };

const DEFAULT_TRIGGER_RATIO = '0.70 (engine default)';
const DEFAULT_ASYNC_RATIO = '0.55 (engine default)';

export function showCompactionSettings(host: SlashCommandHost): void {
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: 'Compaction',
      hint: '↑↓ · Enter · Esc',
      searchable: true,
      options: [
        {
          value: 'status',
          label: 'Compaction status',
          description:
            'Live archive · last compact · context usage · micro-compaction · threshold glance.',
        },
        {
          value: 'run-compact',
          label: 'Run /compact now',
          description: 'Manual context reclaim for the active session (requires session).',
        },
        {
          value: 'working-set',
          label: 'Change working-set…',
          description: 'Soft/async caps that feed compaction thresholds.',
        },
        {
          value: 'tip-threshold',
          label: 'Threshold tip',
          description:
            'loopControl.compactionTriggerRatio · async pre-rot · working-set caps via Settings → Context.',
        },
        {
          value: 'tip-keep-tokens',
          label: 'Keep tokens tip',
          description:
            'Frozen prefix + compactionMaxRecentMessages · footer /compact nudge · manual reclaim.',
        },
        {
          value: 'tip-micro',
          label: 'Micro-compaction tip',
          description:
            'Tool/swarm body clears · Expand(id=…) recover · context-archive store.',
        },
      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        if (value === 'status') {
          void showCompactionSettingsPanel(host);
          return;
        }
        if (value === 'run-compact') {
          void handleCompactCommand(host, '');
          return;
        }
        if (value === 'working-set') {
          void showContextWorkingSetPicker(host);
          return;
        }
        if (value === 'tip-threshold') {
          host.showStatus(COMPACTION_THRESHOLD_TIP, 'info');
          return;
        }
        if (value === 'tip-keep-tokens') {
          host.showStatus(COMPACTION_KEEP_TOKENS_TIP, 'info');
          return;
        }
        if (value === 'tip-micro') {
          host.showStatus(COMPACTION_MICRO_TIP, 'info');
        }
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: 'Compaction' },
  );
}

function defaultThresholdGlance(): CompactionThresholdGlance {
  return {
    triggerLine: `Soft trigger ratio: ${DEFAULT_TRIGGER_RATIO}`,
    asyncLine: `Async pre-rot ratio: ${DEFAULT_ASYNC_RATIO}`,
    workingSetLine: 'Working-set cap: balanced preset (~256k default)',
    keepLine: 'Keep recent: compactionMaxRecentMessages (engine default)',
  };
}

async function loadThresholdGlance(host: SlashCommandHost): Promise<CompactionThresholdGlance> {
  const defaults = defaultThresholdGlance();
  try {
    const config = await host.harness.getConfig({ reload: true });
    const loop = config.loopControl;
    const next = { ...defaults };
    if (loop?.compactionTriggerRatio !== undefined) {
      next.triggerLine = `Soft trigger ratio: loopControl.compactionTriggerRatio = ${String(loop.compactionTriggerRatio)}`;
    }
    if (loop?.compactionAsyncTriggerRatio !== undefined) {
      next.asyncLine = `Async pre-rot ratio: loopControl.compactionAsyncTriggerRatio = ${String(loop.compactionAsyncTriggerRatio)}`;
    }
    const presetId = matchContextWorkingSetPreset({
      maxWorkingSetTokens: loop?.maxWorkingSetTokens,
      asyncWorkingSetTokens: loop?.asyncWorkingSetTokens,
    });
    const snap = contextWorkingSetSnapshotFromLoopControl(loop ?? {});
    const presetLabel = presetId ?? 'custom';
    next.workingSetLine = `Working-set cap: ${presetLabel} · soft ${formatTokenCount(snap.maxWorkingSetTokens)} · async ${formatTokenCount(snap.asyncWorkingSetTokens)}`;
    if (loop?.compactionMaxRecentMessages !== undefined) {
      next.keepLine = `Keep recent: loopControl.compactionMaxRecentMessages = ${String(loop.compactionMaxRecentMessages)}`;
    }
    return next;
  } catch {
    return defaults;
  }
}

async function loadSessionGlance(host: SlashCommandHost): Promise<CompactionSessionGlance> {
  const base: CompactionSessionGlance = {
    lastCompact: resolveLastCompactionFromTranscript(host.state.transcriptEntries),
  };

  try {
    const live = host.requireSession();
    const [status, context] = await Promise.all([
      live.getStatus(),
      live.getContext().catch(() => undefined),
    ]);

    const archive = context?.contextArchive;
    const archiveFields =
      archive !== undefined
        ? { archiveEntryCount: archive.entryCount, archiveMaxEntries: archive.maxEntries }
        : context !== undefined
          ? { archiveEntryCount: 0, archiveMaxEntries: 512 }
          : {};

    return {
      ...base,
      contextUsage: status.contextUsage,
      contextTokens: status.contextTokens,
      maxContextTokens: status.maxContextTokens,
      microCompaction: status.microCompaction,
      ...archiveFields,
    };
  } catch {
    return {
      ...base,
      microCompaction: host.state.appState.microCompaction ?? undefined,
    };
  }
}

async function showCompactionSettingsPanel(host: SlashCommandHost): Promise<void> {
  const [thresholds, session] = await Promise.all([
    loadThresholdGlance(host),
    loadSessionGlance(host),
  ]);
  const lines = buildCompactionSettingsLines({ thresholds, session });

  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) => [...lines],
    borderToken: 'primary',
    title: ' Compaction ',
    enterBeatSeed: 'compaction-settings',
    requestRender: () => {
      requestTUILayoutRender(host.state);
    },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
