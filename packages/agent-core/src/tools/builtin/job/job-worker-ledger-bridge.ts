/** Mirror worker activity and explicit input requests onto the Job ledger. */

import type { JobProgressSnapshot } from '@superliora/protocol';

import type { Agent } from '../../../agent/index';
import { readSubagentCheckpoint } from '../../../session/subagent/subagent-checkpoint';
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
  if (job.workerAgentId !== undefined && job.workerAgentId !== workerAgentId) return;
  // Skip ledger write + job.updated when only the heartbeat timestamp moved —
  // subagent.progress already drives the live dock strip.
  if (isHeartbeatOnlyProgress(job.progress, progress)) return;

  // Progress-only patch: structural-share other jobs (writeJobLedger uses slice).
  const next = patchJob(binding.store, job.id, { progress });
  if (next !== undefined) {
    emitJobEvents(binding.agent, [jobRecordToUpdatedEvent(next, { reason: 'progress' })]);
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
 * Build a one-page resume handoff so continue_from / cold reattach does not
 * restart a repo-wide scan. Pure — no I/O except optional checkpoint read.
 */
export function buildWorkerResumeHandoff(input: {
  readonly job: JobRecord;
  readonly workerAgentId?: string;
  readonly reason: 'deadline';
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
    '## Resume handoff',
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
  return lines.join('\n').slice(0, 3500);
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
  byWorkerAgentId.clear();
}
