/** Native Job concurrency, dependency scheduling, and worktree ownership. */

import type { Kaos } from '@superliora/kaos';
import { hasUnsettledExecutionResources } from '../../../session/job/git';

import type { Agent } from '../../../agent/index';
import type { Logger } from '../../../logging/types';
import {
  attachSessionWorktree,
  createSessionWorktree,
  gcSessionWorktrees,
  isSessionWorktreeOwned,
  removeSessionWorktree,
  sessionWorktreeDirExists,
  type CreateSessionWorktreeResult,
} from '../../../session/worktree';
import { nextPortOffset, setupJobWorktree } from '../../../session/worktree-setup';
import type { ToolStore } from '../../store';
import { resolveRepoRootForNewJob } from './job-git-root';
import { ensureGitRepoForWorktrees } from '../../../session/git-bootstrap';
import {
  getJob,
  listJobs,
  patchJob,
  type JobRecord,
  type JobStatus,
} from './job-ledger';
import { patchJobAndNotify } from './job-notify';
import { getJobWorkerHandle, stopAndJoinJobWorkers } from './job-handles';
import {
  hasJobNativeResources,
  jobResourceErrors,
  runJobNativeOperation,
  settleJobNativeResources,
} from './job-native-resources';
import {
  findOwnershipHolder,
  listRunningOwnershipHolders,
  noteOwnershipDeferred,
} from './job-ownership';
import {
  CONDUCTOR_PROJECT_MODE_MAX_CONCURRENT,
  type ConductorProjectMode,
  resolveConductorProjectMode,
} from './job-project-mode';

const closedAdmissions = new WeakSet<ToolStore>();
const closedJobAdmissions = new WeakMap<ToolStore, Set<string>>();
const activeSchedules = new WeakMap<ToolStore, Set<Promise<ScheduleJobsResult>>>();
const schedulingFailures = new WeakMap<ToolStore, unknown[]>();

/** Close the session's execution boundary without changing durable queued work. */
export function closeJobAdmissions(store: ToolStore): void {
  closedAdmissions.add(store);
}

/** Reopen execution after session restoration; this does not request a schedule. */
export function openJobAdmissions(store: ToolStore): void {
  closedAdmissions.delete(store);
}

export function closeJobAdmission(store: ToolStore, jobId: string): void {
  let jobs = closedJobAdmissions.get(store);
  if (!jobs) { jobs = new Set(); closedJobAdmissions.set(store, jobs); }
  jobs.add(jobId);
}

export function openJobAdmission(store: ToolStore, jobId: string): void {
  closedJobAdmissions.get(store)?.delete(jobId);
}

export function areJobAdmissionsOpen(store: ToolStore, jobId?: string): boolean {
  return !closedAdmissions.has(store) && (jobId === undefined || closedJobAdmissions.get(store)?.has(jobId) !== true);
}

/** Join worktree preparation admitted before the session execution boundary closed. */
export async function waitForJobScheduling(store: ToolStore): Promise<void> {
  for (;;) {
    const schedules = activeSchedules.get(store);
    if (schedules === undefined || schedules.size === 0) break;
    await Promise.allSettled(schedules);
  }
  const errors = schedulingFailures.get(store) ?? [];
  schedulingFailures.delete(store);
  try { await settleJobNativeResources(store); } catch (error) { errors.push(error); }
  if (errors.length > 0) {
    try { await stopAndJoinJobWorkers(store, new Error('Job scheduling shutdown failed')); }
    catch (error) { errors.push(error); }
    throw jobResourceErrors(errors, 'Job scheduling failed during shutdown');
  }
}

/** Locked product defaults (Conductor plan). */
export const CONDUCTOR_DEFAULT_MAX_CONCURRENT_JOBS = 6;
/** Failed/cancelled/conflict worktrees retained this many days before GC. */
export const CONDUCTOR_WORKTREE_FAIL_TTL_DAYS = 7;

export interface ConductorPoolConfig {
  readonly maxConcurrentJobs: number;
  readonly failTtlDays: number;
}

