/**
 * Land a finished Job worktree branch onto the main workspace checkout.
 * Does not push remotes (main/user gated). Success may GC the job worktree.
 */

import type { Kaos } from '@superliora/kaos';

import { runGit as kaosRunGit } from '#/autopilot/git';

import type { Agent } from '../../../agent/index';
import { removeSessionWorktree } from '../../../session/worktree';
import type { ToolStore } from '../../store';
import type { JobRecord, JobStatus } from './job-ledger';
import { createJob, getJob, patchJob } from './job-ledger';
import { patchJobAndNotify } from './job-notify';
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
  const repoPath = input.repoPath;
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

  if (!repoPath) {
    return {
      ok: false,
      job,
      merged: false,
      gcRemoved: false,
      message: '',
      error: 'repoPath required to land worktree',
    };
  }

  const runGit =
    input.runGit ??
    ((cwd: string, args: readonly string[]) => defaultRunGit(input.kaos, cwd, args));

  const resolved = await resolveJobWorktreeMergeRef(worktreePath, runGit, job.worktreeBranch);
  if (resolved.ref === undefined) {
    const detail = resolved.error ?? 'Could not resolve branch in job worktree';
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
  const branch = resolved.ref;

  // Commit backstop: the merge below only sees the branch, so a dirty tree
  // (worker never committed) would be silently excluded from the merge and
  // destroyed by worktree GC. Snapshot first; if the snapshot itself fails,
  // hold the land instead of discarding work.
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
  const snapshotNote = snapshot.committed
    ? 'land: snapshotted uncommitted worker changes onto the branch before merge'
    : undefined;

  // Ensure main workspace is clean enough for merge (non-fatal warn path via stderr).
  const merge = await runGit(repoPath, ['merge', '--no-edit', branch]);
  if (merge.code !== 0) {
    const detail = (merge.stderr || merge.stdout || 'merge failed').slice(0, 500);
    const err = `git merge failed: ${detail}`;
    const next = patchJobAndNotify(
      store,
      job.id,
      {
        status: 'blocked',
        notes: [job.notes, snapshotNote, `land: merge failed — ${detail}`]
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

  const message = `Merged ${branch} into ${repoPath} at ${mergeSha.slice(0, 12)}${gcRemoved ? ' (worktree removed)' : ''}.`;
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
        gcRemoved ? 'land: worktree GC removed' : 'land: worktree retained',
      ]
        .filter(Boolean)
        .join('\n'),
    },
    { agent: input.agent, summary: message },
  );

  return {
    ok: true,
    job: next ?? job,
    merged: true,
    gcRemoved,
    message,
  };
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
      input.repoPath ? `repo: ${input.repoPath}` : undefined,
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
      kaos: input.kaos,
      repoPath: input.repoPath,
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

  let land: LandJobToMainResult;
  try {
    land = await landJobToMain({
      store,
      job: source,
      kaos: input.kaos,
      repoPath: input.repoPath,
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
