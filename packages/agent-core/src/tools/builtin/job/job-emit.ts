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
    job.verificationCommands === undefined
  ) {
    return undefined;
  }
  return {
    successCriteria: job.successCriteria,
    mustNotTouch: job.mustNotTouch,
    verificationCommands: job.verificationCommands,
  };
}

function gateChecklistFromJob(job: JobRecord): JobGateChecklist | undefined {
  const v = job.resultContract?.verification;
  if (v === undefined) return undefined;
  return {
    visual: mapGateVerdict(v.visual),
    // Review chain is not on the worker verification contract; expose as n/a until wired.
    review: 'na',
    tests: mapGateVerdict(v.tests),
    typecheck: mapGateVerdict(v.typecheck),
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
