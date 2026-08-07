/**
 * Conductor Job → subagent worker launch (P1.5).
 * Spawns a background subagent in the job worktree and patches the ledger on completion.
 */

import { randomUUID } from 'node:crypto';

import type { Agent } from '../../../agent/index';
import { type FanoutSpec, type FanoutTask, spawnOneAgent } from '../../../fleet/spawn-agents';
import {
  classifyObjectiveProfile,
  jobLooksLikeUiSurface,
  uiSpawnQualityFlags,
} from '../../../premium-quality';
import { requestConductorWake } from '../../../session/job/conductor-wake';
import { getJobWorkerSpawner, requestJobSchedulePump } from '../../../session/job/job-offload';
import { DEFAULT_SUBAGENT_TIMEOUT_MS } from '../../../session/subagent/subagent-host';
import {
  UNVERIFIED_SUMMARY_PREFIX,
  verificationIsUnverified,
} from '../../../session/subagent/subagent-result-contract';
import { userCancellationReason } from '../../../utils/abort';
import type { ToolStore } from '../../store';
import {
  clearJobWorkerHandle,
  getJobWorkerHandle,
  registerJobWorkerHandle,
  setJobWorkerAgentId,
  abortJobWorker as abortRegisteredJobWorker,
} from './job-handles';
import {
  bindJobWorkerLedger,
  unbindJobWorkerLedger,
} from './job-worker-ledger-bridge';
import { emitJobEvents, inboxToWireEvent, jobRecordToUpdatedEvent } from './job-emit';
import { inboxKindForStatus, pushJobInboxEvent } from './job-inbox';
import { getJob, listJobs, patchJob, type JobRecord, type JobStatus } from './job-ledger';
import { profileForJobKind } from './job-runtime';
import { commitJobWorktreeIfDirty } from './job-worktree-commit';

export interface LaunchJobWorkerInput {
  readonly store: ToolStore;
  readonly agent: Agent;
  readonly job: JobRecord;
  readonly signal?: AbortSignal;
  /** Inject spawn for unit tests. */
  readonly spawnOne?: typeof spawnOneAgent;
}

export interface LaunchJobWorkerResult {
  readonly ok: boolean;
  readonly workerAgentId?: string;
  readonly error?: string;
}

/** Cap for the parent job's result summary carried into a child worker prompt. */
export const JOB_PRIOR_FINDINGS_MAX_CHARS = 2000;

export function jobPrompt(job: JobRecord, store?: ToolStore): string {
  const parentFindings = priorFindingsForJob(job, store);
  const uiJob = jobLooksLikeUiSurface(job);
  const parts = [
    `You are a Conductor worker for job ${job.id}.`,
    `Title: ${job.title}`,
    job.goalObjective
      ? [
          'This job owns an autonomous goal. The runtime created it on your agent —',
          'do not create or replace it; pursue it across turns until done.',
          `Objective: ${job.goalObjective}`,
          job.goalCompletionCriterion
            ? `Completion criterion: ${job.goalCompletionCriterion}`
            : undefined,
          'Report the outcome through UpdateGoal: complete when the criterion is met',
          '(with verification evidence), blocked when an external blocker stops you.',
        ]
          .filter(Boolean)
          .join('\n')
      : undefined,
    job.kind === 'mission'
      ? job.planStructured === false
        ? [
            'Plan Desk (regular): plan mode is active — write a concrete plan file, then ExitPlanMode.',
            'Do not call EnterPlanMode or NextPhase. Do not implement product code.',
          ].join('\n')
        : [
            'Plan Desk (ultra): structured plan mode is already active.',
            'Do not call EnterPlanMode again. Use NextPhase / AskUserQuestion / RecordInterviewFinding.',
            'When UltraGoal is verifiable, prefer NextPhase({ phase: \'write\' }) over design/review.',
            'Write only to the plan file, then ExitPlanMode. Do not implement product code.',
          ].join('\n')
      : undefined,
    job.prompt?.trim() ? `Brief:\n${job.prompt.trim()}` : undefined,
    job.contextPaths?.length
      ? `Read these first: ${job.contextPaths.join(', ')}`
      : undefined,
    parentFindings,
    job.ownershipPaths?.length
      ? `Preferred paths: ${job.ownershipPaths.join(', ')}`
      : undefined,
    job.worktreePath
      ? `You are running in an isolated worktree: ${job.worktreePath}. Do not push to remotes.`
      : undefined,
    [
      'Worker contract:',
      '- Trace the brief against the codebase before editing (callers / fail path / success criteria).',
      '- Prefer the smallest diff that meets success criteria; stay inside ownership/context paths when set.',
      '- After each meaningful change, run focused checks when available; cite that evidence in the result summary.',
      ...(uiJob
        ? [
            '- Visual DoD (UI job): write a short Art Direction Brief before first markup; Skill("premium-visual") before shipping a visible slice; call VerifySurface on the real surface before done (BrowserScreenshot alone does not set visual=passed); audit the attached screenshot or visualDescription against the craft rubric; record the screenshot path in the summary. MergeJob hard-fails without visual=passed.',
          ]
        : []),
      ...(job.worktreePath !== undefined
        ? [
            '- Commit your work in the job worktree before finishing (`git add -A && git commit`; local commits only, never push). This brief explicitly authorizes those commits — no confirmation loop needed. Land-to-main merges the branch, so uncommitted changes are invisible to it and lost at worktree GC.',
          ]
        : []),
      '- If blocked (env, missing info, contradiction), stop with a concrete blocker and what you tried — do not invent.',
      '- Final summary: what changed, how verified, what remains.',
    ].join('\n'),
  ];
  return parts.filter(Boolean).join('\n\n');
}

