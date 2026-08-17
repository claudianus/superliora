/**
 * Optional wire emit for job.* events when agent bus is available.
 * Store/inbox remain source of truth; emit is best-effort for TUI/live clients.
 */

import {
  JOB_EVENT_SCHEMA_VERSION,
  type JobEffectPreview,
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
import { jobIsolationKind } from './job-task-track';
import { isDebugFixerJob } from './job-store-key';

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
  if (/\bverify_chain:\s*aggregate verdict=passed\b/i.test(notes)) return 'pass';
  if (/\bverify_chain:\s*aggregate verdict=failed\b/i.test(notes)) return 'fail';
  if (/\bverify_chain:\s*\S+\s+verdict=passed\b/i.test(notes)) return 'pass';
  if (/\bverify_chain:\s*\S+\s+verdict=failed\b/i.test(notes)) return 'fail';
  if (/\bverify_chain:\s*enqueued\b/i.test(notes)) return 'pending';
  if (job.kind === 'verify') return 'na';
  if (isDebugFixerJob(job)) return 'na';
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

const TRACK_SOURCE_LABEL: Record<
  NonNullable<JobRecord['taskTrackSource']>,
  string
> = {
  declared: 'you set',
  inherited: 'from the parent job',
  structural: 'from the contract',
  inferred: 'Conductor judged',
  pending: 'Conductor is judging',
  default: 'coding default',
};

export function effectPreviewFromJob(job: JobRecord): JobEffectPreview {
  const isolation = jobIsolationKind(job);
  const pending = job.taskTrackSource === 'pending';
  const track = pending ? undefined : job.taskTrack;
  const surface =
    job.surfaceKind === 'web' || job.surfaceKind === 'tui' || job.surfaceKind === 'mixed'
      ? job.surfaceKind
      : undefined;
  const chipParts: string[] = [];
  if (pending) {
    chipParts.push('judging');
  } else if (isolation === 'checkout') {
    chipParts.push('checkout');
  } else if (isolation === 'worktree') {
    chipParts.push('worktree');
  }
  if (surface !== undefined) chipParts.push(surface);
  if (job.premiumDensity === 'visual') chipParts.push('visual');
  if (job.debugFixer === true) chipParts.push('debug');
  if (job.explorePrototype === true) chipParts.push('prototype');
  const chip = chipParts.length > 0 ? chipParts.join(' · ') : job.kind;

  const summaryParts: string[] = [];
  if (pending) {
    summaryParts.push('track pending');
  } else if (track === 'general') {
    summaryParts.push('general');
  } else if (track === 'coding' || isolation === 'worktree') {
    summaryParts.push('coding');
  }
  if (isolation === 'checkout') summaryParts.push('this checkout');
  if (isolation === 'worktree') summaryParts.push('isolated worktree');
  if (isolation === 'none') summaryParts.push('no isolated worktree');
  if (surface !== undefined) summaryParts.push(`${surface} surface`);
  if (job.premiumDensity === 'visual') summaryParts.push('visual quality');
  if (job.premiumDensity === 'code') summaryParts.push('code quality');
  if (job.debugFixer === true) summaryParts.push('debug fixer');
  if (job.explorePrototype === true) summaryParts.push('prototype');
  if (job.taskTrackSource !== undefined) {
    summaryParts.push(TRACK_SOURCE_LABEL[job.taskTrackSource]);
  }
  return {
    isolation,
    chip,
    summary: summaryParts.join(' · '),
    ...(track === undefined ? {} : { taskTrack: track }),
    ...(job.taskTrackSource === undefined ? {} : { taskTrackSource: job.taskTrackSource }),
    ...(job.surfaceKind === undefined ? {} : { surfaceKind: job.surfaceKind }),
    ...(job.premiumDensity === undefined ? {} : { premiumDensity: job.premiumDensity }),
    ...(job.debugFixer === true ? { debugFixer: true } : {}),
    ...(job.explorePrototype === true ? { explorePrototype: true } : {}),
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
    repoRoot: job.repoRoot,
    workerAgentId: job.workerAgentId,
    resultSummary: job.resultSummary,
    progress: job.progress,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    deliveryPhase: job.deliveryPhase,
    briefPreview: briefPreviewFromJob(job),
    gateChecklist: gateChecklistFromJob(job),
    landReceipt: landReceiptFromJob(job),
    effectPreview: effectPreviewFromJob(job),
    parentJobId: job.parentJobId,
    verifyVerdict: job.verifyVerdict,
    debugFixer: job.debugFixer,
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
    case 'recovery.auto_resumed':
      return ['jobInspect'];
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
