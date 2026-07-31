/**
 * Settings → Compaction — threshold/template tips (SSOT §9.2).
 * Read-only glance at loopControl keys; manual reclaim via /compact.
 */

import { UsagePanelComponent } from '../../components/messages/usage-panel/index';
import { requestTUILayoutRender } from '../../utils/render/frame-render';
import {
  contextWorkingSetSnapshotFromLoopControl,
  formatTokenCount,
  matchContextWorkingSetPreset,
} from '#/tui/utils/agent/context-working-set';
import {
  buildCompactionSettingsLines,
  resolveLastCompactionFromTranscript,
  type CompactionSessionGlance,
  type CompactionThresholdGlance,
} from '#/tui/utils/compaction/compaction-glance';

import type { SlashCommandHost } from '../hub/dispatch';

const DEFAULT_TRIGGER_RATIO = '0.70 (engine default)';
const DEFAULT_ASYNC_RATIO = '0.55 (engine default)';

export function showCompactionSettings(host: SlashCommandHost): void {
  void showCompactionSettingsPanel(host);
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
  const session: CompactionSessionGlance = {
    lastCompact: resolveLastCompactionFromTranscript(host.state.transcriptEntries),
  };

  try {
    const live = host.requireSession();
    const [status, context] = await Promise.all([
      live.getStatus(),
      live.getContext().catch(() => undefined),
    ]);

    session.contextUsage = status.contextUsage;
    session.contextTokens = status.contextTokens;
    session.maxContextTokens = status.maxContextTokens;
    session.microCompaction = status.microCompaction;

    const archive = context?.contextArchive;
    if (archive !== undefined) {
      session.archiveEntryCount = archive.entryCount;
      session.archiveMaxEntries = archive.maxEntries;
    } else if (context !== undefined) {
      session.archiveEntryCount = 0;
      session.archiveMaxEntries = 512;
    }
  } catch {
    session.microCompaction = host.state.appState.microCompaction ?? undefined;
  }

  return session;
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
    requestRender: () => requestTUILayoutRender(host.state),
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
