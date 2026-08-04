/**
 * Bridge so job workers (subagents) can mark their parent Job `needs_user`
 * when AskUserQuestion runs — Plan Desk interview cards land on JobInbox
 * while the question UI still uses the shared session RPC.
 */

import type { ToolStore } from '../../store';
import { pushJobInboxEvent } from './job-inbox';
import { listJobs, patchJob, type JobRecord } from './job-ledger';

interface WorkerLedgerBinding {
  readonly store: ToolStore;
  readonly jobId: string;
}

const byWorkerAgentId = new Map<string, WorkerLedgerBinding>();

export function bindJobWorkerLedger(
  workerAgentId: string,
  store: ToolStore,
  jobId: string,
): void {
  byWorkerAgentId.set(workerAgentId, { store, jobId });
}

export function unbindJobWorkerLedger(workerAgentId: string): void {
  byWorkerAgentId.delete(workerAgentId);
}

export function findJobWorkerLedger(workerAgentId: string): WorkerLedgerBinding | undefined {
  return byWorkerAgentId.get(workerAgentId);
}

/**
 * Push a needs_user inbox card for a live job worker.
 * Keeps status `running` when the worker is blocked on shared RPC AskUserQuestion
 * (answer returns to the worker turn); still marks needs_user when the job was
 * already paused so JobResume remains the delivery path.
 */
export function raiseJobNeedsUserForWorker(
  workerAgentId: string,
  input: { readonly question: string; readonly context?: string },
): JobRecord | undefined {
  const binding = byWorkerAgentId.get(workerAgentId);
  if (binding === undefined) return undefined;
  const job = listJobs(binding.store).find((j) => j.id === binding.jobId);
  if (job === undefined) return undefined;
  const pause = job.status !== 'running';
  const next = patchJob(binding.store, job.id, {
    ...(pause ? { status: 'needs_user' as const } : {}),
    resultSummary: `needs_user: ${input.question}`,
    notes: [
      job.notes,
      `interview: ${input.question}`,
      input.context ? `interview-context: ${input.context}` : undefined,
    ]
      .filter(Boolean)
      .join('\n'),
  });
  if (next === undefined) return undefined;
  pushJobInboxEvent(binding.store, {
    kind: 'job.needs_user',
    jobId: next.id,
    status: pause ? 'needs_user' : next.status,
    title: next.title,
    summary: `Job ${next.id} needs input: ${input.question}`,
  });
  return next;
}

export function __resetJobWorkerLedgerBridgeForTests(): void {
  byWorkerAgentId.clear();
}
