/**
 * Conductor Job runtime (P1) — concurrency cap, always-worktree isolation, schedule.
 * Full async worker loops land incrementally; this module owns ledger transitions
 * and worktree lifecycle hooks that later slices attach subagent handles to.
 */

import type { Kaos } from '@superliora/kaos';

import type { Agent } from '../../../agent/index';
import type { Logger } from '../../../logging/types';
import {
  createSessionWorktree,
  gcSessionWorktrees,
  removeSessionWorktree,
  type CreateSessionWorktreeResult,
} from '../../../session/worktree';
import type { ToolStore } from '../../store';
import { ensureGitRepoForWorktrees } from './job-git-bootstrap';
import { isExecutionInFlight } from './job-lanes';
import {
  getJob,
  listJobs,
  patchJob,
  type JobKind,
  type JobRecord,
  type JobStatus,
} from './job-ledger';
import { patchJobAndNotify } from './job-notify';
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

export function countJobsWithStatus(
  store: ToolStore,
  statuses: readonly JobStatus[],
): number {
  const set = new Set(statuses);
  return listJobs(store).filter((j) => set.has(j.status)).length;
}

export function canStartMoreJobs(
  store: ToolStore,
  maxConcurrent: number = resolveConductorPoolConfig().maxConcurrentJobs,
): boolean {
  return countJobsWithStatus(store, ['running']) < maxConcurrent;
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
  const jobs = listJobs(store);
  const byId = new Map(jobs.map((job) => [job.id, job]));
  const sorted = [...jobs]
    .filter((j) => j.status === 'queued')
    .filter((j) => parentAllowsSchedule(byId, j))
    .filter((j) => blockersAllowSchedule(byId, j))
    .sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt));

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

/**
 * Chain rule: keep parent→child sequential. Greenfield / review children are
 * enqueued while the parent is still live; starting them early races file
 * leases and shared worktrees.
 */
function parentAllowsSchedule(
  byId: ReadonlyMap<string, JobRecord>,
  job: JobRecord,
): boolean {
  if (job.parentJobId === undefined) return true;
  const parent = byId.get(job.parentJobId);
  if (parent === undefined) return true;
  return !isExecutionInFlight(parent.status);
}

/** Tracer-bullet DAG: every listed blocker must be `done` before this Job starts. */
export function blockersAllowSchedule(
  byId: ReadonlyMap<string, JobRecord>,
  job: JobRecord,
): boolean {
  const blockers = job.blockedByJobIds;
  if (blockers === undefined || blockers.length === 0) return true;
  for (const id of blockers) {
    const blocker = byId.get(id);
    if (blocker === undefined) return false;
    if (blocker.status !== 'done') return false;
  }
  return true;
}

export type WorktreeFactory = (
  kaos: Kaos,
  input: { readonly repoPath: string; readonly name: string },
) => Promise<CreateSessionWorktreeResult>;

export interface AssignJobWorktreeInput {
  readonly store: ToolStore;
  readonly jobId: string;
  readonly kaos: Kaos;
  readonly repoPath: string;
  readonly createWorktree?: WorktreeFactory;
  readonly log?: Logger;
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
 * commit, opt-out via SUPERLIORA_CONDUCTOR_AUTO_GIT_INIT=0) so Jobs can
 * progress in fresh directories instead of blocking forever.
 */