/**
 * Carry the parent job's result summary into a child worker prompt so
 * explore→implement chains do not lose findings to manual copying.
 */
function priorFindingsForJob(job: JobRecord, store?: ToolStore): string | undefined {
  if (store === undefined || job.parentJobId === undefined) return undefined;
  const parent = getJob(store, job.parentJobId);
  if (parent === undefined) return undefined;
  const summary = parent.resultSummary?.trim();
  const factLines = contractFactLines(parent.resultContract);
  if ((summary === undefined || summary.length === 0) && factLines.length === 0) {
    return undefined;
  }
  const cappedSummary =
    summary === undefined || summary.length === 0
      ? undefined
      : summary.length > JOB_PRIOR_FINDINGS_MAX_CHARS
        ? `${summary.slice(0, JOB_PRIOR_FINDINGS_MAX_CHARS)}\n[truncated]`
        : summary;
  const body = [cappedSummary, ...factLines].filter(Boolean).join('\n');
  return `Prior findings from parent job ${parent.id}:\n${body}`;
}

/** Structured handoff facts from the worker contract (files changed, verification). */
function contractFactLines(
  contract: JobRecord['resultContract'],
): readonly string[] {
  if (contract === undefined) return [];
  const lines: string[] = [];
  if (contract.files_changed.length > 0) {
    const shown = contract.files_changed.slice(0, 10).join(', ');
    const more =
      contract.files_changed.length > 10
        ? ` (+${contract.files_changed.length - 10} more)`
        : '';
    lines.push(`Files changed: ${shown}${more}`);
  }
  const v = contract.verification;
  lines.push(
    `Verification: tests=${v.tests}, typecheck=${v.typecheck}, lint=${v.lint}, visual=${v.visual ?? 'not_run'}`,
  );
  return lines;
}

function notifyInbox(
  store: ToolStore,
  job: JobRecord,
  status: JobStatus,
  summary?: string,
  agent?: Agent,
): void {
  const kind = inboxKindForStatus(status);
  if (kind === undefined) return;
  const event = pushJobInboxEvent(store, {
    kind,
    jobId: job.id,
    status,
    title: job.title,
    summary,
  });
  emitJobEvents(agent, [inboxToWireEvent(event), jobRecordToUpdatedEvent(job, { reason: kind })]);
  if (agent !== undefined) requestConductorWake({ agent, store });
}

function isTerminalOrCancelled(status: JobStatus): boolean {
  return (
    status === 'cancelled' ||
    status === 'done' ||
    status === 'failed' ||
    status === 'interrupted'
  );
}

/**
 * Snapshot a dirty job worktree at worker completion/failure (commit
 * backstop — see job-worktree-commit). Returns the ledger note line, or
 * undefined when the tree was clean or no git path exists. Never throws into
 * the completion path.
 */
