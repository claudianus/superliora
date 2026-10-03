/**
 * Conductor Job → subagent worker launch (P1.5).
 * Spawns a background subagent in the job worktree and patches the ledger on completion.
 */

import { randomUUID } from 'node:crypto';
import { dirname, join } from 'pathe';


import type { Kaos } from '@superliora/kaos';

import type { Agent } from '../../../agent/index';
import { hasUnsettledExecutionResources, runGit } from '../../../session/job/git';
import { type FanoutSpec, type FanoutTask, spawnOneAgent } from '../../../fleet/spawn-agents';
import { areJobAdmissionsOpen, closeJobAdmission, openJobAdmission } from './job-runtime';
import { cancelQueuedJobWorkerSpawn, requestJobSchedulePump } from '../../../session/job/job-offload';
import { removeSessionWorktree } from '../../../session/worktree';
import {
  isSubagentDeadlineError,
} from '../../../session/subagent/subagent-host';
import { userCancellationReason } from '../../../utils/abort';
import type { ToolStore } from '../../store';
import {
  bindJobWorkerHost,
  getJobWorkerHost,
  type JobWorkerHost,
  clearJobWorkerHandle,
  getJobWorkerHandle,
  registerJobWorkerHandle,
  joinJobWorkerHandle,
  setJobWorkerAgentId,
  abortJobWorker as abortRegisteredJobWorker,
} from './job-handles';
import {
  abortJobNativeOperations,
  getJobNativeFailure,
  hasJobNativeResources,
  listJobNativeResourceIds,
  jobResourceErrors,
  retainJobNativeCleanup,
  runJobNativeOperation,
  settleJobNativeResources,
} from './job-native-resources';
import {
  bindJobWorkerLedger,
  buildDeadlineFailureSummary,
} from './job-worker-ledger-bridge';
import { runMergeLandJob, type LandJobToMainInput } from './job-land';
import { getJob, listJobs, patchJob, type JobRecord, type JobStatus } from './job-ledger';
import { notifyJobTerminal, patchJobAndNotify } from './job-notify';
import { runPushRemoteJob } from './job-push';
import { commitJobWorktreeIfDirty } from './job-worktree-commit';
import { jobDevServerPort } from '../../../session/worktree-setup';