export async function assignJobWorktree(
  input: AssignJobWorktreeInput,
): Promise<{ readonly job?: JobRecord; readonly error?: string }> {
  const existing = getJob(input.store, input.jobId);
  if (existing === undefined) {
    return { error: `Job not found: ${input.jobId}` };
  }
  if (existing.worktreePath) {
    return { job: existing };
  }

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
      const job = patchJob(input.store, existing.id, {
        worktreePath: parent.worktreePath,
        worktreeBranch: parent.worktreeBranch,
        notes: [
          existing.notes,
          `worktree: chained onto parent ${parent.id} branch (${parent.worktreePath})`,
        ]
          .filter(Boolean)
          .join('\n'),
      });
      return { job };
    }
  }

  const repo =
    input.ensureGitRepo === false
      ? ({ ok: true, root: input.repoPath, bootstrapped: false, baselineCommit: false } as const)
      : await ensureGitRepoForWorktrees(input.kaos, input.repoPath, input.env);
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
  try {
    const created = await create(input.kaos, {
      repoPath: repo.root,
      name: slug,
    });
    const branch = created.meta?.branch;
    const job = patchJob(input.store, existing.id, {
      worktreePath: created.workDir,
      ...(branch !== undefined ? { worktreeBranch: branch } : {}),
      notes: [
        existing.notes,
        repo.bootstrapped
          ? `git_bootstrap: initialized ${repo.root}${repo.baselineCommit ? ' + baseline commit' : ''} for worktree isolation`
          : '',
        branch !== undefined
          ? `worktree: ${created.workDir} (${branch})`
          : `worktree: ${created.workDir}`,
      ]
        .filter(Boolean)
        .join('\n'),
    });
    return { job };
  } catch (error) {
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

export function worktreeNameForJob(jobId: string): string {
  // git worktree slug: keep short/safe
  const compact = jobId.replace(/^job_/, 'j').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
  return `conductor-${compact || 'job'}`;
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

/**
 * The `explore` profile has no write tools, so a worktree buys isolation
 * nothing can use while costing a `git worktree add` plus registry I/O per
 * job. Running in the main checkout is also more accurate: the worker then
 * sees uncommitted work, which is usually what the question is about. Keyed on
 * the profile, not the kind, so `desk` digests come along for free and a new
 * read-only kind cannot forget to opt in.
 */
function needsWorktree(kind: JobKind): boolean {
  // merge/push: bookkeeping only — land/push use the source job's worktree.
  if (kind === 'merge' || kind === 'push') return false;
  const profile = profileForJobKind(kind);
  // explore/research (+ desk via explore profile) + goal-desk: read-only /
  // orchestration — no worktree. verify keeps a worktree (usually parent chain).
  return profile !== 'explore' && profile !== 'goal-desk';
}

/**
 * Promote highest-priority queued Jobs to running under maxConcurrent.
 * Always-worktree when kaos+repoPath provided (product default).
 */
export async function scheduleQueuedJobs(input: ScheduleJobsInput): Promise<ScheduleJobsResult> {
  const max =
    input.maxConcurrent ?? resolveConductorPoolConfig().maxConcurrentJobs;
  const running = countJobsWithStatus(input.store, ['running']);
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
          ? `Backpressure: ${running}/${max} jobs running; ${queued} queued.`
          : `Pool idle capacity full (${running}/${max} running).`,
    };
  }

  const candidates = nextQueuedJobs(input.store, slots);
  const requireWt = input.requireWorktree !== false;

  // Promote candidates concurrently. Worktree creation and worker spawn
  // handshakes are independent per job; a serial chain would make the
  // JobCreate ACK pay their summed latency (A2 non-blocking contract).
  // Ledger patches stay synchronous read-modify-write, so interleaving is
  // safe, and result order follows candidate priority order.
  const outcomes = await Promise.all(
    candidates.map(
      async (candidate): Promise<{ started?: JobRecord; blocked?: JobRecord }> => {
        let job = candidate;
        if (requireWt && needsWorktree(candidate.kind)) {
          if (input.kaos === undefined || input.repoPath === undefined) {
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
            repoPath: input.repoPath,
            createWorktree: input.createWorktree,
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
  for (const outcome of outcomes) {
    if (outcome.started) started.push(outcome.started);
    if (outcome.blocked) blocked.push(outcome.blocked);
  }

  const stillQueued = countJobsWithStatus(input.store, ['queued']);
  const nowRunning = countJobsWithStatus(input.store, ['running']);
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
    if (job.status !== 'done' || !job.worktreePath) continue;
    if (input.dryRun) {
      removedJobIds.push(job.id);
      continue;
    }
    try {
      await removeSessionWorktree(input.kaos, { nameOrPath: job.worktreePath });
      patchJob(input.store, job.id, {
        worktreePath: undefined,
        notes: [job.notes, 'worktree: removed after success'].filter(Boolean).join('\n'),
      });
      removedJobIds.push(job.id);
    } catch {
      // leave path for next GC
    }
  }

  const ttl = input.failTtlDays ?? resolveConductorPoolConfig().failTtlDays;
  const result = await gcSessionWorktrees(input.kaos, {
    maxAgeDays: ttl,
    dryRun: input.dryRun,
  });
  return {
    removedJobIds,
    gc: { removed: result.removed.length, kept: result.kept },
  };
}

export function profileForJobKind(kind: JobKind): string {
  switch (kind) {
    case 'explore':
    case 'research':
      // research reuses the explore waist (web/docs tools, no worktree).
      return 'explore';
    case 'verify':
      return 'verify';
    case 'mission':
      return 'plan';
    case 'desk':
      // Contract §4.2: low-cost digest worker. `explore` keeps it on the
      // cheap model slot; digest work is read-only summarization.
      return 'explore';
    case 'goal-desk':
      // Goal Desk orchestrator — Job* + AskUserQuestion, no product writes.
      return 'goal-desk';
    case 'goal-driver':
      // Spec 2026-08-04-goal-driver-jobs: coder waist plus goal lifecycle
      // tools so the driver can report complete/blocked on its migrated goal.
      return 'goal-driver';
    case 'implement':
    case 'task':
    case 'merge':
    case 'push':
    default:
      return 'coder';
  }
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

