/**
 * Land a finished Job worktree branch onto the main workspace checkout.
 * Does not push remotes (main/user gated). Success may GC the job worktree.
 */

import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve as resolvePath } from 'node:path';

import type { Kaos } from '@superliora/kaos';

import { runGit as kaosRunGit } from '#/autopilot/git';

import type { Agent } from '../../../agent/index';
import { removeSessionWorktree } from '../../../session/worktree';
import type { ToolStore } from '../../store';
import type { JobRecord, JobStatus } from './job-ledger';
import { createJob, getJob, patchJob } from './job-ledger';
import { patchJobAndNotify } from './job-notify';
import { gcConductorJobWorktrees } from './job-runtime';
import { resolveMergePushCwd } from './job-git-root';
import { commitJobWorktreeIfDirty } from './job-worktree-commit';

export interface LandJobToMainInput {
  readonly store: ToolStore;
  readonly job: JobRecord;
  readonly kaos?: Kaos;
  readonly repoPath?: string;
  /** When true, remove worktree after successful merge (locked GC policy). */
  readonly gcOnSuccess?: boolean;
  /** When set, exceptional source-job status patches wake the Conductor. */
  readonly agent?: Agent;
  /** Injectable git runner for tests. */
  readonly runGit?: (
    cwd: string,
    args: readonly string[],
  ) => Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }>;
  /** Injectable delay for index.lock retries (tests inject a no-op). */
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface LandJobToMainResult {
  readonly ok: boolean;
  readonly job: JobRecord;
  readonly merged: boolean;
  readonly gcRemoved: boolean;
  readonly message: string;
  readonly error?: string;
}

/**
 * Ledger-only approval (no worktree): nothing was merged, so the message must
 * never read as "landed". Kept as a const so summaries cannot drift.
 */
export const LAND_LEDGER_ONLY_MESSAGE =
  'Nothing merged (no worktree on job); approval recorded on ledger only.';

/** Initial attempt + retries when git reports `.git/index.lock` contention. */
export const LAND_INDEX_LOCK_MAX_ATTEMPTS = 4;

/** Backoff between index.lock retries (ms). Bounded — never wait forever. */
export const LAND_INDEX_LOCK_BACKOFF_MS = [50, 100, 200] as const;

const REPO_PATH_REQUIRED = 'repoPath required to land worktree';

async function defaultRunGit(
  kaos: Kaos | undefined,
  cwd: string,
  args: readonly string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  if (kaos === undefined) {
    return { code: 1, stdout: '', stderr: 'kaos unavailable for git land' };
  }
  // Same kaos.exec path as worktree snapshot / git-bootstrap — Kaos has no shell.run.
  const res = await kaosRunGit(kaos, cwd, args);
  return {
    code: res.ok ? 0 : (res.exitCode ?? 1),
    stdout: res.stdout,
    stderr: res.stderr,
  };
}

export interface ResolveJobWorktreeMergeRefResult {
  readonly ref?: string;
  readonly error?: string;
}

function gitDetail(res: { readonly stdout: string; readonly stderr: string }): string {
  return (res.stderr || res.stdout || '').trim().slice(0, 500);
}

/** True when git failed because another process holds `.git/index.lock`. */
export function isGitIndexLockError(detail: string): boolean {
  if (!/index\.lock/i.test(detail)) return false;
  return (
    /File exists/i.test(detail) ||
    /Unable to create/i.test(detail) ||
    /could not lock/i.test(detail) ||
    /Another git process/i.test(detail)
  );
}

/**
 * Hint appended after bounded index.lock retries fail. Operators must not
 * delete the lock while another land/merge is live.
 */
