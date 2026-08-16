/**
 * Bridge so job workers (subagents) can mark their parent Job `needs_user`
 * when AskUserQuestion runs — Plan Desk interview cards land on JobInbox
 * while the question UI still uses the shared session RPC.
 *
 * Also owns pre-abort resume handoff: when finishing mode or a wall-clock
 * deadline hits, last progress + open files land on the Job result so
 * continue_from does not restart a repo-wide scan from zero.
 */

import type { JobProgressSnapshot } from '@superliora/protocol';

import type { Agent } from '../../../agent/index';
import { requestConductorWake } from '../../../session/job/conductor-wake';
import { JOB_WORKER_PROGRESS_STALL_MS } from '../../../session/job/worker-spawner';
import { readSubagentCheckpoint } from '../../../session/subagent/subagent-checkpoint';
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

/**
 * Build a one-page resume handoff so continue_from / cold reattach does not
 * restart a repo-wide scan. Pure — no I/O except optional checkpoint read.
 */
export function buildWorkerResumeHandoff(input: {
  readonly job: JobRecord;
  readonly workerAgentId?: string;
  readonly reason: 'pre_abort' | 'deadline' | 'finishing';
  readonly errorMessage?: string;
  /** Inject checkpoint for tests; default reads disk for workerAgentId. */
  readonly checkpoint?: {
    readonly lastTool?: string;
    readonly lastTarget?: string;
    readonly dirtyFiles?: readonly string[];
    readonly toolCount?: number;
    readonly elapsedMs?: number;
  };
}): string {
  const { job, reason, errorMessage } = input;
  const progress = job.progress;
  const checkpoint =
    input.checkpoint ??
    (input.workerAgentId !== undefined ? readSubagentCheckpoint(input.workerAgentId) : undefined);

  const lines: string[] = [
    '## Resume handoff (wall-clock / pre-abort)',
    `reason: ${reason}`,
    `job: ${job.id} (${job.kind}) — ${job.title}`,
  ];
  if (errorMessage !== undefined && errorMessage.trim().length > 0) {
    lines.push(`error: ${errorMessage.trim().slice(0, 400)}`);
  }
  if (progress?.phase) lines.push(`last_phase: ${progress.phase}`);
  if (progress?.recentTools && progress.recentTools.length > 0) {
    lines.push(`recent_tools: ${progress.recentTools.slice(0, 8).join(', ')}`);
  }
  if (progress?.lastHeartbeatAt) lines.push(`last_heartbeat: ${progress.lastHeartbeatAt}`);
  if (progress?.stepsCompleted !== undefined) {
    lines.push(
      `steps: ${String(progress.stepsCompleted)}${
        progress.stepsTotal !== undefined ? `/${String(progress.stepsTotal)}` : ''
      }`,
    );
  }
  const lastCommand =
    checkpoint?.lastTool !== undefined
      ? checkpoint.lastTarget !== undefined
        ? `${checkpoint.lastTool}: ${checkpoint.lastTarget}`
        : checkpoint.lastTool
      : progress?.phase;
  if (lastCommand !== undefined && lastCommand.trim().length > 0) {
    lines.push(`last_command: ${lastCommand.trim().slice(0, 200)}`);
  }
  if (checkpoint?.toolCount !== undefined) {
    lines.push(`tools_completed: ${String(checkpoint.toolCount)}`);
  }
  if (checkpoint?.elapsedMs !== undefined) {
    lines.push(`elapsed_before_stop: ${String(Math.round(checkpoint.elapsedMs / 1000))}s`);
  }
  const dirty = checkpoint?.dirtyFiles ?? [];
  if (dirty.length > 0) {
    lines.push(`open_files:\n- ${dirty.slice(0, 20).join('\n- ')}`);
  } else {
    lines.push('open_files: (none recorded)');
  }
  if (job.workerResumeAgentId !== undefined) {
    lines.push(
      `resume_agent: ${job.workerResumeAgentId}${
        job.workerCheckpointAt ? ` @ ${job.workerCheckpointAt}` : ''
      }`,
    );
  }
  if (job.worktreePath) lines.push(`worktree: ${job.worktreePath}`);
  lines.push(
    'continue_from: Do not restart a repo-wide scan. Verify open_files + last_command, then finish the brief from there.',
  );
  return lines.join('\n').slice(0, 3500);
}

/**
 * Persist a resume handoff onto a still-running job (finishing / pre-abort)
 * without flipping status. Idempotent note stamp.
 */
export function persistJobWorkerPreAbortHandoff(
  workerAgentId: string,
  options: { readonly reason?: 'pre_abort' | 'finishing' } = {},
): JobRecord | undefined {
  const binding = byWorkerAgentId.get(workerAgentId);
  if (binding === undefined) return undefined;
  const job = getJob(binding.store, binding.jobId);
  if (job === undefined || job.status !== 'running') return undefined;
  const reason = options.reason ?? 'pre_abort';
  const handoff = buildWorkerResumeHandoff({
    job,
    workerAgentId,
    reason,
  });
  // Avoid rewriting every 5s once finishing is active.
  if (job.resultSummary?.includes('## Resume handoff') === true) {
    return job;
  }
  const next = patchJob(binding.store, job.id, {
    resultSummary: handoff,
    notes: [job.notes, `resume_handoff: ${reason} checkpoint written`].filter(Boolean).join('\n'),
  });
  if (next !== undefined) {
    emitJobEvents(binding.agent, [jobRecordToUpdatedEvent(next, { reason: 'progress' })]);
  }
  return next;
}

/**
 * Terminal deadline path: always write a resume handoff into the failed result
 * so continue_from has something to read (empty 30m failure is the bug).
 */
export function buildDeadlineFailureSummary(
  job: JobRecord,
  errorMessage: string,
  workerAgentId?: string,
): string {
  return buildWorkerResumeHandoff({
    job,
    workerAgentId,
    reason: 'deadline',
    errorMessage,
  });
}

export function __resetJobWorkerLedgerBridgeForTests(): void {
  for (const timer of progressStallTimers.values()) clearTimeout(timer);
  progressStallTimers.clear();
  byWorkerAgentId.clear();
}