export interface LaunchJobWorkerInput {
  readonly store: ToolStore;
  readonly agent: Agent;
  readonly workerHost?: JobWorkerHost;
  /** Injectable git runner for kind=merge land / kind=push (tests). */
  readonly runGit?: LandJobToMainInput['runGit'];
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

/**
 * Cap accumulated operator steering text so the durable ledger remains bounded.
 */
const JOB_STEER_NOTES_MAX_CHARS = 8_000;
const JOB_STEER_PROMPT_MAX_CHARS = 32_000;

/** Trim an append tail to `maxChars`, keeping the newest content and a marker. */
function capAppendTail(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const trimmed = text.slice(text.length - maxChars);
  const firstNewline = trimmed.indexOf('\n');
  const body = firstNewline >= 0 ? trimmed.slice(firstNewline + 1) : trimmed;
  return `[…earlier steer history trimmed, ${String(text.length - body.length)} chars omitted]\n${body}`;
}

/** Cap for the parent job's result summary carried into a child worker prompt. */
export const JOB_PRIOR_FINDINGS_MAX_CHARS = 2000;

export function jobPrompt(
  job: JobRecord,
  store?: ToolStore,
  recoveryWorktreeSnapshot?: string,
): string {
  return [
    job.prompt ?? job.title,
    job.worktreePath ? `Working directory: ${job.worktreePath}` : undefined,
    jobDevServerPort(job.portOffset) !== undefined
      ? `Assigned development server port: ${String(jobDevServerPort(job.portOffset))}`
      : undefined,
    job.contextPaths?.length ? `Context paths: ${job.contextPaths.join(', ')}` : undefined,
    job.ownershipPaths?.length ? `Scope paths: ${job.ownershipPaths.join(', ')}` : undefined,
    job.successCriteria?.length ? `Requested outcomes:\n${job.successCriteria.join('\n')}` : undefined,
    job.mustNotTouch?.length ? `Excluded scope: ${job.mustNotTouch.join(', ')}` : undefined,
    job.verificationCommands?.length
      ? `Operator-requested checks:\n${job.verificationCommands.join('\n')}`
      : undefined,
    priorFindingsForJob(job, store),
    renderRecoveryBriefAppendix(job, recoveryWorktreeSnapshot),
  ].filter(Boolean).join('\n\n');
}

/**
 * Soft continuity for crash/resume cold relaunch: last progress, interrupt
 * reason, worktree HEAD/status, and a no-rewrite guard. Shown when notes
 * mention interrupt/resume or a checkpoint id is retained. `worktreeSnapshot`
 * is precomputed off the event loop (async git exec) by the spawn path.
 */
export function renderRecoveryBriefAppendix(
  job: JobRecord,
  worktreeSnapshot?: string | undefined,
): string | undefined {
  const notes = job.notes ?? '';
  const isRecovery =
    /\binterrupt:/i.test(notes) ||
    /\bresume:/i.test(notes) ||
    job.workerResumeAgentId !== undefined;
  if (!isRecovery) return undefined;

  const interruptLine = notes
    .split('\n')
    .toReversed()
    .find((line) => /\binterrupt:/i.test(line) || /\bresume:/i.test(line));
  const progress = job.progress;
  const progressBits: string[] = [];
  if (progress?.phase) progressBits.push(`phase=${progress.phase}`);
  if (progress?.recentTools && progress.recentTools.length > 0) {
    progressBits.push(`recentTools=${progress.recentTools.slice(0, 5).join(',')}`);
  }
  if (progress?.lastHeartbeatAt) progressBits.push(`heartbeat=${progress.lastHeartbeatAt}`);

  const parts = [
    '## Crash / resume continuity',
    interruptLine !== undefined ? `Last interrupt/resume note: ${interruptLine.trim()}` : undefined,
    progressBits.length > 0 ? `Last progress: ${progressBits.join(' · ')}` : undefined,
    job.workerResumeAgentId !== undefined
      ? `Prior worker id (checkpoint): ${job.workerResumeAgentId}${job.workerCheckpointAt ? ` @ ${job.workerCheckpointAt}` : ''}`
      : undefined,
    job.resultSummary?.trim()
      ? `Prior result summary (may be partial):\n${job.resultSummary.trim().slice(0, 1200)}`
      : undefined,
    worktreeSnapshot,
  ];
  return parts.filter(Boolean).join('\n');
}

/** Async git snapshot so the spawn path never blocks the event loop on git. */
async function snapshotWorktreeForRecovery(
  kaos: Kaos | undefined,
  worktreePath: string | undefined,
  signal?: AbortSignal,
): Promise<string | undefined> {
  if (worktreePath === undefined || worktreePath.trim().length === 0) return undefined;
  if (kaos === undefined) {
    return `Worktree path retained: ${worktreePath} (git status unavailable).`;
  }
  const head = await runGit(kaos, worktreePath, ['rev-parse', '--short', 'HEAD'], 0, signal);
  if (!head.ok) {
    return `Worktree path retained: ${worktreePath} (git status unavailable).`;
  }
  const status = await runGit(kaos, worktreePath, ['status', '--porcelain'], 0, signal);
  const dirty = status.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 20);
  return [
    `Worktree HEAD: ${head.stdout.trim()}`,
    dirty.length > 0 ? `Dirty paths:\n${dirty.join('\n')}` : 'Worktree clean.',
  ].join('\n');
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
  if (!summary) return undefined;
  return `Prior result from job ${parent.id}:\n${summary.slice(0, JOB_PRIOR_FINDINGS_MAX_CHARS)}`;
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
  store: ToolStore,
): Promise<string | undefined> {
  if (job.worktreePath === undefined || agent.kaos === undefined) return undefined;
  try {
    const result = await runJobNativeOperation(store, job.id, {
      paths: [job.worktreePath],
    }, (_holdPath, signal) => commitJobWorktreeIfDirty({
      kaos: agent.kaos,
      signal,
      worktreePath: job.worktreePath!,
      jobId: job.id,
      jobTitle: job.title,
    }));
    if (result.committed) return 'commit: snapshotted dirty worktree (worker had not committed)';
    return result.error !== undefined ? `commit_failed: ${result.error}` : undefined;
  } catch (error) {
    if (hasUnsettledExecutionResources(error)) throw error;
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
  let job = getJob(input.store, input.job.id) ?? input.job;
  if (!areJobAdmissionsOpen(input.store, job.id)) return { ok: false, error: 'Job runtime is closed.' };
  if (input.workerHost) bindJobWorkerHost(input.store, input.workerHost);
  if (job.status !== 'running') {
    return { ok: false, error: `job not running: ${job.status}` };
  }


  // Merge landing: deterministic git land on the source worktree — never an LLM.
  if (job.kind === 'merge') {
    // Ledger owns done/blocked; do not surface land failure as spawn_failed.
    await runMergeLandJob({
      store: input.store,
      mergeJob: job,
      kaos: input.agent.kaos,
      repoPath: input.agent.config.cwd,
      runGit: input.runGit,
      agent: input.agent,
    });
    pumpSchedulerAfterWorker(input.agent, input.store);
    return { ok: true };
  }

  // Remote push: deterministic git push on the source worktree — never an LLM.
  // remoteRef may be omitted; runPushRemoteJob effect-judges a Pages target
  // (etc.) from push/source job titles and briefs.
  if (job.kind === 'push') {
    const remoteMatch = /\bremote:\s*(\S+)/i.exec(job.prompt ?? '');
    const localMatch = /\blocalRef:\s*(\S+)/i.exec(job.prompt ?? '');
    const remoteRefMatch = /\bremoteRef:\s*(\S+)/i.exec(job.prompt ?? '');
    await runPushRemoteJob({
      store: input.store,
      pushJob: job,
      kaos: input.agent.kaos,
      repoPath: input.agent.config.cwd,
      runGit: input.runGit,
      agent: input.agent,
      remote: remoteMatch?.[1] ?? 'origin',
      localRef: localMatch?.[1],
      remoteRef: remoteRefMatch?.[1],
    });
    pumpSchedulerAfterWorker(input.agent, input.store);
    return { ok: true };
  }

  const host = input.workerHost ?? getJobWorkerHost(input.store);
  if (host === undefined) {
    patchJobAndNotify(input.store, job.id, {
      status: 'failed',
      resultSummary: 'Worker session host unavailable.',
    }, { agent: input.agent });
    return { ok: false, error: 'Worker session host unavailable.' };
  }

  const controller = new AbortController();
  const registered = registerJobWorkerHandle(input.store, job.id, controller, job.worktreePath ? [job.worktreePath] : []);

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

  const spawn = input.spawnOne ?? spawnOneAgent;
  try {
    const recovery = await runJobNativeOperation(input.store, job.id, {
      paths: [job.worktreePath],
    }, () => snapshotWorktreeForRecovery(input.agent.kaos, job.worktreePath, controller.signal));
    const current = getJob(input.store, job.id);
    if (!areJobAdmissionsOpen(input.store, job.id) || controller.signal.aborted || current?.status !== 'running') {
      clearJobWorkerHandle(job.id);
      return { ok: false, error: 'worker stopped during preparation' };
    }
    job = current;
    const baseTaskFields = {
      prompt: jobPrompt(job, input.store, recovery),
      description: job.title.slice(0, 80),
      profileName: 'agent',
      ownership: job.ownershipPaths ? [...job.ownershipPaths] : undefined,
      worktreeDir: job.worktreePath,
      modelAlias: job.modelAlias,
    } as const;
    const resumeAgentId = job.workerResumeAgentId?.trim() || undefined;
    const task: FanoutTask = {
      ...baseTaskFields,
      ...(resumeAgentId !== undefined ? { resumeAgentId } : {}),
    };
    const parentToolCallId = `job:${job.id}:${randomUUID().slice(0, 8)}`;
    const spec: FanoutSpec = {
      parentToolCallId,
      runInBackground: true,
      signal: controller.signal,
      timeoutMs: job.timeoutMs,
      tasks: [task],
    };
    const handle = await spawn(host, spec, task);
    const reattached = resumeAgentId !== undefined && handle.resumed === true;
    registered.resourcesSettled = () => handle.resourcesSettled;
    registered.stopAndJoin = () => host.stopAndJoin(handle.agentId, userCancellationReason());
    setJobWorkerAgentId(job.id, handle.agentId);
    bindJobWorkerLedger(handle.agentId, input.store, job.id, input.agent);
    const nowIso = new Date().toISOString();
    const workerHomedir =
      input.agent.homedir !== undefined && input.agent.homedir.length > 0
        ? join(dirname(input.agent.homedir), handle.agentId)
        : undefined;
    patchJob(input.store, job.id, {
      workerAgentId: handle.agentId,
      workerResumeAgentId: handle.agentId,
      workerCheckpointAt: nowIso,
      ...(workerHomedir !== undefined ? { workerHomedir } : {}),
      notes: [
        job.notes,
        reattached
          ? `worker-reattach: ${handle.agentId}`
          : `worker: ${handle.agentId}`,
      ]
        .filter(Boolean)
        .join('\n'),
    });

    // Fire-and-forget: interactive lane must not await worker completion.
    void handle.completion
      .then(async (completion) => {
        if (handle.resourcesSettled !== true) {
          const error = new Error(`Worker completed without releasing native resources: ${job.id}`);
          Object.defineProperty(error, 'resourcesSettled', { get: () => handle.resourcesSettled === true });
          throw error;
        }
        const current = getJob(input.store, job.id);
        // Late completion cannot overwrite an operator cancel or interrupt.
        if (controller.signal.aborted || getJobWorkerHandle(job.id)?.controller !== controller ||
            (current !== undefined && isTerminalOrCancelled(current.status))) {
          return;
        }
        const ledgerJob = current ?? job;
        const commitNote = await snapshotWorkerWorktree(input.agent, ledgerJob, input.store);
        if (controller.signal.aborted || getJobWorkerHandle(job.id)?.controller !== controller) return;
        const summary = String(completion.result ?? '').trim().slice(0, 4500);
        const effectiveStatus: JobStatus = commitNote?.startsWith('commit_failed:')
          ? 'failed'
          : 'done';
        const pendingLand =
          effectiveStatus === 'done' &&
          ledgerJob.worktreePath !== undefined &&
          ledgerJob.landReceipt === undefined &&
          ledgerJob.landChoice === undefined;
        const updated = patchJob(input.store, job.id, {
          status: effectiveStatus,
          resultSummary: effectiveStatus === 'failed'
            ? `${commitNote}\n${summary}`.slice(0, 4500)
            : summary || 'Worker completed without a text result.',
          filesChanged: completion.filesChanged,
          usage: completion.usage,
          ...(pendingLand ? { landChoice: 'pending' as const } : {}),
          notes: [
            getJob(input.store, job.id)?.notes,
            commitNote,
            `worker: ${effectiveStatus === 'done' ? 'completed' : 'snapshot failed'}`,
          ].filter(Boolean).join('\n'),
        });
        if (updated) {
          notifyJobTerminal({
            store: input.store,
            job: updated,
            status: effectiveStatus,
            summary: updated.resultSummary,
            agent: input.agent,
          });
        }
      })
      .catch(async (error: unknown) => {
        if (!controller.signal.aborted || handle.resourcesSettled !== true || hasUnsettledExecutionResources(error)) {
          registered.failure ??= error;
        }
        retainJobNativeCleanup(input.store, job.id, error);
        if (handle.resourcesSettled !== true || hasUnsettledExecutionResources(error)) return;
        const current = getJob(input.store, job.id);
        // Terminal states (cancel/interrupt/failure already recorded) are not
        // retried or overwritten by a late worker crash.
        if (controller.signal.aborted || getJobWorkerHandle(job.id)?.controller !== controller ||
            (current !== undefined && isTerminalOrCancelled(current.status))) {
          return;
        }
        if (controller.signal.aborted || getJobWorkerHandle(job.id)?.controller !== controller) return;
        const detail = error instanceof Error ? error.message : String(error);
        // Wall-clock abort: always persist a resume handoff (last phase/files/
        // command) so continue_from does not restart a repo-wide scan empty.
        const isDeadline = isSubagentDeadlineError(error);
        const ledgerJob = current ?? job;
        const resultSummary = isDeadline
          ? buildDeadlineFailureSummary(
              ledgerJob,
              detail,
              ledgerJob.workerAgentId ?? handle.agentId,
            )
          : detail.slice(0, 2000);
        const updated = patchJob(input.store, job.id, {
          status: 'failed',
          resultSummary,
          notes: [
            getJob(input.store, job.id)?.notes,
            isDeadline
              ? `worker_deadline: ${detail}`
              : `worker_failed: ${detail}`,
          ]
            .filter(Boolean)
            .join('\n'),
        });
        if (updated) {
          notifyJobTerminal({
            store: input.store,
            job: updated,
            status: 'failed',
            summary: updated.resultSummary,
            agent: input.agent,
          });
        }
      })
      .finally(() => {
        clearJobWorkerHandle(job.id);
        if (getJobWorkerHandle(job.id) === undefined) {
          if (!controller.signal.aborted) pumpSchedulerAfterWorker(input.agent, input.store);
        }
      })
      .catch((error: unknown) => {
        registered.failure ??= error;
        retainJobNativeCleanup(input.store, job.id, error);
        input.agent.log?.warn('Job worker completion failed', {
          jobId: job.id, error: error instanceof Error ? error.message : String(error),
        });
      });


    return { ok: true, workerAgentId: handle.agentId };
  } catch (error) {
    if (!controller.signal.aborted || hasUnsettledExecutionResources(error)) registered.failure ??= error;
    retainJobNativeCleanup(input.store, job.id, error);
    const detail = error instanceof Error ? error.message : String(error);
    if (registered.resourcesSettled && registered.resourcesSettled() !== true) {
      controller.abort(error);
      try { await registered.stopAndJoin?.(); }
      catch (cleanupError) { retainJobNativeCleanup(input.store, job.id, cleanupError); }
    }
    if (getJobWorkerHandle(job.id)?.controller === controller) clearJobWorkerHandle(job.id);
    if (hasUnsettledExecutionResources(error) || hasJobNativeResources(input.store, job.id) ||
        (registered.resourcesSettled && registered.resourcesSettled() !== true)) {
      patchJob(input.store, job.id, {
        resultSummary: detail.slice(0, 2000),
        notes: [getJob(input.store, job.id)?.notes, `native_cleanup_failed: ${detail}`].filter(Boolean).join('\n'),
      });
      throw error;
    }
    const current = getJob(input.store, job.id);
    // A budget-exceeded hold (`blocked`, recorded by the offload lane) and
    // user-driven terminal states (cancel/interrupt) must not be clobbered
    // by a late spawn failure; only a live `running` job flips to failed.
    const keepState =
      current !== undefined &&
      (controller.signal.aborted || current.status === 'blocked' || isTerminalOrCancelled(current.status));

    const updated = patchJob(input.store, job.id, {
      ...(keepState ? {} : { status: 'failed' as const, resultSummary: detail.slice(0, 2000) }),
      notes: [current?.notes ?? job.notes, `spawn_failed: ${detail}`].filter(Boolean).join('\n'),
    });
    if (updated && !keepState) {
      notifyJobTerminal({
        store: input.store,
        job: updated,
        status: 'failed',
        summary: detail,
        agent: input.agent,
      });
    }
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
  readonly status?: 'cancelled' | 'interrupted';
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
  if ((existing.status === 'done' || existing.status === 'failed' || existing.status === 'cancelled') &&
      getJobWorkerHandle(input.jobId) === undefined && !hasJobNativeResources(input.store, input.jobId)) {
    return { ok: true, job: existing, aborted: false };
  }

  closeJobAdmission(input.store, input.jobId);
  cancelQueuedJobWorkerSpawn(input.store, input.jobId);
  const nativeFailure = getJobNativeFailure(input.store, input.jobId);
  const stopReason = userCancellationReason();
  abortJobNativeOperations(input.store, input.jobId, stopReason);
  let handle = getJobWorkerHandle(input.jobId);
  let lastHandle = handle;
  let aborted = false;
  while (handle) {
    handle.stoppingStatus = input.status ?? 'cancelled';
    aborted = abortRegisteredJobWorker(input.jobId, stopReason) || aborted;
    await joinJobWorkerHandle(input.jobId);
    lastHandle = handle;
    handle = getJobWorkerHandle(input.jobId);
  }
  await settleJobNativeResources(input.store, input.jobId);
  const latest = getJob(input.store, input.jobId) ?? existing;
  const executionFailure = lastHandle?.failure ?? nativeFailure;
  const stoppingStatus = executionFailure !== undefined ? 'failed' : lastHandle?.stoppingStatus ?? input.status ?? 'cancelled';

  if (stoppingStatus === 'cancelled') await maybeRemoveNeverRanWorktree(input, latest);
  const afterCleanup = getJob(input.store, input.jobId) ?? latest;
  const job = patchJobAndNotify(
    input.store,
    input.jobId,
    {
      status: stoppingStatus,
      ...(executionFailure !== undefined ? {
        resultSummary: executionFailure instanceof Error ? executionFailure.message : String(executionFailure),
      } : {}),
      notes: [
        afterCleanup.notes,
        `${stoppingStatus === 'interrupted' ? 'interrupt' : 'cancel'}: ${input.reason ?? 'operator request'}`,
        aborted ? 'worker: teardown settled' : 'worker: no live handle',
      ]
        .filter(Boolean)
        .join('\n'),
    },
    { agent: input.agent, summary: input.reason },
  );


  if (input.agent && stoppingStatus !== 'interrupted') {
    pumpSchedulerAfterWorker(input.agent, input.store);
  }

  return { ok: true, job, aborted };
}

/**
 * A job cancelled before any worker ever bound to it keeps only a pristine
 * baseline worktree (git bootstrap + empty branch). That is pure debris —
 * drop it immediately instead of holding it for the failed-worktree TTL.
 * Jobs that ran a worker keep the 7-day forensics retention.
 */
async function maybeRemoveNeverRanWorktree(
  input: { readonly store: ToolStore; readonly agent?: Agent },
  job: JobRecord,
): Promise<void> {
  if (input.agent === undefined) return;
  if (job.workerAgentId !== undefined || job.workerResumeAgentId !== undefined) return;
  if (job.worktreePath === undefined) return;
  if (job.landReceipt !== undefined || job.resultSummary !== undefined) return;
  if (job.sessionNamePinned === true) return;
  const worktreePath = job.worktreePath;
  const worktreeBranch = job.worktreeBranch;
  await runJobNativeOperation(input.store, job.id, {}, (holdPath, signal) =>
    removeSessionWorktree(input.agent!.kaos, { nameOrPath: worktreePath, onWorktreePath: holdPath, signal }))
    .then(() => {
      patchJobAndNotify(
        input.store,
        job.id,
        {
          worktreePath: undefined,
          worktreeBranch: undefined,
          notes: 'cancel: pristine worktree removed (no worker ever ran)',
        },
        { agent: input.agent },
      );
    })
    .catch((error: unknown) => {
      if (hasUnsettledExecutionResources(error)) throw error;
      input.agent?.log?.warn('cancel cleanup: pristine worktree removal failed', {
        jobId: job.id,
        worktreePath,
        worktreeBranch,
        error: error instanceof Error ? error.message : String(error),
      });
    });
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

  // State-machine guard: JobSteer may park or re-open a job, but terminal
  // verdicts belong to worker completion / JobCancel, and forcing `running`
  // bypasses the scheduler — a worker-less `running` job leaks a pool slot
  // forever (no spawner, no stall watchdog).
  if (
    input.status === 'done' ||
    input.status === 'failed' ||
    input.status === 'cancelled' ||
    input.status === 'interrupted'
  ) {
    return {
      ok: false,
      steered: false,
      error: `JobSteer cannot set terminal status '${input.status}' — terminal states come from worker completion or JobCancel.`,
    };
  }
  if (input.status === 'running' && existing.status !== 'running') {
    return {
      ok: false,
      steered: false,
      error:
        "JobSteer cannot force status 'running' — promotion is owned by the scheduler; use JobResume to (re)start the job.",
    };
  }
  // Park/re-open guards: parked states are owned by the spawner budget or the
  // blocker that set them, and `queued` must go through JobResume so the
  // scheduler can re-run ownership/worktree gates — steering it directly
  // bypasses those checks.
  if (input.status === 'blocked' && existing.status !== 'blocked') {
    return {
      ok: false,
      steered: false,
      error:
        "JobSteer cannot set status 'blocked' — parked states are owned by the spawner/merge gates; use JobResume to (re)start the job.",
    };
  }
  if (input.status === 'queued') {
    return {
      ok: false,
      steered: false,
      error:
        "JobSteer cannot set status 'queued' — requeueing is owned by JobResume; the scheduler then re-runs ownership/worktree gates.",
    };
  }

  let steered = false;
  const workerId = existing.workerAgentId ?? getJobWorkerHandle(input.jobId)?.workerAgentId;
  const host = getJobWorkerHost(input.store);
  if (workerId && host) {
    try {
      steered = host.steerChild(workerId, [{ type: 'text', text: input.message }]);
    } catch (error) {
      return { ok: false, steered: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  const live =
    existing.status === 'running' || existing.status === 'needs_user' || getJobWorkerHandle(existing.id) !== undefined;
  const reattachTerminal =
    !live &&
    existing.landReceipt === undefined &&
    (existing.kind === 'task' || existing.kind === 'implement') &&
    (existing.status === 'done' ||
      existing.status === 'failed' ||
      existing.status === 'interrupted');
  // A completed worker can be reattached by explicit operator steering.
  if (!steered && reattachTerminal) {
    steered = true;
  }


  const nextStatus = reattachTerminal
    ? 'queued'
    : (input.status ?? existing.status);
  const note = [
    existing.notes,
    `steer: ${input.message}`,
    steered
      ? workerId && host
        ? 'steer: delivered to worker'
        : 'steer: ledger patched (worker not active)'
      : 'steer: ledger only (worker not active)',
  ]
    .filter(Boolean)
    .join('\n');
  const job = patchJobAndNotify(
    input.store,
    input.jobId,
    {
      // Keep bounded steering history and disclose any truncation.
      notes: capAppendTail(note, JOB_STEER_NOTES_MAX_CHARS),
      status: nextStatus,
      prompt: capAppendTail(
        existing.prompt ? `${existing.prompt}\n\n[steer] ${input.message}` : input.message,
        JOB_STEER_PROMPT_MAX_CHARS,
      ),
    },
    { agent: input.agent, summary: input.message },
  );
  if (reattachTerminal && input.agent !== undefined) {
    pumpSchedulerAfterWorker(input.agent, input.store);
  }
  return { ok: true, job, steered };
}

/**
 * Completion/cancel hook: request a scheduler pump on the offload lane.
 * V2-1: the pump is fire-and-forget and serialized; failures are recorded by
 * the offload lane, never on the completion/cancel path.
 */
export function pumpSchedulerAfterWorker(agent: Agent, store: ToolStore): void {
  void requestJobSchedulePump({ store, agent });
}

/**
 * Resume interrupted (or blocked-by-interrupt) jobs: re-queue then schedule.
 * One-click path for `/job resume` and JobResume tool.
 * When `answer` is provided, the job is treated as a needs_user interview
 * card: the answer is injected into notes and the job re-queued so the
 * worker resumes with the user's input (mid-tool-loop input queue path).
 *
 * Live shared-RPC interviews keep ledger status `running` while the question
 * UI is open. Late answers still deliver: abort the stalled waiter, append
 * the answer, and re-queue (same as a paused needs_user card).
 */
export async function resumeJobs(input: {
  readonly store: ToolStore;
  readonly agent?: Agent;
  /** Specific job id; omit to resume all interrupted. */
  readonly jobId?: string;
  /** Optional user answer for a needs_user card. */
  readonly answer?: string;
  /**
   * Skip the offload pump (fleet recovery re-queues many jobs, then pumps once
   * so independent work starts together instead of one schedule tick each).
   */
  readonly skipSchedulePump?: boolean;
}): Promise<{
  readonly ok: boolean;
  readonly resumed: readonly JobRecord[];
  readonly message: string;
  readonly error?: string;
}> {
  const { store, agent, jobId, answer } = input;
  if (!areJobAdmissionsOpen(store)) {
    return { ok: false, resumed: [], message: '', error: 'Job runtime is closed.' };
  }
  const candidates = listJobs(store).filter((j) => {
    if (jobId !== undefined) return j.id === jobId;
    if (answer !== undefined) return j.status === 'needs_user' || isLiveInterviewJob(j);
    return j.status === 'interrupted' || j.status === 'queued';
  });

  if (jobId !== undefined && candidates.length === 0) {
    return { ok: false, resumed: [], message: '', error: `Job not found: ${jobId}` };
  }

  const resumed: JobRecord[] = [];
  for (const job of candidates) {
    const liveInterviewAnswer =
      answer !== undefined && job.status === 'running' && isLiveInterviewJob(job);
    if (
      job.status !== 'interrupted' &&
      job.status !== 'blocked' &&
      job.status !== 'failed' &&
      job.status !== 'cancelled' &&
      job.status !== 'needs_user' &&
      job.status !== 'queued' &&
      !liveInterviewAnswer
    ) {
      if (jobId !== undefined) {
        return {
          ok: false,
          resumed: [],
          message: '',
          error: `Job ${job.id} is ${job.status}; resume targets interrupted/blocked/failed/cancelled/needs_user (or running interview with answer).`,
        };
      }
      continue;
    }
    // Do not resume cancelled unless explicitly requested by id.
    if (job.status === 'cancelled' && jobId === undefined) continue;
    if (job.status === 'failed' && jobId === undefined) continue;

    const isAnswerCard =
      answer !== undefined && (job.status === 'needs_user' || liveInterviewAnswer);
    closeJobAdmission(store, job.id);
    const handle = getJobWorkerHandle(job.id);
    if (handle) {
      abortRegisteredJobWorker(job.id, new Error('operator resume'));
      await joinJobWorkerHandle(job.id);
    }
    await settleJobNativeResources(store, job.id);
    openJobAdmission(store, job.id);
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
    if (next) {
      resumed.push(next);
    }
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
  if (agent && input.skipSchedulePump !== true) {
    // Same contract as JobCreate: ACK after ledger re-queue. Worktree I/O and
    // spawn handshakes stay on the offload lane so Conductor/session resume
    // never waits on a worker. Attach lands on ledger/inbox.
    void requestJobSchedulePump({ store, agent });
    scheduleMessage = 'Scheduling offloaded — transitions land on ledger/inbox.';
  }

  return {
    ok: true,
    resumed,
    message: `Resumed ${resumed.length} job(s). ${scheduleMessage}`,
  };
}

/**
 * Shared-RPC AskUserQuestion keeps the job `running` and stamps interview notes
 * / resultSummary. Used so JobResume(answer) can deliver a late answer without
 * rejecting `running`.
 */
function isLiveInterviewJob(job: JobRecord): boolean {
  if (job.status !== 'running') return false;
  const summary = job.resultSummary ?? '';
  if (summary.startsWith('needs_user:')) return true;
  const notes = job.notes ?? '';
  return notes.includes('interview:');
}

/**
 * Interrupt all running jobs (session pause): abort workers + ledger interrupted + inbox.
 */
export async function interruptRunningJobs(input: {
  readonly store: ToolStore;
  readonly agent?: Agent;
  readonly reason?: string;
}): Promise<readonly JobRecord[]> {
  const reason = input.reason ?? 'session interrupted';
  const out: JobRecord[] = [];
  const owned = new Set(listJobNativeResourceIds(input.store));
  const running = listJobs(input.store).filter((job) =>
    job.status === 'running' || getJobWorkerHandle(job.id) !== undefined || owned.has(job.id));
  const results = await Promise.allSettled(running.map((job) => cancelJobWorker({
    ...input, jobId: job.id, status: 'interrupted', reason,
  })));
  const errors: unknown[] = [];
  for (const result of results) {
    if (result.status === 'rejected') errors.push(result.reason);
    else if (result.value.job) out.push(result.value.job);
  }
  if (errors.length > 0) throw jobResourceErrors(errors, 'Job worker shutdown failed');
  return out;
}

/**
 * After hard process death, mark running records interrupted only when this
 * process has no live handle. Explicit `/job resume` can then restore work.
 */
export function reconcileStaleRunningJobs(input: {
  readonly store: ToolStore;
  readonly agent?: Agent;
  readonly reason?: string;
}): readonly JobRecord[] {
  const out: JobRecord[] = [];
  for (const job of listJobs(input.store)) {
    if (job.status !== 'running' || getJobWorkerHandle(job.id) !== undefined) continue;
    const next = patchJobAndNotify(input.store, job.id, {
      status: 'interrupted',
      notes: [job.notes, `interrupt: ${input.reason ?? 'process restarted'}`].filter(Boolean).join('\n'),
    }, { agent: input.agent });
    if (next) out.push(next);
  }
  return out;
}

export { abortRegisteredJobWorker as abortJobWorker };