export interface ResolveConductorPoolOptions {
  /** Session project-mode default; SUPERLIORA_CONDUCTOR_MAX_CONCURRENT still wins when set. */
  readonly projectMode?: ConductorProjectMode;
  /** When set (and projectMode omitted), read mode from the ToolStore session override. */
  readonly store?: ToolStore;
}

export function resolveConductorPoolConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
  options?: ResolveConductorPoolOptions,
): ConductorPoolConfig {
  const mode =
    options?.projectMode ??
    (options?.store !== undefined ? resolveConductorProjectMode(options.store) : undefined);
  const modeDefault =
    mode !== undefined
      ? CONDUCTOR_PROJECT_MODE_MAX_CONCURRENT[mode]
      : CONDUCTOR_DEFAULT_MAX_CONCURRENT_JOBS;
  return {
    maxConcurrentJobs: readPositiveInt(env['SUPERLIORA_CONDUCTOR_MAX_CONCURRENT'], modeDefault),
    failTtlDays: readPositiveInt(
      env['SUPERLIORA_CONDUCTOR_WORKTREE_TTL_DAYS'],
      CONDUCTOR_WORKTREE_FAIL_TTL_DAYS,
    ),
  };
}

function readPositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function countJobsWithStatus(
  store: ToolStore,
  statuses: readonly JobStatus[],
): number {
  const set = new Set(statuses);
  return listJobs(store).filter((j) => set.has(j.status)).length;
}


/** Running jobs that consume maxConcurrent capacity. */
export function countRunningPoolJobs(store: ToolStore): number {
  return listJobs(store).filter(
    (j) => j.status === 'running' || getJobWorkerHandle(j.id) !== undefined || hasJobNativeResources(store, j.id),
  ).length;
}

/**
 * Highest-priority queued Jobs ready to start, with parent-chain + ownership
 * gates. Ownership: stay `queued` when a running (or same-batch) Job already
 * claims an overlapping path — never promote into a spawn-time lease fail.
 * Batch selection is greedy so Promise.all sibling races cannot claim the
 * same path in one schedule tick.
 */
export function nextQueuedJobs(
  store: ToolStore,
  limit: number,
): JobRecord[] {
  if (!areJobAdmissionsOpen(store)) return [];
  const jobs = listJobs(store);
  const byId = new Map(jobs.map((job) => [job.id, job]));
  const sorted = [...jobs]
    .filter((j) => j.status === 'queued' && areJobAdmissionsOpen(store, j.id) &&
      getJobWorkerHandle(j.id) === undefined && !hasJobNativeResources(store, j.id))
    .filter((j) => parentAllowsSchedule(byId, j) &&
      (j.parentJobId === undefined || !hasJobNativeResources(store, j.parentJobId)))
    .filter((j) => blockersAllowSchedule(byId, j) &&
      !j.blockedByJobIds?.some((id) => hasJobNativeResources(store, id)))
    .toSorted((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt));

  const selected: JobRecord[] = [];
  const reserved: JobRecord[] = listRunningOwnershipHolders(store);
  const max = Math.max(0, limit);

  for (const job of sorted) {
    if (selected.length >= max) break;
    const conflict = findOwnershipHolder(reserved, job);
    if (conflict !== undefined) {
      noteOwnershipDeferred(store, job, conflict.holder.id, conflict.path);
      continue;
    }
    selected.push(job);
    if (job.ownershipPaths !== undefined && job.ownershipPaths.length > 0) {
      reserved.push(job);
    }
  }
  return selected;
}

/** Parent-linked jobs wait until the parent worker is no longer running. */
function parentAllowsSchedule(
  byId: ReadonlyMap<string, JobRecord>,
  job: JobRecord,
): boolean {
  if (job.parentJobId === undefined) return true;
  const parent = byId.get(job.parentJobId);
  if (parent === undefined) return true;
  return parent.status !== 'running' && parent.status !== 'queued' && getJobWorkerHandle(parent.id) === undefined;
}


