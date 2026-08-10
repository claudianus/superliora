/**
 * Conductor Timeline — project jobs+inbox into vertical stages for the pane.
 */

import type {
  ConductorJobCard,
  ConductorJobInboxEntry,
  ConductorJobsSnapshot,
} from '#/tui/utils/job/job-strip';

export type ConductorTimelineStage = 'intake' | 'running' | 'needs_user' | 'land';

export interface ConductorTimelineEntry {
  readonly stage: ConductorTimelineStage;
  readonly jobId: string;
  readonly title: string;
  readonly status: ConductorJobCard['status'];
  readonly kind: ConductorJobCard['kind'];
  readonly detail?: string;
  readonly atMs: number;
}

const STAGE_ORDER: readonly ConductorTimelineStage[] = [
  'intake',
  'running',
  'needs_user',
  'land',
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
    default:
      return undefined;
  }
}

export function buildConductorTimeline(
  snap: ConductorJobsSnapshot,
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
    });
  }

  // Inbox notices that point at jobs not already staged (failed/cancelled stay out).
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
  return all;
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
