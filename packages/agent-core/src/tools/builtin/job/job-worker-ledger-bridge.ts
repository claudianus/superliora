/**
 * Bridge so job workers (subagents) can mark their parent Job `needs_user`
 * when AskUserQuestion runs — Plan Desk interview cards land on JobInbox
 * while the question UI still uses the shared session RPC.
 */

import type { JobProgressSnapshot } from '@superliora/protocol';

import type { Agent } from '../../../agent/index';
import { requestConductorWake } from '../../../session/job/conductor-wake';
import { JOB_WORKER_PROGRESS_STALL_MS } from '../../../session/job/worker-spawner';
import { pauseActiveChildDeadline } from '../../../session/subagent/subagent-run-lifecycle';
import type { ToolStore } from '../../store';
import { emitJobEvents, jobRecordToUpdatedEvent } from './job-emit';
import { pushJobInboxEvent } from './job-inbox';
import { getJob, listJobs, patchJob, type JobRecord } from './job-ledger';
import { patchJobAndNotify } from './job-notify';

interface WorkerLedgerBinding {
  readonly store: ToolStore;
  readonly jobId: string;
  readonly agent?: Agent;
}

const byWorkerAgentId = new Map<string, WorkerLedgerBinding>();

/** Post-spawn progress-stall timers keyed by worker agent id. */
const progressStallTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function bindJobWorkerLedger(
  workerAgentId: string,
  store: ToolStore,
  jobId: string,
  agent?: Agent,
): void {
  byWorkerAgentId.set(workerAgentId, { store, jobId, agent });
}

export function unbindJobWorkerLedger(workerAgentId: string): void {
  clearJobWorkerProgressStall(workerAgentId);
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
  // Interview wait is meaningful progress: cancel the post-spawn stall and
  // freeze the wall-clock deadline so 30m/45m does not burn while waiting.
  clearJobWorkerProgressStall(workerAgentId);
  pauseActiveChildDeadline(workerAgentId);
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
 * Arm a one-shot post-spawn progress stall. Independent of the 30s handshake
 * budget: after the worker attaches, no first tool / needs_user within
 * {@link JOB_WORKER_PROGRESS_STALL_MS} → job blocked + inbox.
 * Returns a disposer that cancels the timer (call on completion or first progress).
 */
export function armJobWorkerProgressStall(
  workerAgentId: string,
  options: { readonly stallMs?: number } = {},
): () => void {
  clearJobWorkerProgressStall(workerAgentId);
  const stallMs = options.stallMs ?? JOB_WORKER_PROGRESS_STALL_MS;
  if (stallMs <= 0) return () => {};
  const timer = setTimeout(() => {
    progressStallTimers.delete(workerAgentId);
    const binding = byWorkerAgentId.get(workerAgentId);
    if (binding === undefined) return;
    const job = getJob(binding.store, binding.jobId);
    if (job === undefined || job.status !== 'running') return;
    patchJobAndNotify(
      binding.store,
      job.id,
      {
        status: 'blocked',
        notes: [
          job.notes,
          `spawn.progress_stall: no tool/needs_user progress within ${stallMs}ms after spawn`,
        ]
          .filter(Boolean)
          .join('\n'),
      },
      {
        agent: binding.agent,
        summary: `spawn progress stall (${stallMs}ms without progress)`,
      },
    );
    pushJobInboxEvent(binding.store, {
      kind: 'job.blocked',
      jobId: job.id,
      status: 'blocked',
      title: job.title,
      summary: `spawn.progress_stall: no meaningful progress within ${stallMs}ms after spawn — held for resume/cancel`,
    });
  }, stallMs);
  (timer as { unref?: () => void }).unref?.();
  progressStallTimers.set(workerAgentId, timer);
  return () => clearJobWorkerProgressStall(workerAgentId);
}

export function clearJobWorkerProgressStall(workerAgentId: string): void {
  const timer = progressStallTimers.get(workerAgentId);
  if (timer === undefined) return;
  clearTimeout(timer);
  progressStallTimers.delete(workerAgentId);
}

/** True when progress shows a real first step (not the idle "starting" phase). */
function isMeaningfulWorkerProgress(progress: JobProgressSnapshot): boolean {
  const phase = (progress.phase ?? '').trim();
  if (phase.length > 0 && phase !== 'starting' && !phase.startsWith('stalled')) {
    return true;
  }
  if ((progress.recentTools?.length ?? 0) > 0) return true;
  if ((progress.stepsCompleted ?? 0) > 0) return true;
  if ((progress.tokensOut ?? 0) > 0) return true;
  return false;
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
  // First real tool / tokens clears the post-spawn 120s stall watchdog.
  if (isMeaningfulWorkerProgress(progress)) {
    clearJobWorkerProgressStall(workerAgentId);
  }
  // Skip ledger write + job.updated when only the heartbeat timestamp moved —
  // subagent.progress already drives the live dock strip.
  if (isHeartbeatOnlyProgress(job.progress, progress)) return;
  // Progress-only patch: structural-share other jobs (writeJobLedger uses slice).
  const next = patchJob(binding.store, job.id, { progress });
  if (next !== undefined) {
    emitJobEvents(binding.agent, [jobRecordToUpdatedEvent(next, { reason: 'progress' })]);
    // Goal Desk: mirror driver heartbeats onto the session Goal snapshot so the
    // Conductor Goal Monitor / XP pulse move without a main-lane turn.
    if (next.kind === 'goal-driver' && binding.agent !== undefined) {
      // Dynamic import: facade → job-worker → this bridge (avoid init cycle).
      void import('../goal/goal-desk-facade').then(({ emitGoalDeskSnapshot }) => {
        emitGoalDeskSnapshot(binding.agent!, binding.store);
      });
    }
  }
}

/** True when progress only advances heartbeat / unchanged telemetry. */
function isHeartbeatOnlyProgress(
  previous: JobProgressSnapshot | undefined,
  next: JobProgressSnapshot,
): boolean {
  if (previous === undefined) return false;
  if ((previous.phase ?? '') !== (next.phase ?? '')) return false;
  if ((previous.stepsCompleted ?? -1) !== (next.stepsCompleted ?? -1)) return false;
  if ((previous.stepsTotal ?? -1) !== (next.stepsTotal ?? -1)) return false;
  const prevTools = previous.recentTools?.join('\0') ?? '';
  const nextTools = next.recentTools?.join('\0') ?? '';
  if (prevTools !== nextTools) return false;
  if ((previous.tokensIn ?? -1) !== (next.tokensIn ?? -1)) return false;
  if ((previous.tokensOut ?? -1) !== (next.tokensOut ?? -1)) return false;
  if ((previous.cacheRead ?? -1) !== (next.cacheRead ?? -1)) return false;
  return true;
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