async function snapshotWorkerWorktree(
  agent: Agent,
  job: JobRecord,
): Promise<string | undefined> {
  if (job.worktreePath === undefined || agent.kaos === undefined) return undefined;
  try {
    const result = await commitJobWorktreeIfDirty({
      kaos: agent.kaos,
      worktreePath: job.worktreePath,
      jobId: job.id,
      jobTitle: job.title,
    });
    if (result.committed) return 'commit: snapshotted dirty worktree (worker had not committed)';
    return result.error !== undefined ? `commit_failed: ${result.error}` : undefined;
  } catch (error) {
    return `commit_failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * Launch a background subagent for a job that is already `running` with worktree assigned.
 * Completion updates ledger, meta inbox, and pumps the scheduler for the next queued jobs.
 *
 * Lane contract: spawn may await briefly for handle registration, but worker
 * lifetime is fire-and-forget (`void handle.completion`) so the meta turn is not blocked.
 */
export async function launchJobWorker(input: LaunchJobWorkerInput): Promise<LaunchJobWorkerResult> {
  const host = input.agent.subagentHost;
  if (host === undefined) {
    return { ok: false, error: 'subagentHost unavailable' };
  }
  const job = getJob(input.store, input.job.id) ?? input.job;
  if (job.status !== 'running') {
    return { ok: false, error: `job not running: ${job.status}` };
  }

  const controller = new AbortController();
  registerJobWorkerHandle(job.id, controller);

  if (input.signal) {
    if (input.signal.aborted) {
      controller.abort(input.signal.reason);
    } else {
      input.signal.addEventListener('abort', () => controller.abort(input.signal?.reason), {
        once: true,
      });
    }
  }

  if (controller.signal.aborted) {
    clearJobWorkerHandle(job.id);
    return { ok: false, error: 'aborted before spawn' };
  }

  const profileName = profileForJobKind(job.kind);
  const objectiveBlob = [job.title, job.prompt, job.goalObjective].filter(Boolean).join('\n');
  if (objectiveBlob.trim().length > 0 && input.agent.objectiveProfile !== undefined) {
    input.agent.objectiveProfile.set(
      objectiveBlob,
      classifyObjectiveProfile(objectiveBlob, [
        ...(job.contextPaths ?? []),
        ...(job.ownershipPaths ?? []),
      ]),
    );
  }
  const uiFlags = uiSpawnQualityFlags({
    title: job.title,
    prompt: job.prompt,
    goalObjective: job.goalObjective,
    contextPaths: job.contextPaths,
    ownershipPaths: job.ownershipPaths,
  });
  const task: FanoutTask = {
    prompt: jobPrompt(job, input.store),
    description: job.title.slice(0, 80),
    profileName,
    ownership: job.ownershipPaths ? [...job.ownershipPaths] : undefined,
    worktreeDir: job.worktreePath,
    // UI Jobs force Premium Quality ON even when the Conductor toggle is OFF.
    forcePremiumQuality: uiFlags?.forcePremiumQuality,
    // Text-only coding models cannot audit screenshots; prefer a vision alias.
    preferVisionModel: uiFlags?.preferVisionModel,
    // Goal-driver (spec 2026-08-04-goal-driver-jobs): the goal migrates onto
    // the worker, whose turn engine then runs the autonomous loop. The brief
    // doubles as the objective; JobCreate validated its length.
    goal:
      job.kind === 'goal-driver'
        ? {
            objective: job.goalObjective ?? job.prompt?.trim() ?? job.title,
            completionCriterion: job.goalCompletionCriterion,
            budgetLimits: job.goalBudgetLimits,
          }
        : undefined,
    // Plan Desk: plan mode on the plan-profile worker (not Conductor).
    plan:
      job.kind === 'mission'
        ? {
            ultra: job.planStructured !== false,
            initialContext: job.prompt?.trim() || job.title,
            planId: `job-${job.id}`,
          }
        : undefined,
  };
  const parentToolCallId = `job:${job.id}:${randomUUID().slice(0, 8)}`;
  const spec: FanoutSpec = {
    mode: 'manual',
    parentToolCallId,
    runInBackground: true,
    signal: controller.signal,
    timeoutMs: DEFAULT_SUBAGENT_TIMEOUT_MS,
    tasks: [task],
  };

  const spawn = input.spawnOne ?? spawnOneAgent;

  try {
    const handle = await spawn(host, spec, task);
    setJobWorkerAgentId(job.id, handle.agentId);
    bindJobWorkerLedger(handle.agentId, input.store, job.id, input.agent);
    patchJob(input.store, job.id, {
      workerAgentId: handle.agentId,
      notes: [job.notes, `worker: ${handle.agentId} (${profileName})`].filter(Boolean).join('\n'),
    });

    // Fire-and-forget: interactive lane must not await worker completion.
    void handle.completion
      .then(async (completion) => {
        const current = getJob(input.store, job.id);
        // If cancelled/interrupted while running, keep that terminal state.
        if (current?.status === 'cancelled' || current?.status === 'interrupted') {
          return;
        }
        // Commit backstop: a dirty worktree here means the worker skipped the
        // contract — snapshot so land/merge and GC cannot lose the work.
        const commitNote = await snapshotWorkerWorktree(input.agent, current ?? job);
        const contract = completion.contract;
        const rawSummary =
          typeof completion.result === 'string'
            ? completion.result
            : String(completion.result ?? '');
        // Prefer the contract summary: the free-form result may embed the JSON
        // envelope, which eats the stored-summary budget without adding signal.
        const summary =
          (contract?.summary.trim() || rawSummary.trim()).slice(0, 4000) || 'worker completed';
        const verificationFailed = contract?.verification_failed === true;
        // The gate skips more often than it runs (explore jobs, multi-package
        // changes, paths outside the workspace layout, gate timeouts). Such a
        // job is still `done`, but saying so plainly keeps the conductor from
        // reading "no failure" as "verified" when it decides to merge.
        const unverified =
          !verificationFailed &&
          verificationIsUnverified(contract?.verification, contract?.files_changed);
        // Goal-driver terminal mapping (spec 2026-08-04-goal-driver-jobs §3.5):
        // a stopped goal (blocked/paused — budget circuit breaker, stagnation,
        // or a worker-reported blocker) escalates as a resumable `blocked` Job;
        // the verification gate still outranks it (invariant 4).
        const goalStopped =
          completion.goalStatus === 'blocked' || completion.goalStatus === 'paused';
        const finalStatus: JobStatus = verificationFailed
          ? 'failed'
          : goalStopped
            ? 'blocked'
            : 'done';
        const goalReason = completion.goalTerminalReason
          ? ` (${completion.goalTerminalReason})`
          : '';
        const resultSummary = verificationFailed
          ? `verification failed — ${summary}`
          : goalStopped
            ? `goal ${completion.goalStatus}${goalReason} — ${summary}`
            : unverified
              ? `${UNVERIFIED_SUMMARY_PREFIX}${summary}`
              : summary;
        const updated = patchJob(input.store, job.id, {
          // A done with a failed verification gate misled the conductor:
          // surface explicit verification failures as failed so the playbook
          // routes them to inspection instead of merge/land.
          status: finalStatus,
          resultSummary,
          ...(contract !== undefined ? { resultContract: contract } : {}),
          ...(completion.goalId !== undefined ? { goalId: completion.goalId } : {}),
          notes: [
            getJob(input.store, job.id)?.notes,
            commitNote,
            verificationFailed
              ? 'worker: completed but verification failed'
              : goalStopped
                ? `worker: goal ${completion.goalStatus}${goalReason}`
                : unverified
                  ? 'worker: completed unverified (checks did not run)'
                  : 'worker: completed',
          ]
            .filter(Boolean)
            .join('\n'),
        });
        if (updated) {
          notifyInbox(input.store, updated, finalStatus, updated.resultSummary, input.agent);
        }
      })
      .catch(async (error: unknown) => {
        const current = getJob(input.store, job.id);
        if (current?.status === 'cancelled' || current?.status === 'interrupted') {
          return;
        }
        // A crashed worker can leave partial work in the tree — snapshot it
        // so the failure path does not silently discard recoverable changes.
        const commitNote = await snapshotWorkerWorktree(input.agent, current ?? job);
        const detail = error instanceof Error ? error.message : String(error);
        const updated = patchJob(input.store, job.id, {
          status: 'failed',
          resultSummary: detail.slice(0, 2000),
          notes: [getJob(input.store, job.id)?.notes, commitNote, `worker_failed: ${detail}`]
            .filter(Boolean)
            .join('\n'),
        });
        if (updated) {
          notifyInbox(input.store, updated, 'failed', updated.resultSummary, input.agent);
        }
      })
      .finally(() => {
        unbindJobWorkerLedger(handle.agentId);
        clearJobWorkerHandle(job.id);
        pumpSchedulerAfterWorker(input.agent, input.store);
      });

    return { ok: true, workerAgentId: handle.agentId };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    clearJobWorkerHandle(job.id);
    const current = getJob(input.store, job.id);
    // A budget-exceeded hold (`blocked`, recorded by the offload lane) and
    // user-driven terminal states (cancel/interrupt) must not be clobbered
    // by a late spawn failure; only a live `running` job flips to failed.
    const keepState =
      current !== undefined &&
      (current.status === 'blocked' || isTerminalOrCancelled(current.status));
    const updated = patchJob(input.store, job.id, {
      ...(keepState ? {} : { status: 'failed' as const, resultSummary: detail.slice(0, 2000) }),
      notes: [current?.notes ?? job.notes, `spawn_failed: ${detail}`].filter(Boolean).join('\n'),
    });
    if (updated && !keepState) notifyInbox(input.store, updated, 'failed', detail, input.agent);
    return { ok: false, error: detail };
  }
}

/**
 * Cancel a job worker: abort live handle, mark ledger cancelled, inbox notify, reschedule.
 */
export async function cancelJobWorker(input: {
  readonly store: ToolStore;
  readonly agent?: Agent;
  readonly jobId: string;
  readonly reason?: string;
}): Promise<{
  readonly ok: boolean;
  readonly job?: JobRecord;
  readonly aborted: boolean;
  readonly error?: string;
}> {
  const existing = getJob(input.store, input.jobId);
  if (existing === undefined) {
    return { ok: false, aborted: false, error: `Job not found: ${input.jobId}` };
  }
  if (existing.status === 'done' || existing.status === 'cancelled') {
    return { ok: true, job: existing, aborted: false };
  }

  const aborted = abortRegisteredJobWorker(input.jobId, userCancellationReason());
  clearJobWorkerHandle(input.jobId);

  const job = patchJob(input.store, input.jobId, {
    status: 'cancelled',
    notes: [
      existing.notes,
      input.reason ? `cancel: ${input.reason}` : 'cancel',
      aborted ? 'worker: aborted' : 'worker: no live handle',
    ]
      .filter(Boolean)
      .join('\n'),
  });
  if (job) notifyInbox(input.store, job, 'cancelled', input.reason);

  if (input.agent) {
    pumpSchedulerAfterWorker(input.agent, input.store);
  }

  return { ok: true, job, aborted };
}

/**
 * Steer a running job worker via subagentHost when possible; always records note on ledger.
 */
export function steerJobWorker(input: {
  readonly store: ToolStore;
  readonly agent?: Agent;
  readonly jobId: string;
  readonly message: string;
  readonly status?: JobStatus;
}): {
  readonly ok: boolean;
  readonly job?: JobRecord;
  readonly steered: boolean;
  readonly error?: string;
} {
  const existing = getJob(input.store, input.jobId);
  if (existing === undefined) {
    return { ok: false, steered: false, error: `Job not found: ${input.jobId}` };
  }

  let steered = false;
  const workerId = existing.workerAgentId ?? getJobWorkerHandle(input.jobId)?.workerAgentId;
  const host = input.agent?.subagentHost as
    | { steerChild?: (id: string, parts: readonly { type: string; text: string }[]) => boolean }
    | undefined;
  if (workerId && host && typeof host.steerChild === 'function') {
    try {
      steered = host.steerChild(workerId, [{ type: 'text', text: input.message }]);
    } catch {
      steered = false;
    }
  }

  const note = [
    existing.notes,
    `steer: ${input.message}`,
    steered ? 'steer: delivered to worker' : 'steer: ledger only (worker not active)',
  ]
    .filter(Boolean)
    .join('\n');
  const job = patchJob(input.store, input.jobId, {
    notes: note,
    status: input.status ?? existing.status,
    prompt: existing.prompt ? `${existing.prompt}\n\n[steer] ${input.message}` : input.message,
  });
  return { ok: true, job, steered };
}

/**
 * Completion/cancel hook: request a scheduler pump on the offload lane.
 * V2-1: the pump is fire-and-forget and serialized; failures are recorded by
 * the offload lane, never on the completion/cancel path.
 */
export function pumpSchedulerAfterWorker(agent: Agent, store: ToolStore): void {
  requestJobSchedulePump({ store, agent });
}

/**
 * Resume interrupted (or blocked-by-interrupt) jobs: re-queue then schedule.
 * One-click path for `/job resume` and JobResume tool.
 * When `answer` is provided, the job is treated as a needs_user interview
 * card: the answer is injected into notes and the job re-queued so the
 * worker resumes with the user's input (mid-tool-loop input queue path).
 */
export async function resumeJobs(input: {
  readonly store: ToolStore;
  readonly agent?: Agent;
  /** Specific job id; omit to resume all interrupted. */
  readonly jobId?: string;
  /** Optional user answer for a needs_user card. */
  readonly answer?: string;
}): Promise<{
  readonly ok: boolean;
  readonly resumed: readonly JobRecord[];
  readonly message: string;
  readonly error?: string;
}> {
  const { store, agent, jobId, answer } = input;
  const candidates = listJobs(store).filter((j) => {
    if (jobId !== undefined) return j.id === jobId;
    if (answer !== undefined) return j.status === 'needs_user';
    return j.status === 'interrupted';
  });

  if (jobId !== undefined && candidates.length === 0) {
    return { ok: false, resumed: [], message: '', error: `Job not found: ${jobId}` };
  }

  const resumed: JobRecord[] = [];
  for (const job of candidates) {
    if (
      job.status !== 'interrupted' &&
      job.status !== 'blocked' &&
      job.status !== 'failed' &&
      job.status !== 'cancelled' &&
      job.status !== 'needs_user'
    ) {
      if (jobId !== undefined) {
        return {
          ok: false,
          resumed: [],
          message: '',
          error: `Job ${job.id} is ${job.status}; resume targets interrupted/blocked/failed/cancelled/needs_user.`,
        };
      }
      continue;
    }
    // Do not resume cancelled unless explicitly requested by id.
    if (job.status === 'cancelled' && jobId === undefined) continue;
    if (job.status === 'failed' && jobId === undefined) continue;

    const isAnswerCard = answer !== undefined && job.status === 'needs_user';
    const notes = isAnswerCard
      ? [job.notes, `user-answer: ${answer}`].filter(Boolean).join('\n')
      : [job.notes, 'resume: re-queued'].filter(Boolean).join('\n');
    const next = patchJob(store, job.id, {
      status: 'queued',
      notes,
      // Notes never reach a relaunched worker (jobPrompt reads the brief
      // only), so the answer must ride on the prompt to survive relaunch.
      ...(isAnswerCard
        ? { prompt: [job.prompt, `[user-answer] ${answer}`].filter(Boolean).join('\n\n') }
        : {}),
      // Keep worktreePath when present so schedule can reuse isolation.
    });
    if (next) resumed.push(next);
  }

  if (resumed.length === 0) {
    return {
      ok: true,
      resumed: [],
      message: jobId
        ? `Nothing to resume for ${jobId}.`
        : 'No interrupted jobs to resume.',
    };
  }

  let scheduleMessage = 'Queued for schedule.';
  if (agent) {
    // V2-1 ACK deadline: re-queue is synchronous; the schedule pump runs on
    // the offload lane. Resume keeps its pinned contract: re-launch spawn
    // handshakes settle before the return (spawner budget caps the wait);
    // worker lifetime never does.
    requestJobSchedulePump({ store, agent });
    await getJobWorkerSpawner().settle();
    scheduleMessage = 'Scheduling offloaded — transitions land on ledger/inbox.';
  }

  return {
    ok: true,
    resumed,
    message: `Resumed ${resumed.length} job(s). ${scheduleMessage}`,
  };
}

/**
 * Interrupt all running jobs (session pause): abort workers + ledger interrupted + inbox.
 */
export function interruptRunningJobs(input: {
  readonly store: ToolStore;
  readonly reason?: string;
}): readonly JobRecord[] {
  const reason = input.reason ?? 'session interrupted';
  const out: JobRecord[] = [];
  for (const job of listJobs(input.store)) {
    if (job.status !== 'running') continue;
    abortRegisteredJobWorker(job.id, new Error(reason));
    clearJobWorkerHandle(job.id);
    const next = patchJob(input.store, job.id, {
      status: 'interrupted',
      notes: [job.notes, `interrupt: ${reason}`].filter(Boolean).join('\n'),
    });
    if (next) {
      notifyInbox(input.store, next, 'interrupted', reason);
      out.push(next);
    }
  }
  return out;
}

export { abortRegisteredJobWorker as abortJobWorker };
