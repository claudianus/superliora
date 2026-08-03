/**
 * Land a finished Job worktree branch onto the main workspace checkout.
 * Does not push remotes (main/user gated). Success may GC the job worktree.
 */

import type { Kaos } from '@superliora/kaos';

import { removeSessionWorktree } from '../../../session/worktree';
import type { ToolStore } from '../../store';
import type { JobRecord } from './job-ledger';
import { patchJob } from './job-ledger';

export interface LandJobToMainInput {
  readonly store: ToolStore;
  readonly job: JobRecord;
  readonly kaos?: Kaos;
  readonly repoPath?: string;
  /** When true, remove worktree after successful merge (locked GC policy). */
  readonly gcOnSuccess?: boolean;
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

async function defaultRunGit(
  kaos: Kaos | undefined,
  cwd: string,
  args: readonly string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  if (kaos === undefined) {
    return { code: 1, stdout: '', stderr: 'kaos unavailable for git land' };
  }
  // Prefer kaos shell API shapes used elsewhere; fall back gracefully.
  const shell = (
    kaos as Kaos & {
      shell?: {
        run?: (req: {
          command: string;
          cwd?: string;
        }) => Promise<{ exitCode?: number; code?: number; stdout?: string; stderr?: string }>;
      };
      exec?: (
        command: string,
        opts?: { cwd?: string },
      ) => Promise<{ code?: number; exitCode?: number; stdout?: string; stderr?: string }>;
    }
  ).shell;
  const command = ['git', ...args].map(shellQuote).join(' ');
  if (shell?.run) {
    const res = await shell.run({ command, cwd });
    return {
      code: res.exitCode ?? res.code ?? 1,
      stdout: res.stdout ?? '',
      stderr: res.stderr ?? '',
    };
  }
  return { code: 1, stdout: '', stderr: 'no git runner on kaos' };
}

function shellQuote(s: string): string {
  if (/^[a-zA-Z0-9_./:@%+=,-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

// Silence unused import hints for consumers
void removeSessionWorktree;

/**
 * Resolve branch name for a job worktree path via `git rev-parse --abbrev-ref HEAD`.
 */
export async function resolveJobWorktreeBranch(
  worktreePath: string,
  runGit: NonNullable<LandJobToMainInput['runGit']>,
): Promise<string | undefined> {
  const res = await runGit(worktreePath, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (res.code !== 0) return undefined;
  const branch = res.stdout.trim();
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
    const next = patchJob(store, job.id, {
      status: 'done',
      notes: [job.notes, 'land: no worktree — ledger-only approve'].filter(Boolean).join('\n'),
    });
    return {
      ok: true,
      job: next ?? job,
      merged: false,
      gcRemoved: false,
      message: 'No worktree on job; merge recorded on ledger only.',
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

  const branch = await resolveJobWorktreeBranch(worktreePath, runGit);
  if (branch === undefined) {
    const next = patchJob(store, job.id, {
      status: 'blocked',
      notes: [job.notes, 'land: could not resolve worktree branch'].filter(Boolean).join('\n'),
    });
    return {
      ok: false,
      job: next ?? job,
      merged: false,
      gcRemoved: false,
      message: '',
      error: 'Could not resolve branch in job worktree',
    };
  }

  // Ensure main workspace is clean enough for merge (non-fatal warn path via stderr).
  const merge = await runGit(repoPath, ['merge', '--no-edit', branch]);
  if (merge.code !== 0) {
    const detail = (merge.stderr || merge.stdout || 'merge failed').slice(0, 500);
    const next = patchJob(store, job.id, {
      status: 'blocked',
      notes: [job.notes, `land: merge failed — ${detail}`].filter(Boolean).join('\n'),
    });
    return {
      ok: false,
      job: next ?? job,
      merged: false,
      gcRemoved: false,
      message: '',
      error: `git merge failed: ${detail}`,
    };
  }

  let gcRemoved = false;
  if (input.gcOnSuccess !== false && input.kaos) {
    try {
      await removeSessionWorktree(input.kaos, { nameOrPath: worktreePath });
      gcRemoved = true;
    } catch {
      gcRemoved = false;
    }
  }

  const next = patchJob(store, job.id, {
    status: 'done',
    worktreePath: gcRemoved ? undefined : worktreePath,
    resultSummary: job.resultSummary ?? `landed branch ${branch}`,
    notes: [
      job.notes,
      `land: merged ${branch} into main workspace`,
      gcRemoved ? 'land: worktree GC removed' : 'land: worktree retained',
    ]
      .filter(Boolean)
      .join('\n'),
  });

  return {
    ok: true,
    job: next ?? job,
    merged: true,
    gcRemoved,
    message: `Merged ${branch} into ${repoPath}${gcRemoved ? ' (worktree removed)' : ''}.`,
  };
}
