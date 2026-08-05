/**
 * Bridge so job workers (subagents) can mark their parent Job `needs_user`
 * when AskUserQuestion runs — Plan Desk interview cards land on JobInbox
 * while the question UI still uses the shared session RPC.
 */

import type { JobProgressSnapshot } from '@superliora/protocol';

import type { Agent } from '../../../agent/index';
import { requestConductorWake } from '../../../session/job/conductor-wake';
import type { ToolStore } from '../../store';
import { emitJobEvents, jobRecordToUpdatedEvent } from './job-emit';
import { pushJobInboxEvent } from './job-inbox';
import { getJob, listJobs, patchJob, type JobRecord } from './job-ledger';

interface WorkerLedgerBinding {
  readonly store: ToolStore;
  readonly jobId: string;
  readonly agent?: Agent;
}

const byWorkerAgentId = new Map<string, WorkerLedgerBinding>();

export function bindJobWorkerLedger(
  workerAgentId: string,
  store: ToolStore,
  jobId: string,
  agent?: Agent,
): void {
  byWorkerAgentId.set(workerAgentId, { store, jobId, agent });
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
  // Shared-RPC interviews (status stays `running`) reach the user through the
  // question UI directly — waking the conductor there would double-ask. Only
  // the paused path relies on the conductor relay, so only it wakes.
  if (pause && binding.agent !== undefined) {
    requestConductorWake({ agent: binding.agent, store: binding.store });
  }
  return next;
}

/**
 * Mirror a live worker heartbeat onto the job ledger (`progress` field) and
 * re-emit `job.updated`. Called from the subagent progress reporter tick, so
 * the cadence is the reporter's; never wakes the conductor (protocol contract:
 * progress streams to live clients only). No-op for unbound subagents and for
 * jobs that already left `running`.
 */
export function reportJobWorkerProgress(
  workerAgentId: string,
  progress: JobProgressSnapshot,
): void {
  const binding = byWorkerAgentId.get(workerAgentId);
  if (binding === undefined) return;
  const job = getJob(binding.store, binding.jobId);
  if (job === undefined || job.status !== 'running') return;
  const next = patchJob(binding.store, job.id, { progress });
  if (next !== undefined) {
    emitJobEvents(binding.agent, [jobRecordToUpdatedEvent(next, { reason: 'progress' })]);
  }
}

/**
 * One-shot stall signal from the progress reporter: mark the phase and leave
 * a ledger note so the conductor can tell a wedged worker from a slow one.
 */
export function reportJobWorkerStalled(workerAgentId: string, silentMs: number): void {
  const binding = byWorkerAgentId.get(workerAgentId);
  if (binding === undefined) return;
  const job = getJob(binding.store, binding.jobId);
  if (job === undefined || job.status !== 'running') return;
  const minutes = Math.max(1, Math.round(silentMs / 60_000));
  const next = patchJob(binding.store, job.id, {
    progress: {
      ...job.progress,
      phase: `stalled — no tool activity for ${minutes}m`,
    },
    notes: [job.notes, `stall: no tool activity for ${minutes}m`].filter(Boolean).join('\n'),
  });
  if (next !== undefined) {
    emitJobEvents(binding.agent, [jobRecordToUpdatedEvent(next, { reason: 'stalled' })]);
  }
}

export function __resetJobWorkerLedgerBridgeForTests(): void {
  byWorkerAgentId.clear();
}