/** Tracer-bullet DAG: every listed blocker must be `done` before this Job starts. */
function blockersAllowSchedule(
  byId: ReadonlyMap<string, JobRecord>,
  job: JobRecord,
): boolean {
  const blockers = job.blockedByJobIds;
  if (blockers === undefined || blockers.length === 0) return true;
  for (const id of blockers) {
    const blocker = byId.get(id);
    if (blocker === undefined) return false;
    if (blocker.status !== 'done' || getJobWorkerHandle(blocker.id) !== undefined) return false;
  }
  return true;
}

export type WorktreeFactory = (
  kaos: Kaos,
  input: { readonly repoPath: string; readonly name: string; readonly onWorktreePath?: (path: string) => void; readonly signal?: AbortSignal; readonly bootstrapRepo?: boolean },
) => Promise<CreateSessionWorktreeResult>;

export type AttachWorktreeFactory = (
  kaos: Kaos,
  input: { readonly repoPath: string; readonly path: string; readonly branch: string; readonly onWorktreePath?: (path: string) => void; readonly signal?: AbortSignal },
) => Promise<CreateSessionWorktreeResult>;

export interface AssignJobWorktreeInput {
  readonly store: ToolStore;
  readonly jobId: string;
  readonly kaos: Kaos;
  readonly repoPath: string;
  readonly createWorktree?: WorktreeFactory;
  readonly attachWorktree?: AttachWorktreeFactory;
  readonly worktreeDirExists?: (path: string) => Promise<boolean>;
  readonly log?: Logger;
  readonly signal?: AbortSignal;
  /** Env for the auto-git-init opt-out (default process.env). */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /**
   * Run the git-repo bootstrap before worktree creation (default true).
   * Unit tests injecting a fake worktree factory can skip it.
   */
  readonly ensureGitRepo?: boolean;
  /** When set, worktree_failed blocks wake the Conductor. */
  readonly agent?: Agent;
}

/**
 * Always-worktree isolation for execution Jobs (locked policy).
 * On failure: job stays queued/blocked with notes — never silent shared cwd.
 *
 * Non-git project roots are bootstrapped first (local `git init` + baseline
 * commit, opt-out via SUPERLIORA_AUTO_GIT_INIT=0) so Jobs can
 * progress in fresh directories instead of blocking forever.
 */
export function assignJobWorktree(
  input: AssignJobWorktreeInput,
): Promise<{ readonly job?: JobRecord; readonly error?: string }> {
  const job = getJob(input.store, input.jobId);
  return runJobNativeOperation(input.store, input.jobId, {
    paths: [job?.worktreePath],
    repoRoots: [job?.repoRoot ?? input.repoPath],
  }, (holdPath, signal) => performJobWorktreeAssignment({ ...input, signal }, holdPath))
    .catch((error: unknown) => {
      if (!areJobAdmissionsOpen(input.store, input.jobId) && !hasUnsettledExecutionResources(error)) {
        return { job: getJob(input.store, input.jobId), error: 'Job preparation stopped.' };
      }
      closeJobAdmission(input.store, input.jobId);
      patchJob(input.store, input.jobId, {
        status: 'blocked',
        resultSummary: error instanceof Error ? error.message : String(error),
        notes: [getJob(input.store, input.jobId)?.notes, `preparation_failed: ${error instanceof Error ? error.message : String(error)}`].filter(Boolean).join('\n'),
      });
      throw error;
    });
}

