/**
 * Compact-density activity language — Cursor-style two-line blocks.
 *
 * Title (bold) + dim metrics. No Used/Using verbs, no phase gutter, no
 * status bullets. Components own layout; this module is a pure projection.
 */

import { currentTheme } from '#/tui/theme';
import type { TranscriptDetailLevel } from '#/tui/types';

import { formatDurationShort, type ToolChainStats } from './transcript-density';

const COMPACT_VERBS: Record<string, { readonly live: string; readonly done: string }> = {
  Read: { live: 'Reading', done: 'Read' },
  LioraRead: { live: 'Reading', done: 'Read' },
  Edit: { live: 'Editing', done: 'Edited' },
  Write: { live: 'Writing', done: 'Wrote' },
  Grep: { live: 'Searching', done: 'Searched' },
  Glob: { live: 'Finding', done: 'Found' },
  Bash: { live: 'Running', done: 'Ran' },
  WebSearch: { live: 'Searching', done: 'Searched' },
  FetchURL: { live: 'Fetching', done: 'Fetched' },
  LioraSymbol: { live: 'Looking up', done: 'Looked up' },
  LioraTree: { live: 'Listing', done: 'Listed' },
  LioraCallgraph: { live: 'Tracing', done: 'Traced' },
  LioraReview: { live: 'Reviewing', done: 'Reviewed' },
  Review: { live: 'Reviewing', done: 'Reviewed' },
  Agent: { live: 'Delegating', done: 'Delegated' },
  Skill: { live: 'Running', done: 'Ran' },
  Memory: { live: 'Remembering', done: 'Remembered' },
  TodoList: { live: 'Updating todos', done: 'Updated todos' },
  GenerateImage: { live: 'Generating', done: 'Generated' },
  GenerateVideo: { live: 'Generating', done: 'Generated' },
  BrowserAct: { live: 'Browsing', done: 'Browsed' },
  BrowserObserve: { live: 'Observing', done: 'Observed' },
  BrowserScreenshot: { live: 'Capturing', done: 'Captured' },
  BrowserStatus: { live: 'Checking browser', done: 'Checked browser' },
  ComputerAct: { live: 'Controlling', done: 'Controlled' },
  ComputerCapture: { live: 'Capturing', done: 'Captured' },
  ComputerStatus: { live: 'Checking computer', done: 'Checked computer' },
};

const NARRATIVE_SKIP = new Set([
  'ExitPlanMode',
  'AskUserQuestion',
  'CreateGoal',
  'GetGoal',
  'SetGoalBudget',
  'UpdateGoal',
]);

const DIFF_TOKEN_RE = /(\+\d+|−\d+|-\d+)/g;

/** Quiet chrome: no ▌ gutter, no work-block tint band. */
export function isCompactQuietChrome(level: TranscriptDetailLevel): boolean {
  return level === 'compact';
}

export function usesCompactNarrativeHeader(toolName: string, isSingleSubagentView: boolean): boolean {
  if (isSingleSubagentView) return false;
  return !NARRATIVE_SKIP.has(toolName);
}

export function compactToolVerb(toolName: string, live: boolean): string {
  const mapped = COMPACT_VERBS[toolName];
  if (mapped !== undefined) return live ? mapped.live : mapped.done;
  return toolName;
}

export function styleCompactEntity(entity: string): string {
  return currentTheme.fg('syntaxString', currentTheme.bg('surfaceRaised', ` ${entity} `));
}

export function styleCompactTitle(
  verb: string,
  entity: string | null,
  tone: 'text' | 'error' = 'text',
): string {
  const verbStyled =
    tone === 'error' ? currentTheme.boldFg('error', verb) : currentTheme.boldFg('textStrong', verb);
  if (entity === null || entity.length === 0) return verbStyled;
  return `${verbStyled} ${styleCompactEntity(entity)}`;
}

/** Dim metrics line; diffs keep their own green/red. */
export function styleCompactMetrics(parts: readonly string[]): string {
  const joined = parts.filter((part) => part.length > 0).join(', ');
  if (joined.length === 0) return '';
  return colorCompactDiffRuns(joined);
}

function colorCompactDiffRuns(text: string): string {
  let out = '';
  let last = 0;
  for (const match of text.matchAll(DIFF_TOKEN_RE)) {
    const start = match.index ?? 0;
    if (start > last) out += currentTheme.fg('textMuted', text.slice(last, start));
    const token = match[0] ?? '';
    out += token.startsWith('+')
      ? currentTheme.fg('diffAdded', token)
      : currentTheme.fg('diffRemoved', token);
    last = start + token.length;
  }
  if (last < text.length) out += currentTheme.fg('textMuted', text.slice(last));
  return out;
}

export function composeCompactActivityHeader(opts: {
  readonly toolName: string;
  readonly entity: string | null;
  readonly live: boolean;
  readonly error?: boolean;
  readonly metrics?: readonly string[];
}): string {
  const title = styleCompactTitle(
    compactToolVerb(opts.toolName, opts.live),
    opts.entity,
    opts.error === true ? 'error' : 'text',
  );
  const metrics = styleCompactMetrics(opts.metrics ?? []);
  return metrics.length > 0 ? `${title}\n${metrics}` : title;
}

export function compactHeaderRowCount(header: string): number {
  if (header.length === 0) return 1;
  let rows = 1;
  for (let i = 0; i < header.length; i++) {
    if (header.charCodeAt(i) === 10) rows++;
  }
  return rows;
}

export function formatCompactThinkingLabel(opts: {
  readonly live: boolean;
  readonly elapsedMs?: number;
  readonly stalled?: boolean;
}): string {
  if (opts.live) {
    const elapsed = opts.elapsedMs ?? 0;
    const clock = elapsed >= 3_000 ? ` ${formatDurationShort(elapsed)}` : '';
    const stall = opts.stalled === true ? ' · stalled' : '';
    return currentTheme.fg('textMuted', `Thinking…${clock}${stall}`);
  }
  const elapsed = opts.elapsedMs ?? 0;
  if (elapsed < 3_000) return currentTheme.fg('textMuted', 'Thought briefly');
  return currentTheme.fg('textMuted', `Thought for ${formatDurationShort(elapsed)}`);
}

export function formatCompactChainMetrics(
  stats: ToolChainStats,
  opts: { readonly live: boolean; readonly currentLabel?: string },
): string {
  const parts: string[] = [];
  if (opts.live && opts.currentLabel !== undefined && opts.currentLabel.length > 0) {
    parts.push(opts.currentLabel);
  }
  parts.push(stats.toolCount === 1 ? '1 tool' : `${String(stats.toolCount)} tools`);
  if (stats.filesTouched > 0) {
    parts.push(stats.filesTouched === 1 ? '1 file' : `${String(stats.filesTouched)} files`);
  }
  if (stats.failedCount > 0) {
    parts.push(`${String(stats.failedCount)} failed`);
  }
  if (!opts.live && stats.settledAt !== undefined) {
    const elapsed = stats.settledAt - stats.startedAt;
    if (elapsed >= 3_000) parts.push(formatDurationShort(elapsed));
  }
  const prose = parts.join(', ');
  if (stats.linesAdded === 0 && stats.linesRemoved === 0) return prose;
  return `${prose} +${String(stats.linesAdded)} −${String(stats.linesRemoved)}`;
}
