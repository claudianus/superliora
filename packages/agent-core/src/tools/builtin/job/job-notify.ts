/**
 * Single choke point: exceptional Job status → inbox + wire emit + Conductor wake.
 *
 * `requestConductorWake` no-ops on an empty inbox, so every terminal/exception
 * path that should re-enter the Conductor must go through here (or call
 * `notifyJobTerminal` after its own patch). Raw `patchJob` stays for
 * non-exceptional ledger churn (queued/running/progress).
 */

import type { Agent } from '../../../agent/index';
import { requestConductorWake } from '../../../session/job/conductor-wake';
import type { ToolStore } from '../../store';
import { emitJobEvents, inboxToWireEvent, jobRecordToUpdatedEvent } from './job-emit';
import { inboxKindForStatus, pushJobInboxEvent } from './job-inbox';
import { getJob, patchJob, type JobRecord, type JobStatus } from './job-ledger';

/** Statuses that must surface on the meta inbox and wake the Conductor. */
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

/**
 * Push inbox + emit + wake for an already-patched exceptional status.
 * No-op when `status` is not exceptional.
 */
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
    inboxToWireEvent(event),
    jobRecordToUpdatedEvent(input.job, { reason: kind }),
  ]);
  if (input.agent !== undefined) {
    requestConductorWake({ agent: input.agent, store: input.store });
  }
}

export type JobNotifyPatch = Parameters<typeof patchJob>[2];

/**
 * Patch the ledger; when `patch.status` is exceptional and the status
 * actually changed, notify inbox + wake. Same-status re-patches stay quiet.
 */
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