async function performJobWorktreeAssignment(
  input: AssignJobWorktreeInput,
  holdPath: (path: string) => void,
): Promise<{ readonly job?: JobRecord; readonly error?: string }> {
  const existing = getJob(input.store, input.jobId);
  if (existing === undefined) {
    return { error: `Job not found: ${input.jobId}` };
  }
  if (!areJobAdmissionsOpen(input.store, existing.id)) return { job: existing, error: 'Job runtime is closed.' };
  if (existing.worktreePath) {
    return ensureAssignedWorktreePresent(input, existing);
  }

  const inferredRoot = resolveRepoRootForNewJob({
    persistedRepoRoot: existing.repoRoot,
    ownershipPaths: existing.ownershipPaths,
    worktreePath: existing.worktreePath,
    sessionRepoPath: input.repoPath,
  });

  // Chain rule: a child job continues its parent's deliverable (e.g. a
  // defect-fix chained after review), so it must commit onto the parent's
  // landing branch. On a private branch the child's commits are never seen by
  // MergeJob (source = parent) — the "fix committed but landed nowhere"
  // failure mode. Reuse only while the parent holds an unmerged worktree;
  // once the parent landed (landReceipt set) or its worktree was GC'd, the
  // child falls through to its own worktree.
  // Scheduling already defers children while the parent is in-flight
  // (`nextQueuedJobs`); this path runs after the parent left the execution
  // lane (done/failed/…) but before land GC clears the worktree.
  if (existing.parentJobId !== undefined) {
    const parent = getJob(input.store, existing.parentJobId);
    if (parent?.worktreePath !== undefined && parent.landReceipt === undefined) {
      holdPath(parent.worktreePath);
      const job = patchJob(input.store, existing.id, {
        worktreePath: parent.worktreePath,
        worktreeBranch: parent.worktreeBranch,
        repoRoot: parent.repoRoot ?? existing.repoRoot ?? inferredRoot,
        notes: [
          existing.notes,
          `worktree: chained onto parent ${parent.id} branch (${parent.worktreePath})`,
        ]
          .filter(Boolean)
          .join('\n'),
      });
      if (job === undefined) return { error: `Job not found: ${existing.id}` };
      return ensureAssignedWorktreePresent(input, job);
    }
  }

  const repoPath = inferredRoot ?? input.repoPath;
  const repo =
    input.ensureGitRepo === false
      ? ({ ok: true, root: repoPath, bootstrapped: false, baselineCommit: false } as const)
      : await ensureGitRepoForWorktrees(input.kaos, repoPath, input.env, input.signal);
  if (!repo.ok) {
    input.log?.warn('Conductor job worktree git bootstrap failed', {
      jobId: existing.id,
      error: repo.error,
    });
    const job = patchJobAndNotify(
      input.store,
      existing.id,
      {
        status: 'blocked',
        notes: [
          existing.notes,
          `worktree_failed: ${repo.error}`,
          'hint: fix the git setup above, then JobResume this job.',
        ]
          .filter(Boolean)
          .join('\n'),
      },
      { agent: input.agent, summary: `worktree_failed: ${repo.error}` },
    );
    return { job, error: repo.error };
  }
  if (repo.bootstrapped) {
    input.log?.info('Conductor bootstrapped a local git repository for Job worktrees', {
      jobId: existing.id,
      repoRoot: repo.root,
      baselineCommit: repo.baselineCommit,
    });
  }

  const create = input.createWorktree ?? createSessionWorktree;
  const slug = worktreeNameForJob(existing.id);
  let preparedPath: string | undefined;
  try {
    const created = await create(input.kaos, {
      repoPath: repo.root,
      name: slug,
      onWorktreePath: (path) => { preparedPath = path; holdPath(path); },
      signal: input.signal,
      bootstrapRepo: false,
    });
    holdPath(created.workDir);
    const branch = created.meta?.branch;
    const portOffset = existing.portOffset ?? nextPortOffset(
      listJobs(input.store).map((j) => j.portOffset),
    );
    const setup = await setupJobWorktree({
      repoRoot: repo.root,
      worktreePath: created.workDir,
      portOffset,
    });
    const job = patchJob(input.store, existing.id, {
      worktreePath: created.workDir,
      repoRoot: existing.repoRoot ?? inferredRoot ?? created.meta.repoRoot,
      portOffset,
      ...(branch !== undefined ? { worktreeBranch: branch } : {}),
      notes: [
        existing.notes,
        repo.bootstrapped
          ? `git_bootstrap: initialized ${repo.root}${repo.baselineCommit ? ' + baseline commit' : ''} for worktree isolation`
          : '',
        branch !== undefined
          ? `worktree: ${created.workDir} (${branch})`
          : `worktree: ${created.workDir}`,
        ...setup.notes.map((line) => `worktree-setup: ${line}`),
      ]
        .filter(Boolean)
        .join('\n'),
    });
    return { job };
  } catch (error) {
    if (!areJobAdmissionsOpen(input.store, existing.id) && !hasUnsettledExecutionResources(error)) {
      return { job: getJob(input.store, existing.id), error: 'Job preparation stopped.' };
    }
    if (hasUnsettledExecutionResources(error)) {
      patchJob(input.store, existing.id, {
        ...(preparedPath ? { worktreePath: preparedPath, worktreeBranch: `liora/${slug}`, repoRoot: repo.root } : {}),
        resultSummary: error instanceof Error ? error.message : String(error),
        notes: [existing.notes, `worktree_native_cleanup_failed: ${error instanceof Error ? error.message : String(error)}`].filter(Boolean).join('\n'),
      });
      throw error;
    }
    const detail = error instanceof Error ? error.message : String(error);
    input.log?.warn('Conductor job worktree create failed', {
      jobId: existing.id,
      error: detail,
    });
    const job = patchJobAndNotify(
      input.store,
      existing.id,
      {
        status: 'blocked',
        notes: [existing.notes, `worktree_failed: ${detail}`].filter(Boolean).join('\n'),
      },
      { agent: input.agent, summary: `worktree_failed: ${detail}` },
    );
    return { job, error: detail };
  }
}

