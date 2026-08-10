/**
 * Optional wire emit for job.* events when agent bus is available.
 * Store/inbox remain source of truth; emit is best-effort for TUI/live clients.
 */

import {
  JOB_EVENT_SCHEMA_VERSION,
  type JobGateChecklist,
  type JobGateChecklistStatus,
  type JobInboxEvent as WireJobInboxEvent,
  type JobSnapshot,
  type JobUpdatedEvent,
} from '@superliora/protocol';

import type { Agent } from '../../../agent/index';
import type { VerificationVerdict, VisualVerificationVerdict } from '../../../session/subagent/subagent-result-contract';
import type { JobInboxEvent, JobInboxEventKind } from './job-inbox';
import type { JobRecord } from './job-ledger';

function mapGateVerdict(
  verdict: VerificationVerdict | VisualVerificationVerdict | undefined,
): JobGateChecklistStatus {
  switch (verdict) {
    case 'passed':
      return 'pass';
    case 'failed':
      return 'fail';
    case 'not_applicable':
      return 'na';
    case 'not_run':
    case undefined:
      return 'pending';
  }
}

function briefPreviewFromJob(job: JobRecord): JobSnapshot['briefPreview'] {
  if (
    job.successCriteria === undefined &&
    job.mustNotTouch === undefined &&
    job.verificationCommands === undefined &&
    job.testSeams === undefined &&
    job.tddMode === undefined &&
    (job.reproCommand === undefined || job.reproCommand.trim().length === 0)
  ) {
    return undefined;
  }
  return {
    successCriteria: job.successCriteria,
    mustNotTouch: job.mustNotTouch,
    verificationCommands: job.verificationCommands,
    testSeams: job.testSeams,
    tddMode: job.tddMode,
    reproCommand: job.reproCommand,
  };
}

function reviewGateFromJob(job: JobRecord): JobGateChecklistStatus {
  const notes = job.notes ?? '';
  if (/\breview_chain:\s*\S+\s+verdict=passed\b/i.test(notes)) return 'pass';
  if (/\breview_chain:\s*\S+\s+verdict=failed\b/i.test(notes)) return 'fail';
  if (/\breview_chain:\s*enqueued\b/i.test(notes)) return 'pending';
  if (job.expertRole === 'review' || job.expertRole === 'visual-qa' || job.expertRole === 'debug') {
    return 'na';
  }
  if (job.kind === 'task' || job.kind === 'implement') return 'pending';
  return 'na';
}

function gateChecklistFromJob(job: JobRecord): JobGateChecklist | undefined {
  const v = job.resultContract?.verification;
  const review = reviewGateFromJob(job);
  if (v === undefined && review === 'na') return undefined;
  return {
    visual: mapGateVerdict(v?.visual),
    review,
    tests: mapGateVerdict(v?.tests),
    typecheck: mapGateVerdict(v?.typecheck),
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

/** Map ledger record → protocol JobSnapshot (schemaVersion 3 fields included). */
export function jobRecordToSnapshot(job: JobRecord): JobSnapshot {
  return {
    id: job.id,
    title: job.title,
    status: job.status,
    kind: job.kind,
    priority: job.priority,
    worktreePath: job.worktreePath,
    workerAgentId: job.workerAgentId,
    resultSummary: job.resultSummary,
    progress: job.progress,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    deliveryPhase: job.deliveryPhase,
    briefPreview: briefPreviewFromJob(job),
    gateChecklist: gateChecklistFromJob(job),
    landReceipt: landReceiptFromJob(job),
  };
}

export function actionHintsForInboxKind(kind: JobInboxEventKind): readonly string[] {
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
      return ['jobMerge', 'jobPush', 'jobInspect'];
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
