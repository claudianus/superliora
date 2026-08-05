/**
 * Compaction settings glance — live archive count + last compact tip (SSOT §9.2).
 */

import { formatTokenCount } from '#/tui/utils/agent/context-working-set';

import type { TranscriptEntry } from '#/tui/types';

export const COMPACTION_ARCHIVE_SOFT_TIP =
  'Context archive: (no session) — Expand(id=…) recovers liora_context_archive bodies.';

/** Threshold keys in loopControl — edit via liora.toml or Settings → Context presets. */
export const COMPACTION_THRESHOLD_TIP =
  'Thresholds: loopControl.compactionTriggerRatio (soft ~0.70) · compactionAsyncTriggerRatio (pre-rot ~0.55) · compactionBlockRatio · compactionTriggerTokens. Working-set caps: Settings → Context (economy/balanced/deep/full_window → maxWorkingSetTokens + asyncWorkingSetTokens). No sliders here — edit liora.toml [loopControl].';

/** Keep-recent tail + frozen prefix — compactionMaxRecentMessages in loopControl. */
export const COMPACTION_KEEP_TOKENS_TIP =
  'Keep tokens: frozen zone = leading system + initial user (engine default 2). Recent tail = loopControl.compactionMaxRecentMessages + ratio budgets. Footer nudges /compact near ~70% context usage. Manual reclaim: /compact or /compact <instruction>.';

export interface CompactionLastCompactTip {
  readonly tokensBefore?: number;
  readonly tokensAfter?: number;
  readonly instruction?: string;
  readonly result?: 'cancelled';
}

export interface CompactionSessionGlance {
  readonly archiveEntryCount?: number;
  readonly archiveMaxEntries?: number;
  readonly lastCompact?: CompactionLastCompactTip;
  readonly contextUsage?: number;
  readonly contextTokens?: number;
  readonly maxContextTokens?: number;
}

/** Most recent compaction transcript marker (resume/replay or live status entry). */
export function resolveLastCompactionFromTranscript(
  entries: readonly TranscriptEntry[] | undefined,
): CompactionLastCompactTip | undefined {
  if (entries === undefined || entries.length === 0) return undefined;
  for (let i = entries.length - 1; i >= 0; i--) {
    const data = entries[i]?.compactionData;
    if (data !== undefined) return data;
  }
  return undefined;
}

export function formatContextArchiveLine(
  glance: Pick<CompactionSessionGlance, 'archiveEntryCount' | 'archiveMaxEntries'>,
): string {
  const { archiveEntryCount, archiveMaxEntries } = glance;
  if (archiveEntryCount === undefined) {
    return COMPACTION_ARCHIVE_SOFT_TIP;
  }
  const max = archiveMaxEntries ?? 512;
  return `Context archive: ${String(archiveEntryCount)} entr${archiveEntryCount === 1 ? 'y' : 'ies'} (max ${String(max)}) · Expand(id=…) recover`;
}

export function formatLastCompactLine(last: CompactionLastCompactTip | undefined): string | undefined {
  if (last === undefined) return undefined;
  if (last.result === 'cancelled') {
    return 'Last compact: cancelled';
  }
  if (last.tokensBefore !== undefined && last.tokensAfter !== undefined) {
    const delta = `${formatTokenCount(last.tokensBefore)} → ${formatTokenCount(last.tokensAfter)}`;
    const instr = last.instruction?.trim();
    if (instr !== undefined && instr.length > 0) {
      const short = instr.length > 48 ? `${instr.slice(0, 45)}…` : instr;
      return `Last compact: ${delta} · "${short}"`;
    }
    return `Last compact: ${delta}`;
  }
  return undefined;
}


export function formatContextUsageLine(
  glance: Pick<CompactionSessionGlance, 'contextUsage' | 'contextTokens' | 'maxContextTokens'>,
): string | undefined {
  const { contextUsage, contextTokens, maxContextTokens } = glance;
  if (contextUsage === undefined || !Number.isFinite(contextUsage)) return undefined;
  const pct = `${(contextUsage * 100).toFixed(1)}%`;
  if (
    contextTokens !== undefined &&
    maxContextTokens !== undefined &&
    maxContextTokens > 0
  ) {
    return `Context usage: ${pct} · ${formatTokenCount(contextTokens)} / ${formatTokenCount(maxContextTokens)}`;
  }
  return `Context usage: ${pct}`;
}

export interface CompactionThresholdGlance {
  readonly triggerLine: string;
  readonly asyncLine: string;
  readonly workingSetLine: string;
  readonly keepLine: string;
}

export function buildCompactionSettingsLines(input: {
  readonly thresholds: CompactionThresholdGlance;
  readonly session: CompactionSessionGlance;
}): readonly string[] {
  const archiveLine = formatContextArchiveLine(input.session);
  const lastCompactLine = formatLastCompactLine(input.session.lastCompact);
  const usageLine = formatContextUsageLine(input.session);

  return [
    '── Compaction (read-only) ───────────────────',
    'Context reclaim thresholds + summarize template tips.',
    '',
    '── Session (live) ───────────────────────────',
    archiveLine,
    ...(lastCompactLine != null ? [lastCompactLine] : []),
    ...(usageLine != null ? [usageLine] : []),
    '',
    '── Thresholds (config) ──────────────────────',
    input.thresholds.triggerLine,
    input.thresholds.asyncLine,
    input.thresholds.workingSetLine,
    input.thresholds.keepLine,
    '',
    '── Working-set presets ──────────────────────',
    'Settings → Context maps economy/balanced/deep/full_window',
    'to loopControl.maxWorkingSetTokens + asyncWorkingSetTokens.',
    'Config keys: compactionTriggerRatio, compactionAsyncTriggerRatio,',
    'compactionBlockRatio, compactionTriggerTokens, compactionModel.',
    '',
    '── Template / manual reclaim ────────────────',
    '  /compact                 summarize now (session blocked)',
    '  /compact <instruction>   custom compaction instruction',
    'Engine template: compaction-instruction.md (agent-core).',
    '',
    '── Structured handoff (W9) ──────────────────',
    'First-person handoff note — not a third-party report.',
    'Preserve: latest ask · settled vs open · verified_claims · durable ids.',
    'OpenCode-style anchors: Objective · Work state · Next move · Relevant files.',
    'Post-compact: cache breakpoint reinstalled at new prefix end (L3 summary).',
    '',
    '── Expand recover ───────────────────────────',
    'Micro-compaction archives long tool/swarm bodies as [liora-archived id=…].',
    'Cleared markers carry archiveId=<12-hex> + recover=<tool> for the id path.',
    'Recover full body: Expand(id=<archiveId>) — session context-archive store.',
    'Family overflow without archive: Read receipt under ~/.superliora/tool-results/.',
    'Summary insufficient? Expand before re-running expensive tools.',
    '',
    '── Keep tokens ──────────────────────────────',
    'Frozen zone: leading system + initial user (engine default 2).',
    'Recent tail: compactionMaxRecentMessages + ratio budgets.',
    'Footer suggests /compact near ~70% context usage.',
    '',
    'No threshold sliders here — use Settings → Context or liora.toml.',
  ];
}