export function indexLockStaleHint(repoPath: string): string {
  return (
    `stale lock?: if no other git process is running, remove ` +
    `${repoPath.replace(/[/\\]+$/, '')}/.git/index.lock and retry the land`
  );
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run `git` with a short bounded backoff when `.git/index.lock` contention is
 * the only failure mode (parallel lands). Never spins forever.
 */
export async function runGitWithIndexLockRetry(
  cwd: string,
  args: readonly string[],
  runGit: NonNullable<LandJobToMainInput['runGit']>,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<{ code: number; stdout: string; stderr: string; attempts: number }> {
  let last = await runGit(cwd, args);
  let attempts = 1;
  while (last.code !== 0 && attempts < LAND_INDEX_LOCK_MAX_ATTEMPTS) {
    const detail = gitDetail(last);
    if (!isGitIndexLockError(detail)) break;
    const backoff = LAND_INDEX_LOCK_BACKOFF_MS[attempts - 1] ?? 200;
    await sleep(backoff);
    last = await runGit(cwd, args);
    attempts += 1;
  }
  return { ...last, attempts };
}

/** First `worktree <path>` entry from `git worktree list --porcelain` is main. */
export function parseMainWorktreePathFromPorcelain(porcelain: string): string | undefined {
  for (const line of porcelain.split(/\r?\n/)) {
    if (!line.startsWith('worktree ')) continue;
    const path = line.slice('worktree '.length).trim();
    if (path.length > 0) return path;
  }
  return undefined;
}

/**
 * Map `git rev-parse --git-common-dir` output to the main checkout root.
 * Linked worktrees report the shared `.git` directory, not their own path.
 */
export function repoRootFromGitCommonDir(
  commonDirRaw: string,
  worktreePath: string,
): string | undefined {
  const trimmed = commonDirRaw.trim();
  if (!trimmed) return undefined;
  const abs = isAbsolute(trimmed) ? trimmed : resolvePath(worktreePath, trimmed);
  const normalized = abs.replace(/[/\\]+$/, '');
  if (/(^|[/\\])\.git$/i.test(normalized)) {
    return dirname(normalized);
  }
  return undefined;
}

export interface ResolveLandRepoPathInput {
  readonly repoPath?: string;
  readonly worktreePath?: string;
  readonly agent?: Agent;
  readonly runGit: NonNullable<LandJobToMainInput['runGit']>;
}

/**
 * Prefer explicit repoPath → agent session cwd → live worktree common-dir /
 * worktree list. Auto-land after verify often omits repoPath (job_msvca2y6sosz8k).
 */
export async function resolveLandRepoPath(
  input: ResolveLandRepoPathInput,
): Promise<{ readonly repoPath?: string; readonly error?: string }> {
  const explicit = input.repoPath?.trim();
  if (explicit) return { repoPath: explicit };

  const fromAgent = input.agent?.config?.cwd?.trim();
  if (fromAgent) return { repoPath: fromAgent };

  const worktreePath = input.worktreePath?.trim();
  if (!worktreePath || !existsSync(worktreePath)) {
    return { error: REPO_PATH_REQUIRED };
  }

  const common = await input.runGit(worktreePath, ['rev-parse', '--git-common-dir']);
  if (common.code === 0) {
    const root = repoRootFromGitCommonDir(common.stdout, worktreePath);
    if (root) return { repoPath: root };
  }

  const list = await input.runGit(worktreePath, ['worktree', 'list', '--porcelain']);
  if (list.code === 0) {
    const main = parseMainWorktreePathFromPorcelain(list.stdout);
    if (main) return { repoPath: main };
  }

  return { error: REPO_PATH_REQUIRED };
}

/**
 * Resolve a merge ref for a job worktree:
 * ledger `worktreeBranch` → `abbrev-ref HEAD` → detached `rev-parse HEAD` SHA.
 * Failures keep git stderr so land notes are diagnosable.
 */
export async function resolveJobWorktreeMergeRef(
  worktreePath: string,
  runGit: NonNullable<LandJobToMainInput['runGit']>,
  ledgerBranch?: string,
): Promise<ResolveJobWorktreeMergeRefResult> {
  const fromLedger = ledgerBranch?.trim();
  if (fromLedger) return { ref: fromLedger };

  const abbrev = await runGit(worktreePath, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (abbrev.code === 0) {
    const branch = abbrev.stdout.trim();
    if (branch && branch !== 'HEAD') return { ref: branch };
  }

  const sha = await runGit(worktreePath, ['rev-parse', 'HEAD']);
  if (sha.code === 0) {
    const tip = sha.stdout.trim();
    if (tip && /^[0-9a-f]{7,40}$/i.test(tip)) return { ref: tip };
  }

  const detail =
    [gitDetail(abbrev), gitDetail(sha)].filter(Boolean).join(' | ') || 'unknown git error';
  return { error: `Could not resolve branch in job worktree: ${detail}` };
}

/** Thin wrapper: named branch only (no ledger / detached SHA fallback). */
export async function resolveJobWorktreeBranch(
  worktreePath: string,
  runGit: NonNullable<LandJobToMainInput['runGit']>,
): Promise<string | undefined> {
  const abbrev = await runGit(worktreePath, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (abbrev.code !== 0) return undefined;
  const branch = abbrev.stdout.trim();
  if (!branch || branch === 'HEAD') return undefined;
  return branch;
}

/**
 * Land job branch into main workspace with `git merge --no-ff` (or fast-forward when clean).
 * On success and gcOnSuccess, remove the job worktree via removeSessionWorktree.
 */
export async function landJobToMain(input: LandJobToMainInput): Promise<LandJobToMainResult> {
  const { store, job } = input;
  const worktreePath = job.worktreePath;

  if (!worktreePath) {
    const next = patchJobAndNotify(
      store,
      job.id,
      {
        status: 'done',
        notes: [job.notes, 'land: no worktree — ledger-only approve (nothing merged)']
          .filter(Boolean)
          .join('\n'),
      },
      { agent: input.agent, summary: LAND_LEDGER_ONLY_MESSAGE },
    );
    return {
      ok: true,
      job: next ?? job,
      merged: false,
      gcRemoved: false,
      message: LAND_LEDGER_ONLY_MESSAGE,
    };
  }

  const runGit =
    input.runGit ??
    ((cwd: string, args: readonly string[]) => defaultRunGit(input.kaos, cwd, args));
  const sleep = input.sleep ?? defaultSleep;

  // Ownership git root wins over session isolation (metalslug bootstrap).
  // Cross-product land is held — never merge harness branches into metalslug
  // or GC product worktrees on the wrong repo (f53f897 wrong land).
  const ownershipCwd = resolveMergePushCwd({
    ownershipPaths: job.ownershipPaths,
    worktreePath,
    sessionRepoPath: input.repoPath ?? input.agent?.config?.cwd,
    mode: 'land',
  });
  if (ownershipCwd.hold?.hold === true) {
    const detail = ownershipCwd.hold.reason ?? 'cross_ownership_hold';
    const next = patchJobAndNotify(
      store,
      job.id,
      {
        status: 'blocked',
        notes: [job.notes, `land: ${detail}`].filter(Boolean).join('\n'),
      },
      { agent: input.agent, summary: detail },
    );
    return {
      ok: false,
      job: next ?? job,
      merged: false,
      gcRemoved: false,
      message: '',
      error: detail,
    };
  }

  const resolvedRepo = await resolveLandRepoPath({
    // Prefer ownership product root over session isolation cwd.
    repoPath: ownershipCwd.fromOwnership
      ? ownershipCwd.cwd
      : (input.repoPath ?? ownershipCwd.cwd),
    worktreePath,
    agent: input.agent,
    runGit,
  });
  const repoPath = resolvedRepo.repoPath;
  if (!repoPath) {
    return {
      ok: false,
      job,
      merged: false,
      gcRemoved: false,
      message: '',
      error: resolvedRepo.error ?? REPO_PATH_REQUIRED,
    };
  }

  // Second hold: resolved main checkout still foreign to ownership claim.
  const resolvedHold = resolveMergePushCwd({
    ownershipPaths: job.ownershipPaths,
    worktreePath,
    sessionRepoPath: repoPath,
    mode: 'land',
  });
  if (resolvedHold.hold?.hold === true) {
    const detail = resolvedHold.hold.reason ?? 'cross_ownership_hold';
    const next = patchJobAndNotify(
      store,
      job.id,
      {
        status: 'blocked',
        notes: [job.notes, `land: ${detail}`].filter(Boolean).join('\n'),
      },
      { agent: input.agent, summary: detail },
    );
    return {
      ok: false,
      job: next ?? job,
      merged: false,
      gcRemoved: false,
      message: '',
      error: detail,
    };
  }

  // Sibling land may GC this worktree before we run (job_msvbu1dy11yrvn). When the
  // directory is gone, land from ledger worktreeBranch on the main checkout —
  // never chdir into a dead path for snapshot/status.
  const worktreeExists = existsSync(worktreePath);

  let branch: string;
  if (job.worktreeBranch?.trim() && !worktreeExists) {
    // Prefer ledger branch without probing the missing directory.
    branch = job.worktreeBranch.trim();
  } else {
    const resolved = await resolveJobWorktreeMergeRef(worktreePath, runGit, job.worktreeBranch);
    if (resolved.ref === undefined) {
      const detail = !worktreeExists
        ? `worktree directory missing and could not resolve merge ref: ${resolved.error ?? 'unknown'}`
        : (resolved.error ?? 'Could not resolve branch in job worktree');
      const next = patchJobAndNotify(
        store,
        job.id,
        {
          status: 'blocked',
          notes: [job.notes, `land: ${detail}`].filter(Boolean).join('\n'),
        },
        { agent: input.agent, summary: detail },
      );
      return {
        ok: false,
        job: next ?? job,
        merged: false,
        gcRemoved: false,
        message: '',
        error: detail,
      };
    }
    branch = resolved.ref;
  }

  // Commit backstop: the merge below only sees the branch, so a dirty tree
  // (worker never committed) would be silently excluded from the merge and
  // destroyed by worktree GC. Snapshot first; if the snapshot itself fails,
  // hold the land instead of discarding work. Skip when the dir is already GC'd.
  let snapshotNote: string | undefined;
  if (worktreeExists) {
    const snapshot = await commitJobWorktreeIfDirty({
      worktreePath,
      jobId: job.id,
      jobTitle: job.title,
      run: async (cwd, args) => {
        const r = await runGit(cwd, args);
        return { ok: r.code === 0, stdout: r.stdout, stderr: r.stderr };
      },
    });
    if (snapshot.error !== undefined) {
      const err = `worktree has uncommitted changes and snapshot failed: ${snapshot.error}`;
      const next = patchJobAndNotify(
        store,
        job.id,
        {
          status: 'blocked',
          notes: [job.notes, `land: worktree dirty and snapshot failed — ${snapshot.error}`]
            .filter(Boolean)
            .join('\n'),
        },
        { agent: input.agent, summary: err },
      );
      return {
        ok: false,
        job: next ?? job,
        merged: false,
        gcRemoved: false,
        message: '',
        error: err,
      };
    }
    snapshotNote = snapshot.committed
      ? 'land: snapshotted uncommitted worker changes onto the branch before merge'
      : undefined;
  } else {
    snapshotNote = "land: worktree dir already GC'd — merging ledger branch from main checkout";
  }

  // Ensure main workspace is clean enough for merge (non-fatal warn path via stderr).
  // Parallel lands can contend on .git/index.lock (job_msvbrs5og77dfy) — bounded retry.
  const merge = await runGitWithIndexLockRetry(
    repoPath,
    ['merge', '--no-edit', branch],
    runGit,
    sleep,
  );
  if (merge.code !== 0) {
    const detail = (merge.stderr || merge.stdout || 'merge failed').slice(0, 500);
    const lockContention = isGitIndexLockError(detail);
    const err = lockContention
      ? `git merge failed after ${String(merge.attempts)} attempts (index.lock): ${detail}. ${indexLockStaleHint(repoPath)}`
      : `git merge failed: ${detail}`;
    const conflict =
      !lockContention &&
      (/\bCONFLICT\b/i.test(detail) ||
        /\bmerge conflict\b/i.test(detail) ||
        /\bAutomatic merge failed\b/i.test(detail));
    let resolveNote: string | undefined;
    if (conflict) {
      const resolveJob = createJob(store, {
        title: `Resolve merge conflicts: ${job.title}`.slice(0, 120),
        kind: 'implement',
        priority: (job.priority ?? 0) + 3,
        prompt: [
          'Merge into main hit conflicts. Resolve intent-traced hunks; never git merge --abort.',
          'Skill("resolving-merge-conflicts") for the hunk-by-hunk playbook.',
          `Source job: ${job.id}`,
          `Branch: ${branch}`,
          `Conflict detail:\n${detail}`,
          'After resolving: stage, commit the merge, leave main green. Do not push.',
        ].join('\n\n'),
        ownershipPaths: job.ownershipPaths,
        contextPaths: job.contextPaths,
        parentJobId: job.id,
        successCriteria: [
          'Merge conflicts resolved with intent traced to each side',
          'Working tree clean on main with merge committed locally',
        ],
        tddMode: 'off',
      });
      resolveNote = `land: conflict — enqueued resolve Job ${resolveJob.id}`;
    }
    const next = patchJobAndNotify(
      store,
      job.id,
      {
        status: 'blocked',
        notes: [
          job.notes,
          snapshotNote,
          lockContention
            ? `land: merge failed (index.lock after ${String(merge.attempts)} attempts) — ${detail}`
            : `land: merge failed — ${detail}`,
          resolveNote,
        ]
          .filter(Boolean)
          .join('\n'),
      },
      { agent: input.agent, summary: err },
    );
    return {
      ok: false,
      job: next ?? job,
      merged: false,
      gcRemoved: false,
      message: '',
      error: err,
    };
  }

  // Post-merge receipt: prove main actually contains the branch now. A merge
  // exit code of 0 alone is not evidence — "Already up to date" against the
  // wrong checkout leaves no trace, and a text claim of "landed" without this
  // check is exactly the false-completion shape the ledger must not record.
  const head = await runGit(repoPath, ['rev-parse', 'HEAD']);
  const mergeSha = head.code === 0 ? head.stdout.trim() : '';
  const ancestor = await runGit(repoPath, ['merge-base', '--is-ancestor', branch, 'HEAD']);
  if (mergeSha.length === 0 || ancestor.code !== 0) {
    const detail =
      mergeSha.length === 0
        ? 'could not read HEAD after merge'
        : `branch ${branch} is not an ancestor of main HEAD after merge`;
    const err = `land verification failed: ${detail}`;
    const next = patchJobAndNotify(
      store,
      job.id,
      {
        status: 'blocked',
        notes: [job.notes, snapshotNote, `land: post-merge verification failed — ${detail}`]
          .filter(Boolean)
          .join('\n'),
      },
      { agent: input.agent, summary: err },
    );
    return {
      ok: false,
      job: next ?? job,
      merged: false,
      gcRemoved: false,
      message: '',
      error: err,
    };
  }
  const landReceipt = { mergeSha, branch, verifiedAt: new Date().toISOString() };

  let gcRemoved = false;
  if (input.gcOnSuccess !== false && input.kaos) {
    try {
      await removeSessionWorktree(input.kaos, { nameOrPath: worktreePath });
      gcRemoved = true;
    } catch {
      gcRemoved = false;
    }
  }

  const retainHint =
    !gcRemoved && input.gcOnSuccess !== false
      ? ' (worktree retained — run /job gc)'
      : gcRemoved
        ? ' (worktree removed)'
        : '';
  let message = `Merged ${branch} into ${repoPath} at ${mergeSha.slice(0, 12)}${retainHint}.`;
  const next = patchJobAndNotify(
    store,
    job.id,
    {
      status: 'done',
      worktreePath: gcRemoved ? undefined : worktreePath,
      resultSummary: job.resultSummary ?? `landed branch ${branch}`,
      landReceipt,
      notes: [
        job.notes,
        snapshotNote,
        `land: merged ${branch} into main workspace (receipt ${mergeSha.slice(0, 12)})`,
        gcRemoved
          ? 'land: worktree GC removed'
          : input.gcOnSuccess !== false
            ? 'land: worktree retained — run /job gc'
            : 'land: worktree retained',
      ]
        .filter(Boolean)
        .join("\n"),
    },
    { agent: input.agent, summary: message },
  );

  // Sweep other done leftovers + TTL-expired registry entries (spec GC policy).
  // Skip when tests opt out with gcOnSuccess: false.
  const swept = await maybeSweepAfterLand(input);
  if (swept > 0) {
    message = `${message} Swept ${String(swept)} leftover worktree(s).`;
    const landed = next ?? job;
    const sweptJob = patchJobAndNotify(
      store,
      landed.id,
      {
        notes: [landed.notes, `land: swept ${String(swept)} leftover worktree(s)`]
          .filter(Boolean)
          .join('\n'),
      },
      { agent: input.agent, summary: message },
    );
    return {
      ok: true,
      job: sweptJob ?? landed,
      merged: true,
      gcRemoved,
      message,
    };
  }

  return {
    ok: true,
    job: next ?? job,
    merged: true,
    gcRemoved,
    message,
  };
}

/** Best-effort conductor worktree sweep after a verified land. */
async function maybeSweepAfterLand(input: LandJobToMainInput): Promise<number> {
  if (input.kaos === undefined || input.gcOnSuccess === false) return 0;
  try {
    const result = await gcConductorJobWorktrees({
      kaos: input.kaos,
      store: input.store,
    });
    return result.removedJobIds.length + result.gc.removed;
  } catch {
    return 0;
  }
}

export interface DispatchMergeLandInput {
  readonly store: ToolStore;
  /** Job whose finished worktree branch lands on main. */
  readonly sourceJob: JobRecord;
  readonly trustMode: 'auto' | 'user_approved';
  readonly trustReason: string;
  readonly summary?: string;
  readonly repoPath?: string;
  readonly kaos?: Kaos;
  /** Main-lane agent — inbox + conductor wake after the offloaded land settles. */
  readonly agent?: Agent;
  /** Injectable git runner for contract tests (merge delay injection). */
  readonly runGit?: LandJobToMainInput['runGit'];
}

export interface DispatchMergeLandResult {
  readonly dispatched: boolean;
  /** The kind=merge landing job that tracks the offloaded execution. */
  readonly mergeJob?: JobRecord;
  readonly reason: string;
}

/**
 * V2-5 merge offloading: verdict/execution split (checklist G5).
 *
 * The interactive lane (MergeJob tool) decides trust and returns the verdict;
 * this function hands execution to a kind=`merge` landing job. The land runs
 * detached — it starts on a later microtask, never on the caller stack, and
 * failures land on the ledger, never on the main turn. The main turn runs
 * no `git merge` (await-scan merge lane ratcheted to 0).
 *
 * Synchronous portion: ledger verdict note + landing-job bookkeeping only.
 */
export function dispatchMergeLand(input: DispatchMergeLandInput): DispatchMergeLandResult {
  const { store, sourceJob, trustMode, trustReason } = input;
  // Auto verify_chain land often omits repoPath; inherit session cwd when present.
  const repoPath = input.repoPath?.trim() || input.agent?.config?.cwd?.trim() || undefined;

  const verdictNote = `merge: approved mode=${trustMode} — ${trustReason}`;
  const source = patchJob(store, sourceJob.id, {
    resultSummary: input.summary ?? sourceJob.resultSummary,
    notes: [sourceJob.notes, verdictNote].filter(Boolean).join('\n'),
  });

  const mergeJob = createJob(store, {
    title: `Land ${sourceJob.id} to main`,
    kind: 'merge',
    priority: 10,
    prompt: [
      `Land approved work of ${sourceJob.id} into the main workspace.`,
      `trust: mode=${trustMode} — ${trustReason}`,
      sourceJob.worktreePath ? `worktree: ${sourceJob.worktreePath}` : 'ledger-only (no worktree)',
      repoPath ? `repo: ${repoPath}` : undefined,
      'Executor: landJobToMain on the offload lane (no remote push).',
    ]
      .filter(Boolean)
      .join('\n'),
    parentJobId: sourceJob.id,
  });
  const running = patchJob(store, mergeJob.id, {
    status: 'running',
    notes: 'merge-land: dispatched (offload lane)',
  });

  // Detached execution: the land starts after the caller returned.
  void Promise.resolve().then(async () => {
    await runMergeLandJob({
      store,
      mergeJob: running ?? mergeJob,
      kaos: input.kaos ?? input.agent?.kaos,
      repoPath,
      runGit: input.runGit,
      agent: input.agent,
      // Source already carries the verdict note from the patch above.
      sourceJob: source ?? sourceJob,
    });
  });

  return {
    dispatched: true,
    mergeJob: running ?? mergeJob,
    reason: verdictNote,
  };
}

export interface RunMergeLandJobInput {
  readonly store: ToolStore;
  readonly mergeJob: JobRecord;
  readonly kaos?: Kaos;
  readonly repoPath?: string;
  readonly runGit?: LandJobToMainInput['runGit'];
  /** When set, skip parentJobId lookup (dispatch path already has the source). */
  readonly sourceJob?: JobRecord;
  /** When set, push inbox + wake the Conductor after the land settles. */
  readonly agent?: Agent;
}

/**
 * Deterministic land executor for kind=merge jobs (dispatch microtask + resume/schedule).
 * Never spawns an LLM worker. Source + merge exceptional statuses both notify/wake.
 */
export async function runMergeLandJob(input: RunMergeLandJobInput): Promise<LandJobToMainResult> {
  const { store, mergeJob } = input;
  const source =
    input.sourceJob ??
    (mergeJob.parentJobId !== undefined ? getJob(store, mergeJob.parentJobId) : undefined);

  if (source === undefined) {
    const detail =
      mergeJob.parentJobId === undefined
        ? 'merge job missing parentJobId (source job)'
        : `source job not found: ${mergeJob.parentJobId}`;
    const blocked = patchJobAndNotify(
      store,
      mergeJob.id,
      {
        status: 'blocked',
        resultSummary: detail,
        notes: [mergeJob.notes, `merge-land_failed: ${detail}`].filter(Boolean).join('\n'),
      },
      { agent: input.agent, summary: detail },
    );
    return {
      ok: false,
      job: blocked ?? mergeJob,
      merged: false,
      gcRemoved: false,
      message: '',
      error: detail,
    };
  }

  const repoPath = input.repoPath?.trim() || input.agent?.config?.cwd?.trim() || undefined;

  let land: LandJobToMainResult;
  try {
    land = await landJobToMain({
      store,
      job: source,
      kaos: input.kaos ?? input.agent?.kaos,
      repoPath,
      gcOnSuccess: true,
      runGit: input.runGit,
      agent: input.agent,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const failed = patchJobAndNotify(
      store,
      mergeJob.id,
      {
        status: 'failed',
        resultSummary: detail.slice(0, 2000),
        notes: [mergeJob.notes, `merge-land_failed: ${detail}`].filter(Boolean).join('\n'),
      },
      { agent: input.agent, summary: detail.slice(0, 2000) },
    );
    return {
      ok: false,
      job: failed ?? mergeJob,
      merged: false,
      gcRemoved: false,
      message: '',
      error: detail,
    };
  }

  const status: JobStatus = land.ok ? 'done' : 'blocked';
  const summary = land.ok ? land.message : (land.error ?? 'land failed');
  patchJobAndNotify(
    store,
    mergeJob.id,
    {
      status,
      resultSummary: summary,
      notes: [
        mergeJob.notes,
        land.ok
          ? `merge-land: ok — ${land.message}`
          : `merge-land_failed: ${land.error ?? 'unknown'}`,
      ]
        .filter(Boolean)
        .join('\n'),
    },
    { agent: input.agent, summary },
  );
  return land;
}
