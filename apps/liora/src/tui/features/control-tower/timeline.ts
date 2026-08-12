/**
 * Conductor Timeline — project jobs+inbox into vertical stages for the pane.
 */

import type {
  ConductorJobCard,
  ConductorJobInboxEntry,
  ConductorJobsSnapshot,
} from '#/tui/utils/job/job-strip';

export type ConductorTimelineStage =
  | 'intake'
  | 'running'
  | 'needs_user'
  | 'land'
  | 'failed';

export interface ConductorTimelineEntry {
  readonly stage: ConductorTimelineStage;
  readonly jobId: string;
  readonly title: string;
  readonly status: ConductorJobCard['status'];
  readonly kind: ConductorJobCard['kind'];
  readonly detail?: string;
  readonly atMs: number;
  /** When status last changed — stage-row settle flash. */
  readonly statusChangedAtMs?: number;
}

/** Max timeline rows before windowing (plus stage headers outside this count). */
export const TIMELINE_ENTRY_WINDOW = 24;

const STAGE_ORDER: readonly ConductorTimelineStage[] = [
  'intake',
  'running',
  'needs_user',
  'land',
  'failed',
];

export function stageForJob(card: ConductorJobCard): ConductorTimelineStage | undefined {
  switch (card.status) {
    case 'queued':
      return 'intake';
    case 'running':
    case 'interrupted':
      return 'running';
    case 'needs_user':
    case 'blocked':
      return 'needs_user';
    case 'done':
      return 'land';
    case 'failed':
    case 'cancelled':
      return 'failed';
    default:
      return undefined;
  }
}

export function buildConductorTimeline(
  snap: ConductorJobsSnapshot,
  options?: {
    /** Window start into the sorted entry list (for ↑↓ scrolling). */
    readonly scrollOffset?: number;
    /** Max entries in the window (default {@link TIMELINE_ENTRY_WINDOW}). */
    readonly windowSize?: number;
  },
): readonly ConductorTimelineEntry[] {
  const fromJobs: ConductorTimelineEntry[] = [];
  for (const job of snap.jobs) {
    const stage = stageForJob(job);
    if (stage === undefined) continue;
    fromJobs.push({
      stage,
      jobId: job.id,
      title: job.title,
      status: job.status,
      kind: job.kind,
      detail: job.progress?.phase ?? job.resultSummary?.slice(0, 80),
      atMs: job.updatedAtMs,
      ...(job.statusChangedAtMs === undefined
        ? {}
        : { statusChangedAtMs: job.statusChangedAtMs }),
    });
  }

  // Inbox notices that point at jobs not already staged.
  const seen = new Set(fromJobs.map((e) => e.jobId));
  const fromInbox: ConductorTimelineEntry[] = [];
  for (const entry of snap.inbox) {
    if (seen.has(entry.jobId)) continue;
    const stage = stageForInbox(entry);
    if (stage === undefined) continue;
    fromInbox.push({
      stage,
      jobId: entry.jobId,
      title: entry.title,
      status: inboxStatus(entry),
      kind: 'task',
      detail: entry.summary,
      atMs: entry.atMs,
    });
  }

  const all = [...fromJobs, ...fromInbox];
  all.sort((a, b) => {
    const stageDiff = STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage);
    if (stageDiff !== 0) return stageDiff;
    return b.atMs - a.atMs;
  });
  const windowSize = options?.windowSize ?? TIMELINE_ENTRY_WINDOW;
  if (all.length <= windowSize) return all;
  const maxOffset = Math.max(0, all.length - windowSize);
  const offset = Math.min(maxOffset, Math.max(0, options?.scrollOffset ?? 0));
  return all.slice(offset, offset + windowSize);
}

/** Full timeline length (for scroll bounds) — no windowing allocation. */
export function countConductorTimelineEntries(snap: ConductorJobsSnapshot): number {
  let count = 0;
  const seen = new Set<string>();
  for (const job of snap.jobs) {
    if (stageForJob(job) === undefined) continue;
    count += 1;
    seen.add(job.id);
  }
  for (const entry of snap.inbox) {
    if (seen.has(entry.jobId)) continue;
    if (stageForInbox(entry) === undefined) continue;
    count += 1;
  }
  return count;
}

export function timelineStageLabel(stage: ConductorTimelineStage): string {
  switch (stage) {
    case 'intake':
      return 'Intake';
    case 'running':
      return 'Running';
    case 'needs_user':
      return 'Needs you';
    case 'land':
      return 'Land';
    case 'failed':
      return 'Failed';
  }
}

function stageForInbox(entry: ConductorJobInboxEntry): ConductorTimelineStage | undefined {
  switch (entry.kind) {
    case 'job.needs_user':
    case 'job.blocked':
      return 'needs_user';
    case 'job.completed':
      return 'land';
    case 'job.interrupted':
      return 'running';
    case 'job.failed':
    case 'job.cancelled':
      return 'failed';
    default:
      return undefined;
  }
}

function inboxStatus(entry: ConductorJobInboxEntry): ConductorJobCard['status'] {
  switch (entry.kind) {
    case 'job.needs_user':
      return 'needs_user';
    case 'job.blocked':
      return 'blocked';
    case 'job.completed':
      return 'done';
    case 'job.interrupted':
    case 'recovery.held':
    case 'recovery.reattach_failed':
      return 'interrupted';
    case 'job.failed':
      return 'failed';
    case 'job.cancelled':
      return 'cancelled';
    case 'recovery.auto_resumed':
      return 'queued';
  }
}
