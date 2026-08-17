/**
 * Commit backstop for Conductor job worktrees.
 *
 * The worker contract asks every worker to commit before finishing, but a
 * disobedient, crashed, or interrupted worker leaves a dirty tree — and
 * land-to-main merges the worktree *branch*, so uncommitted work is invisible
 * to the merge and destroyed when the worktree is GC'd. Running this at
 * worker completion (and again before land) makes that work loss structural
 * instead of prompt-dependent: whatever is dirty gets a snapshot commit.
 *
 * Never throws and never fails the job: git errors come back in the result
 * so callers record a ledger note and keep their own verdict flow.
 */

import type { Kaos } from '@superliora/kaos';

import { runGit } from '#/autopilot/git';
import {
  buildJobSnapshotCommitMessage,
  commitIdentityArgs,
  resolveCommitAuthor,
  validateCommitMessage,
} from '../../support/git-commit-policy';

/**
 * Minimal runner shape so tests and job-land's injectable runner adapt with
 * one closure. Defaults to the shared kaos-backed `runGit`.
 */
export type WorktreeGitRunner = (
  cwd: string,
  args: readonly string[],
) => Promise<{ readonly ok: boolean; readonly stdout: string; readonly stderr: string }>;

/** @deprecated Prefer {@link buildJobSnapshotCommitMessage}; kept for test greps. */
export const JOB_WORKTREE_SNAPSHOT_MESSAGE_PREFIX = 'chore(job):';

export interface CommitJobWorktreeInput {
  readonly worktreePath: string;
  readonly jobId: string;
  readonly jobTitle?: string;
  readonly kaos?: Kaos;
  /** Inject for tests / custom execution; wins over `kaos`. */
  readonly run?: WorktreeGitRunner;
}

export interface CommitJobWorktreeResult {
  readonly committed: boolean;
  readonly error?: string;
}

export function kaosWorktreeGitRunner(kaos: Kaos): WorktreeGitRunner {
  return (cwd, args) => runGit(kaos, cwd, args);
}

export async function commitJobWorktreeIfDirty(
  input: CommitJobWorktreeInput,
): Promise<CommitJobWorktreeResult> {
  const run =
    input.run ?? (input.kaos !== undefined ? kaosWorktreeGitRunner(input.kaos) : undefined);
  if (run === undefined) return { committed: false, error: 'no git runner available' };

  const status = await run(input.worktreePath, ['status', '--porcelain']);
  if (!status.ok) {
    return { committed: false, error: `git status failed: ${detail(status)}` };
  }
  if (status.stdout.trim().length === 0) return { committed: false };

  const add = await run(input.worktreePath, ['add', '-A']);
  if (!add.ok) return { committed: false, error: `git add failed: ${detail(add)}` };

  const identity = await resolveWorktreeIdentityArgs(run, input.worktreePath);
  const rawMessage = buildJobSnapshotCommitMessage({
    jobId: input.jobId,
    jobTitle: input.jobTitle,
  });
  const validated = validateCommitMessage(rawMessage, { autoFix: true });
  const message = validated.message ?? rawMessage;
  const commit = await run(input.worktreePath, [
    ...identity,
    'commit',
    '--no-gpg-sign',
    '-m',
    message,
  ]);
  if (!commit.ok) return { committed: false, error: `git commit failed: ${detail(commit)}` };
  return { committed: true };
}

/**
 * Inline `-c` identity overrides, only when the repo has none configured —
 * the snapshot commit never fails with "please tell me who you are" and never
 * overrides the user's git config (same policy as the baseline bootstrap).
 */
async function resolveWorktreeIdentityArgs(
  run: WorktreeGitRunner,
  cwd: string,
): Promise<readonly string[]> {
  const name = await run(cwd, ['config', 'user.name']);
  const email = await run(cwd, ['config', 'user.email']);
  const author = resolveCommitAuthor({
    name: name.ok ? name.stdout : undefined,
    email: email.ok ? email.stdout : undefined,
  });
  // Only inject -c when falling back to the bot (or partial config).
  if (!author.isBotFallback) return [];
  const configuredName = name.ok && name.stdout.trim().length > 0;
  const configuredEmail = email.ok && email.stdout.trim().length > 0;
  if (configuredName && configuredEmail) return [];
  return commitIdentityArgs(author);
}

function detail(r: { readonly stdout: string; readonly stderr: string }): string {
  return (r.stderr || r.stdout).trim().slice(0, 300) || 'unknown error';
}
