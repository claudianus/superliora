import type { TranscriptDetailLevel } from '#/tui/types';

/**
 * Pure helpers behind the 4-level transcript density model
 * (`minimal | compact | standard | full`).
 *
 * Components own styling and localized copy; this module only resolves the
 * effective level and aggregates chain statistics so rendering stays a thin,
 * testable projection.
 */

/**
 * Resolve the effective detail level.
 *
 * Priority: per-component local override (user clicked a block) > temporary
 * `full` (legacy expand flag / density === full) > configured level (`tui.toml`).
 * Ctrl+O now cycles `configured` through all four levels; `temporaryFull` remains
 * for callers that only flip the expand flag.
 */
export function resolveTranscriptDetail(opts: {
  configured: TranscriptDetailLevel;
  temporaryFull?: boolean;
  localOverride?: TranscriptDetailLevel;
}): TranscriptDetailLevel {
  if (opts.localOverride) return opts.localOverride;
  if (opts.temporaryFull) return 'full';
  return opts.configured;
}

/** Whether a level hides tool bodies behind a one-line representation. */
export function isOneLineToolLevel(level: TranscriptDetailLevel): boolean {
  return level === 'compact' || level === 'minimal';
}

/** All levels in display order (densest first) — used by /transcript and Ctrl+O. */
export const TRANSCRIPT_DETAIL_LEVELS = ['minimal', 'compact', 'standard', 'full'] as const;

export function isTranscriptDetailLevel(value: string): value is TranscriptDetailLevel {
  return (TRANSCRIPT_DETAIL_LEVELS as readonly string[]).includes(value);
}

/**
 * Cycle transcript density one step (Ctrl+O). Order is densest→richest so a
 * single chord walks the full 4-level model instead of a boolean expand toggle.
 */
export function nextTranscriptDetailLevel(
  current: TranscriptDetailLevel,
): TranscriptDetailLevel {
  const index = TRANSCRIPT_DETAIL_LEVELS.indexOf(current);
  const from = index >= 0 ? index : TRANSCRIPT_DETAIL_LEVELS.indexOf('standard');
  return TRANSCRIPT_DETAIL_LEVELS[(from + 1) % TRANSCRIPT_DETAIL_LEVELS.length]!;
}

/** Human-readable one-liner for toast / footer after a density cycle. */
export function formatTranscriptDetailCycleLabel(level: TranscriptDetailLevel): string {
  switch (level) {
    case 'minimal':
      return 'Transcript · minimal (one-line tools + chain summary)';
    case 'compact':
      return 'Transcript · compact (headers only)';
    case 'standard':
      return 'Transcript · standard (preview cards)';
    case 'full':
      return 'Transcript · full (expanded tool bodies)';
  }
}

export interface ToolChainStats {
  readonly toolCount: number;
  readonly filesTouched: number;
  readonly linesAdded: number;
  readonly linesRemoved: number;
  readonly failedCount: number;
  readonly firstError?: string;
  readonly startedAt: number;
  readonly settledAt?: number;
}

export function createToolChainStats(startedAt: number = Date.now()): ToolChainStats {
  return {
    toolCount: 0,
    filesTouched: 0,
    linesAdded: 0,
    linesRemoved: 0,
    failedCount: 0,
    startedAt,
  };
}

export interface ChainToolRecord {
  readonly isError?: boolean;
  readonly errorText?: string;
  readonly file?: string;
  readonly linesAdded?: number;
  readonly linesRemoved?: number;
}

/** Pure update: fold one finished tool into the chain stats. */
export function recordChainTool(stats: ToolChainStats, record: ChainToolRecord): ToolChainStats {
  const files = new Set<string>();
  if (record.file) files.add(record.file);
  return {
    ...stats,
    toolCount: stats.toolCount + 1,
    filesTouched: stats.filesTouched + files.size,
    linesAdded: stats.linesAdded + Math.max(0, record.linesAdded ?? 0),
    linesRemoved: stats.linesRemoved + Math.max(0, record.linesRemoved ?? 0),
    failedCount: stats.failedCount + (record.isError ? 1 : 0),
    firstError:
      stats.firstError ??
      (record.isError ? firstLine(record.errorText ?? 'tool failed') : undefined),
  };
}

/** Mark the chain settled (turn ended) so summaries switch to past tense. */
export function settleToolChain(stats: ToolChainStats, settledAt: number = Date.now()): ToolChainStats {
  return { ...stats, settledAt };
}

/** "42s" | "10m 4s" | "1h 2m" — compact, zero-padded only where it reads well. */
export function formatDurationShort(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${String(totalSeconds)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return seconds > 0 ? `${String(minutes)}m ${String(seconds)}s` : `${String(minutes)}m`;
  }
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes > 0 ? `${String(hours)}h ${String(restMinutes)}m` : `${String(hours)}h`;
}

/** "+42/−10" when there are edits, otherwise undefined. */
export function formatDiffChip(stats: ToolChainStats): string | undefined {
  if (stats.linesAdded === 0 && stats.linesRemoved === 0) return undefined;
  return `+${String(stats.linesAdded)}/−${String(stats.linesRemoved)}`;
}

/**
 * One-line live summary while the chain is running:
 * `⚙ Edit src/foo.ts · 7 tools · +42/−10` (segments after the label are
 * appended only when meaningful).
 */
export function formatChainLiveSummary(stats: ToolChainStats, currentLabel?: string): string {
  const parts: string[] = [];
  if (currentLabel) parts.push(currentLabel);
  parts.push(toolCountPhrase(stats.toolCount));
  const diff = formatDiffChip(stats);
  if (diff) parts.push(diff);
  return `⚙ ${parts.join(' · ')}`;
}

/**
 * Settled turn summary: `Worked for 10m 4s · 7 tools · +42/−10`.
 * Copy is intentionally English-structural here; the rendering component may
 * localize the leading phrase.
 */
export function formatChainSettledSummary(stats: ToolChainStats): string {
  const end = stats.settledAt ?? Date.now();
  const parts: string[] = [
    `Worked for ${formatDurationShort(end - stats.startedAt)}`,
    toolCountPhrase(stats.toolCount),
  ];
  const diff = formatDiffChip(stats);
  if (diff) parts.push(diff);
  if (stats.failedCount > 0) parts.push(`${String(stats.failedCount)} failed`);
  return parts.join(' · ');
}

function toolCountPhrase(count: number): string {
  return count === 1 ? '1 tool' : `${String(count)} tools`;
}

function firstLine(text: string): string {
  const line = text.split('\n', 1)[0]?.trim() ?? '';
  return line.length > 120 ? `${line.slice(0, 117)}…` : line;
}
