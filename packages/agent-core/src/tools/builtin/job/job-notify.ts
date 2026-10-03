/** Persist operator inbox notices and stream Job state transitions to clients. */

import type { Agent } from '../../../agent/index';
import type { ToolStore } from '../../store';
import { emitJobEvents, inboxToWireEventForJob, jobRecordToUpdatedEvent } from './job-emit';
import { inboxKindForStatus, pushJobInboxEvent } from './job-inbox';
import { getJob, patchJob, type JobRecord, type JobStatus } from './job-ledger';

/** Terminal and parked statuses visible on the operator inbox. */
export function isJobExceptionalStatus(status: JobStatus): boolean {
  return (
    status === 'done' ||
    status === 'failed' ||
    status === 'blocked' ||
    status === 'needs_user' ||
    status === 'cancelled' ||
    status === 'interrupted'
  );
}

export interface NotifyJobTerminalInput {
  readonly store: ToolStore;
  readonly job: JobRecord;
  readonly status: JobStatus;
  readonly summary?: string;
  readonly agent?: Agent;
}

/** Push inbox and streaming events for an already-patched exceptional status. */
export function notifyJobTerminal(input: NotifyJobTerminalInput): void {
  const kind = inboxKindForStatus(input.status);
  if (kind === undefined) return;
  const event = pushJobInboxEvent(input.store, {
    kind,
    jobId: input.job.id,
    status: input.status,
    title: input.job.title,
    summary: input.summary,
  });
  emitJobEvents(input.agent, [
    inboxToWireEventForJob(event, input.job),
    jobRecordToUpdatedEvent(input.job, { reason: kind }),
  ]);
}

export type JobNotifyPatch = Partial<Omit<JobRecord, 'id' | 'createdAt' | 'updatedAt'>>;

/** Notify only when an exceptional status changes; progress patches stay quiet. */
export function patchJobAndNotify(
  store: ToolStore,
  id: string,
  patch: JobNotifyPatch,
  options?: {
    readonly agent?: Agent;
    readonly summary?: string;
  },
): JobRecord | undefined {
  const existing = getJob(store, id);
  if (existing === undefined) return undefined;
  const next = patchJob(store, id, patch);
  if (next === undefined) return undefined;
  if (
    patch.status !== undefined &&
    isJobExceptionalStatus(patch.status) &&
    existing.status !== patch.status
  ) {
    notifyJobTerminal({
      store,
      job: next,
      status: patch.status,
      summary: options?.summary ?? next.resultSummary,
      agent: options?.agent,
    });
  }
  return next;
}
