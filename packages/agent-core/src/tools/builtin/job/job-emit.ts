/**
 * Optional wire emit for job.* events when agent bus is available.
 * Store/inbox remain source of truth; emit is best-effort for TUI/live clients.
 */

import {
  JOB_EVENT_SCHEMA_VERSION,
  type JobEffectPreview,
  type JobInboxEvent as WireJobInboxEvent,
  type JobSnapshot,
  type JobUpdatedEvent,
} from '@superliora/protocol';

import type { Agent } from '../../../agent/index';
import type { JobInboxEvent, JobInboxEventKind } from './job-inbox';
import type { JobRecord } from './job-ledger';

function briefPreviewFromJob(job: JobRecord): JobSnapshot['briefPreview'] {
  if (!job.successCriteria && !job.mustNotTouch && !job.verificationCommands) return undefined;
  return {
    successCriteria: job.successCriteria,
    mustNotTouch: job.mustNotTouch,
    verificationCommands: job.verificationCommands,
  };
}


function landReceiptFromJob(job: JobRecord): JobSnapshot['landReceipt'] {
  const receipt = job.landReceipt;
  if (receipt === undefined) return undefined;
  return {
    mergeSha: receipt.mergeSha,
    branch: receipt.branch,
    merged: true,
  };
}

function effectPreviewFromJob(job: JobRecord): JobEffectPreview {
  const isolation = job.worktreePath === undefined ? 'none' : 'worktree';
  return {
    isolation,
    chip: isolation === 'worktree' ? 'worktree' : job.kind,
    summary: isolation === 'worktree' ? 'Isolated worktree' : 'No isolated worktree',
  };
}

/** Map ledger record → protocol JobSnapshot (schemaVersion 4 fields included). */
export function jobRecordToSnapshot(job: JobRecord): JobSnapshot {
  return {
    id: job.id,
    title: job.title,
    status: job.status,
    kind: job.kind,
    priority: job.priority,
    worktreePath: job.worktreePath,
    worktreeBranch: job.worktreeBranch,
    repoRoot: job.repoRoot,
    sessionName: job.sessionName,
    landChoice: job.landChoice,
    portOffset: job.portOffset,
    workerAgentId: job.workerAgentId,
    resultSummary: job.resultSummary,
    filesChanged: job.filesChanged,
    usage: job.usage,
    progress: job.progress,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    briefPreview: briefPreviewFromJob(job),
    landReceipt: landReceiptFromJob(job),
    effectPreview: effectPreviewFromJob(job),
    parentJobId: job.parentJobId,
  };
}

export function actionHintsForInboxKind(
  kind: JobInboxEventKind,
  job?: JobRecord,
): readonly string[] {
  switch (kind) {
    case 'job.needs_user':
      return ['jobResume', 'jobSteer'];
    case 'job.blocked':
      return ['jobInspect', 'jobResume', 'jobCancel'];
    case 'job.failed':
      return ['jobInspect', 'jobResume', 'jobCancel'];
    case 'job.interrupted':
      return ['jobResume', 'jobCancel'];
    case 'job.cancelled':
      return ['jobInspect'];
    case 'job.completed':
      if (job?.landReceipt !== undefined) return ['jobInspect'];
      if (job?.landChoice === 'pending' && job.worktreePath !== undefined) {
        return ['jobKeep', 'jobApply', 'jobPush', 'jobInspect'];
      }
      return ['jobMerge', 'jobPush', 'jobInspect'];
    case 'recovery.held':
      return ['jobInspect', 'jobResume', 'jobCancel'];
    case 'recovery.reattach_failed':
      return ['jobInspect', 'jobResume'];
  }
}

export function jobRecordToUpdatedEvent(
  job: JobRecord,
  change?: JobUpdatedEvent['change'],
): JobUpdatedEvent {
  return {
    type: 'job.updated',
    schemaVersion: JOB_EVENT_SCHEMA_VERSION,
    job: jobRecordToSnapshot(job),
    change,
  };
}

export function inboxToWireEvent(event: JobInboxEvent): WireJobInboxEvent {
  return {
    type: 'job.inbox',
    schemaVersion: JOB_EVENT_SCHEMA_VERSION,
    eventId: event.id,
    kind: event.kind,
    jobId: event.jobId,
    status: event.status,
    title: event.title,
    summary: event.summary,
    digest: event.digest,
    actionHints: actionHintsForInboxKind(event.kind),
  };
}

export function inboxToWireEventForJob(
  event: JobInboxEvent,
  job: JobRecord | undefined,
): WireJobInboxEvent {
  return {
    ...inboxToWireEvent(event),
    actionHints: actionHintsForInboxKind(event.kind, job),
  };
}

/**
 * Emit via agent event bus when present. Never throws into Job ledger paths.
 */
export function emitJobEvents(
  agent: Agent | undefined,
  events: readonly (JobUpdatedEvent | WireJobInboxEvent)[],
): void {
  if (agent === undefined || events.length === 0) return;
  const bus = agent as Agent & {
    emitAgentEvent?: (event: JobUpdatedEvent | WireJobInboxEvent) => void;
    events?: { emit?: (event: unknown) => void };
  };
  for (const event of events) {
    try {
      if (typeof bus.emitAgentEvent === 'function') {
        bus.emitAgentEvent(event);
      } else if (typeof bus.events?.emit === 'function') {
        bus.events.emit(event);
      }
    } catch {
      // ignore — wire emit is optional
    }
  }
}
