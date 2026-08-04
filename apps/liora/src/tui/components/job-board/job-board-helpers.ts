/**
 * Pure helpers for the Conductor Job board view (no TUIState).
 */

import type { JobEventStatus } from '@superliora/protocol';

import type { ColorToken } from '#/tui/theme';
import type { ConductorJobCard, ConductorJobsSnapshot } from '../../utils/job/job-strip';

export const JOB_BOARD_MIN_WIDTH = 72;
export const JOB_BOARD_MIN_HEIGHT = 12;
export const JOB_BOARD_LIST_COL_MIN = 40;
export const JOB_BOARD_LIST_COL_MAX = 64;
export const JOB_BOARD_LIST_COL_RATIO = 0.56;
/** Inbox entries shown for one job in the drill-down pane. */
export const JOB_BOARD_DETAIL_INBOX_MAX = 6;

export interface JobStatusMeta {
  readonly glyph: string;
  readonly label: string;
  readonly token: ColorToken;
}

/** Status visuals — glyphs mirror the footer Job strip where one exists. */
export const JOB_STATUS_META: Record<JobEventStatus, JobStatusMeta> = {
  running: { glyph: '▸', label: 'running', token: 'primary' },
  queued: { glyph: '…', label: 'queued', token: 'info' },
  blocked: { glyph: '⛔', label: 'blocked', token: 'error' },
  needs_user: { glyph: '?', label: 'needs user', token: 'warning' },
  interrupted: { glyph: '⏸', label: 'interrupted', token: 'textDim' },
  done: { glyph: '✓', label: 'done', token: 'success' },
  failed: { glyph: '✗', label: 'failed', token: 'error' },
  cancelled: { glyph: '⊘', label: 'cancelled', token: 'textMuted' },
};

/** Board section order: actionable first, terminal states last. */
export const JOB_BOARD_GROUP_ORDER: readonly JobEventStatus[] = [
  'running',
  'needs_user',
  'blocked',
  'queued',
  'interrupted',
  'failed',
  'done',
  'cancelled',
];

export interface JobBoardGroup {
  readonly status: JobEventStatus;
  readonly meta: JobStatusMeta;
  readonly cards: readonly ConductorJobCard[];
}

export function sortJobCards(cards: readonly ConductorJobCard[]): ConductorJobCard[] {
  return cards.toSorted(
    (a, b) => b.priority - a.priority || b.updatedAtMs - a.updatedAtMs,
  );
}

export function groupJobCards(cards: readonly ConductorJobCard[]): JobBoardGroup[] {
  const groups: JobBoardGroup[] = [];
  for (const status of JOB_BOARD_GROUP_ORDER) {
    const matching = cards.filter((card) => card.status === status);
    if (matching.length === 0) continue;
    groups.push({ status, meta: JOB_STATUS_META[status], cards: sortJobCards(matching) });
  }
  return groups;
}

export interface JobBackpressure {
  readonly label: string;
  readonly token: ColorToken;
}

/** Pool saturation hint: queued jobs waiting on `maxConcurrent` slots. */
export function computeJobBackpressure(
  snapshot: Pick<ConductorJobsSnapshot, 'queued' | 'running' | 'maxConcurrent'>,
): JobBackpressure | undefined {
  if (snapshot.queued <= 0) return undefined;
  const max = snapshot.maxConcurrent;
  if (max === undefined || max <= 0) {
    return { label: `backpressure: ${String(snapshot.queued)} queued`, token: 'warning' };
  }
  const saturated = snapshot.running >= max;
  return {
    label: `backpressure: ${String(snapshot.queued)} queued · ${String(snapshot.running)}/${String(max)} slots`,
    token: saturated ? 'warning' : 'textMuted',
  };
}

/** `job_a1b2c3d4e5f6` → `a1b2c3d4` for tight rows. */
export function shortJobId(id: string): string {
  const bare = id.replace(/^job_/u, '');
  return bare.length <= 8 ? bare : bare.slice(0, 8);
}

/** Last path segment of a worktree path. */
export function worktreeLeaf(path: string): string {
  const segments = path.split('/').filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? path;
}

/** Inbox kind `job.completed` → `completed`. */
export function inboxKindLabel(kind: string): string {
  return kind.replace(/^job\./u, '');
}