function worktreeNameForJob(jobId: string): string {
  // git worktree slug: keep short/safe
  const compact = jobId.replace(/^job_/, 'j').replaceAll(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
  return `conductor-${compact || 'job'}`;
}

/**
 * A ledger path is not enough: hygiene / land GC / a crash can delete the
 * directory while the Job still points at it. Remount the branch, or block
 * with an actionable note — never let spawn `chdir` into ENOENT (that used
 * to crash session resume).
 */
async function ensureAssignedWorktreePresent(
  input: AssignJobWorktreeInput,
  job: JobRecord,
): Promise<{ readonly job?: JobRecord; readonly error?: string }> {
  const path = job.worktreePath;
  if (path === undefined) return { job };

  const exists = input.worktreeDirExists ?? sessionWorktreeDirExists;
  if (await exists(path)) return { job };

  const branch = job.worktreeBranch?.trim();
  if (branch) {
    try {
      const attach = input.attachWorktree ?? defaultAttachWorktree;
      await attach(input.kaos, {
        repoPath: job.repoRoot ?? input.repoPath,
        path,
        branch,
        signal: input.signal,
      });
      const remounted = patchJob(input.store, job.id, {
        notes: [
          job.notes,
          `worktree: remounted ${path} (${branch}) after missing directory`,
        ]
          .filter(Boolean)
          .join('\n'),
      });
      input.log?.info('Conductor remounted missing job worktree', {
        jobId: job.id,
        path,
        branch,
      });
      return { job: remounted ?? job };
    } catch (error) {
      if (hasUnsettledExecutionResources(error)) throw error;
      if (!areJobAdmissionsOpen(input.store, job.id)) return { job, error: 'Job preparation stopped.' };
      const detail = error instanceof Error ? error.message : String(error);
      input.log?.warn('Conductor job worktree remount failed', {
        jobId: job.id,
        path,
        branch,
        error: detail,
      });
      return blockMissingWorktree(input, job, detail);
    }
  }

  return blockMissingWorktree(
    input,
    job,
    `worktree directory is gone and no worktreeBranch is recorded: ${path}`,
  );
}

function defaultAttachWorktree(
  kaos: Kaos,
  input: Parameters<AttachWorktreeFactory>[1],
): Promise<CreateSessionWorktreeResult> {
  return attachSessionWorktree(kaos, input);
}

function blockMissingWorktree(
  input: AssignJobWorktreeInput,
  job: JobRecord,
  detail: string,
): { readonly job?: JobRecord; readonly error?: string } {
  const jobUpdated = patchJobAndNotify(
    input.store,
    job.id,
    {
      status: 'blocked',
      notes: [
        job.notes,
        `worktree_missing: ${detail}`,
        'hint: remount the branch (git worktree add <path> <branch>) or JobCreate a fresh Job, then JobResume.',
      ]
        .filter(Boolean)
        .join('\n'),
    },
    { agent: input.agent, summary: `worktree_missing: ${detail}` },
  );
  return { job: jobUpdated, error: detail };
}

export interface ScheduleJobsInput {
  readonly store: ToolStore;
  readonly kaos?: Kaos;
  readonly repoPath?: string;
  readonly createWorktree?: WorktreeFactory;
  readonly maxConcurrent?: number;
  readonly log?: Logger;
  /**
   * When true (default), require kaos+repoPath and create worktrees.
   * Unit tests may set false to only flip queued→running without git.
   */
  readonly requireWorktree?: boolean;
  /** Forwarded to assignJobWorktree (default true; fake-factory tests opt out). */
  readonly ensureGitRepo?: boolean;
  /** Forwarded to assignJobWorktree (chain/reuse tests stub the directory check). */
  readonly worktreeDirExists?: (path: string) => Promise<boolean>;
  /** Env for the auto-git-init opt-out (default process.env). */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Optional: spawn real worker after job becomes running. */
  readonly launchWorker?: (job: JobRecord) => Promise<void>;
  /** When set, schedule/worktree/launch failures wake the Conductor. */
  readonly agent?: Agent;
}

export interface ScheduleJobsResult {
  readonly started: readonly JobRecord[];
  readonly deferred: number;
  readonly blocked: readonly JobRecord[];
  readonly backpressure: boolean;
  readonly message: string;
}


function needsWorktree(job: Pick<JobRecord, 'kind'>): boolean {
  return job.kind !== 'merge' && job.kind !== 'push';
}

/**
 * Promote highest-priority queued Jobs to running under maxConcurrent.
 * Always-worktree when kaos+repoPath provided (product default).
 */
export function scheduleQueuedJobs(input: ScheduleJobsInput): Promise<ScheduleJobsResult> {
  let schedules = activeSchedules.get(input.store);
  if (!schedules) {
    schedules = new Set();
    activeSchedules.set(input.store, schedules);
  }
  const operation = performJobSchedule(input);
  schedules.add(operation);
  void operation.then(() => schedules.delete(operation), (error: unknown) => {
    schedules.delete(operation);
    const failures = schedulingFailures.get(input.store) ?? [];
    failures.push(error);
    schedulingFailures.set(input.store, failures);
  });
  return operation;
}

async function performJobSchedule(input: ScheduleJobsInput): Promise<ScheduleJobsResult> {
  if (!areJobAdmissionsOpen(input.store)) {
    return {
      started: [], blocked: [], deferred: countJobsWithStatus(input.store, ['queued']),
      backpressure: false, message: 'Job runtime is closed; queued work is retained.',
    };
  }
  const max =
    input.maxConcurrent ?? resolveConductorPoolConfig().maxConcurrentJobs;
  const running = countRunningPoolJobs(input.store);
  const slots = Math.max(0, max - running);
  if (slots === 0) {
    const queued = countJobsWithStatus(input.store, ['queued']);
    return {
      started: [],
      deferred: queued,
      blocked: [],
      backpressure: queued > 0,
      message:
        queued > 0
          ? `Backpressure: ${running}/${max} pool slots in use; ${queued} queued.`
          : `Pool idle capacity full (${running}/${max} slots in use).`,
    };
  }

  const candidates = nextQueuedJobs(input.store, slots);
  const requireWt = input.requireWorktree !== false;

  // Promote candidates concurrently. Worktree creation and worker spawn
  // handshakes are independent per job; a serial chain would make the
  // JobCreate ACK pay their summed latency (A2 non-blocking contract).
  // Ledger patches stay synchronous read-modify-write, so interleaving is
  // safe, and result order follows candidate priority order.
  const outcomes = await Promise.allSettled(
    candidates.map(
      async (candidate): Promise<{ started?: JobRecord; blocked?: JobRecord }> => {
        let job = candidate;
        if (requireWt && needsWorktree(job)) {
          const assignRepo = job.repoRoot ?? input.repoPath;
          if (input.kaos === undefined || assignRepo === undefined) {
            const b = patchJobAndNotify(
              input.store,
              candidate.id,
              {
                status: 'blocked',
                notes: [candidate.notes, 'worktree_required: missing kaos/repoPath']
                  .filter(Boolean)
                  .join('\n'),
              },
              {
                agent: input.agent,
                summary: 'worktree_required: missing kaos/repoPath',
              },
            );
            return b ? { blocked: b } : {};
          }
          const assigned = await assignJobWorktree({
            store: input.store,
            jobId: candidate.id,
            kaos: input.kaos,
            repoPath: assignRepo,
            createWorktree: input.createWorktree,
            worktreeDirExists: input.worktreeDirExists,
            log: input.log,
            ensureGitRepo: input.ensureGitRepo,
            env: input.env,
            agent: input.agent,
          });
          if (assigned.error || assigned.job === undefined) {
            return assigned.job ? { blocked: assigned.job } : {};
          }
          job = assigned.job;
        }
        const latest = getJob(input.store, job.id);
        if (!areJobAdmissionsOpen(input.store, job.id) || latest?.status !== 'queued') return {};
        job = latest;

        const runningJob = patchJob(input.store, job.id, {
          status: 'running',
          notes: [job.notes, 'schedule: running'].filter(Boolean).join('\n'),
        });
        if (!runningJob) return {};
        if (!input.launchWorker) return { started: runningJob };
        try {
          await input.launchWorker(runningJob);
          const after = getJob(input.store, runningJob.id) ?? runningJob;
          return { started: after };
        } catch (error) {
          if (hasUnsettledExecutionResources(error)) throw error;
          const detail = error instanceof Error ? error.message : String(error);
          input.log?.warn('Conductor launchWorker failed', {
            jobId: runningJob.id,
            error: detail,
          });
          const failed = patchJobAndNotify(
            input.store,
            runningJob.id,
            {
              status: 'failed',
              notes: [runningJob.notes, `launch_failed: ${detail}`].filter(Boolean).join('\n'),
            },
            { agent: input.agent, summary: `launch_failed: ${detail}` },
          );
          return failed ? { blocked: failed } : {};
        }
      },
    ),
  );

  const started: JobRecord[] = [];
  const blocked: JobRecord[] = [];
  const errors: unknown[] = [];
  for (const outcome of outcomes) {
    if (outcome.status === 'rejected') {
      errors.push(outcome.reason);
      continue;
    }
    if (outcome.value.started) started.push(outcome.value.started);
    if (outcome.value.blocked) blocked.push(outcome.value.blocked);
  }
  if (errors.length > 0) {
    try { await stopAndJoinJobWorkers(input.store, new Error('Job scheduling failed')); }
    catch (error) { errors.push(error); }
    throw jobResourceErrors(errors, 'Job scheduling failed');
  }

  const stillQueued = countJobsWithStatus(input.store, ['queued']);
  const nowRunning = countRunningPoolJobs(input.store);
  return {
    started,
    deferred: stillQueued,
    blocked,
    backpressure: stillQueued > 0 && nowRunning >= max,
    message:
      started.length > 0
        ? `Started ${started.length} job(s); running ${nowRunning}/${max}; queued ${stillQueued}.`
        : stillQueued > 0
          ? `No jobs started; queued ${stillQueued}; running ${nowRunning}/${max}.`
          : `Nothing to schedule; running ${nowRunning}/${max}.`,
  };
}

export interface GcJobWorktreesInput {
  readonly kaos: Kaos;
  readonly store: ToolStore;
  readonly failTtlDays?: number;
  readonly dryRun?: boolean;
}

/**
 * GC policy: successful/done jobs may drop worktrees immediately when path set;
 * failed/cancelled/interrupted retain until TTL via session worktree GC.
 */
export async function gcConductorJobWorktrees(
  input: GcJobWorktreesInput,
): Promise<{ readonly removedJobIds: readonly string[]; readonly gc: { readonly removed: number; readonly kept: number } }> {
  const removedJobIds: string[] = [];
  const jobs = listJobs(input.store);
  for (const job of jobs) {
    if (job.status !== 'done' || !job.worktreePath || getJobWorkerHandle(job.id) !== undefined ||
        hasJobNativeResources(input.store, job.id) ||
        isSessionWorktreeOwned(job.worktreePath, job.repoRoot ?? '')) continue;
    if (
      job.landChoice === 'keep' ||
      job.landChoice === 'pending' ||
      job.sessionNamePinned === true
    ) {
      continue;
    }
    if (input.dryRun) {
      removedJobIds.push(job.id);
      continue;
    }
    try {
      await runJobNativeOperation(input.store, job.id, {}, (holdPath, signal) =>
        removeSessionWorktree(input.kaos, { nameOrPath: job.worktreePath!, onWorktreePath: holdPath, signal }));
      patchJob(input.store, job.id, {
        worktreePath: undefined,
        notes: [job.notes, 'worktree: removed after success'].filter(Boolean).join('\n'),
      });
      removedJobIds.push(job.id);
    } catch (error) {
      if (hasUnsettledExecutionResources(error)) throw error;
      // Leave the path discoverable after an ordinary filesystem failure.
    }
  }

  const ttl = input.failTtlDays ?? resolveConductorPoolConfig().failTtlDays;
  const result = await runJobNativeOperation(input.store, 'worktree-gc', {}, (holdPath, signal) =>
    gcSessionWorktrees(input.kaos, {
      maxAgeDays: ttl, dryRun: input.dryRun, onWorktreePath: holdPath, signal,
    }));
  return {
    removedJobIds,
    gc: { removed: result.removed.length, kept: result.kept },
  };
}


/** Compact counts for TUI Job strip / footer badge. */
export interface ConductorJobStripSnapshot {
  readonly total: number;
  readonly queued: number;
  readonly running: number;
  readonly blocked: number;
  readonly needsUser: number;
  readonly interrupted: number;
  readonly done: number;
  readonly failed: number;
  readonly cancelled: number;
}

export function summarizeJobStrip(store: ToolStore): ConductorJobStripSnapshot {
  const jobs = listJobs(store);
  const count = (status: JobStatus): number => jobs.filter((j) => j.status === status).length;
  return {
    total: jobs.length,
    queued: count('queued'),
    running: count('running'),
    blocked: count('blocked'),
    needsUser: count('needs_user'),
    interrupted: count('interrupted'),
    done: count('done'),
    failed: count('failed'),
    cancelled: count('cancelled'),
  };
}

export function formatJobStripLine(snapshot: ConductorJobStripSnapshot, unreadInbox = 0): string {
  if (snapshot.total === 0 && unreadInbox === 0) return 'Jobs: idle';
  const parts: string[] = [];
  if (snapshot.running > 0) parts.push(`${snapshot.running}▸`);
  if (snapshot.queued > 0) parts.push(`${snapshot.queued}…`);
  if (snapshot.blocked > 0) parts.push(`${snapshot.blocked}⛔`);
  if (snapshot.needsUser > 0) parts.push(`${snapshot.needsUser}?`);
  if (snapshot.interrupted > 0) parts.push(`${snapshot.interrupted}⏸`);
  if (snapshot.failed > 0) parts.push(`${snapshot.failed}✗`);
  if (unreadInbox > 0) parts.push(`inbox ${unreadInbox}`);
  if (parts.length === 0) {
    return `Jobs: ${snapshot.total} tracked`;
  }
  return `Jobs: ${parts.join(' ')}`;
}

