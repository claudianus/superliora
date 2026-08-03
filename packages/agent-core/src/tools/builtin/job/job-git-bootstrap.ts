/**
 * Conductor git bootstrap — Job worktrees require a git repository.
 *
 * When the working directory is not a git repo, every Job used to block at
 * worktree assignment (`worktree_failed: Not a git repository`) and the
 * orchestrator could not progress any work. This module detects that state
 * and bootstraps a local repository instead:
 *
 *   1. `git init` (default branch `main` when the local git supports `-b`)
 *   2. baseline commit of the current tree (`git add -A` + commit) so
 *      `git worktree add` has a base ref and workers start from real files
 *
 * Opt out with `SUPERLIORA_CONDUCTOR_AUTO_GIT_INIT=0` (also `false/no/off`);
 * the failure then carries actionable guidance for the conductor/user.
 * The bootstrap is local-only (no remote, no push) and memoized per path.
 */

import type { Kaos } from '@superliora/kaos';

import { runGit } from '#/autopilot/git';

/** Env switch: set to `0`/`false`/`no`/`off` to forbid automatic `git init`. */
export const SUPERLIORA_AUTO_GIT_INIT_ENV = 'SUPERLIORA_CONDUCTOR_AUTO_GIT_INIT';

/** Baseline commit subject used when the freshly initialized repo is empty. */
export const GIT_BOOTSTRAP_BASELINE_MESSAGE =
  'chore(superliora): baseline snapshot for Job worktree isolation';

export type GitRepoBootstrapResult =
  | {
      readonly ok: true;
      /** Resolved repository root (may differ from the requested path). */
      readonly root: string;
      /** True when this call initialized the repository. */
      readonly bootstrapped: boolean;
      /** True when this call also created the baseline commit. */
      readonly baselineCommit: boolean;
    }
  | { readonly ok: false; readonly error: string };

/** Manual-setup hint appended to opt-out / bootstrap failures. */
export const GIT_BOOTSTRAP_SETUP_HINT =
  `Job worktrees need a git repository. Run "git init && git add -A && git commit -m 'baseline'" ` +
  `in the project root, then JobResume the blocked jobs — or unset ` +
  `${SUPERLIORA_AUTO_GIT_INIT_ENV}=0 to let SuperLiora bootstrap it automatically.`;

interface BootstrapCacheEntry {
  readonly promise: Promise<GitRepoBootstrapResult>;
}

/** In-flight + completed bootstraps per resolved path (once per process). */
const bootstrapCache = new Map<string, BootstrapCacheEntry>();

function isOptOut(env: Readonly<Record<string, string | undefined>>): boolean {
  const raw = env[SUPERLIORA_AUTO_GIT_INIT_ENV]?.trim().toLowerCase();
  return raw === '0' || raw === 'false' || raw === 'no' || raw === 'off';
}

/** Test hook — clears the per-path memo (unit tests only). */
export function resetGitBootstrapCache(): void {
  bootstrapCache.clear();
}

/**
 * Ensure `repoPath` sits inside a git repository with at least one commit,
 * initializing + baseline-commiting when needed and allowed. Memoized per
 * resolved path; concurrent callers share one bootstrap attempt.
 */
export function ensureGitRepoForWorktrees(
  kaos: Kaos,
  repoPath: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<GitRepoBootstrapResult> {
  const cached = bootstrapCache.get(repoPath);
  if (cached !== undefined) return cached.promise;
  const promise = runBootstrap(kaos, repoPath, env).then((result) => {
    // Failed attempts stay out of the cache so a later pump can retry
    // (e.g. after the user installed git or ran `git init` themselves).
    if (!result.ok) bootstrapCache.delete(repoPath);
    return result;
  });
  bootstrapCache.set(repoPath, { promise });
  return promise;
}

async function runBootstrap(
  kaos: Kaos,
  repoPath: string,
  env: Readonly<Record<string, string | undefined>>,
): Promise<GitRepoBootstrapResult> {
  const probe = await runGit(kaos, repoPath, ['rev-parse', '--show-toplevel']);
  if (probe.ok) {
    const root = probe.stdout.trim();
    if (root.length > 0) {
      return { ok: true, root, bootstrapped: false, baselineCommit: false };
    }
  }

  // `git` missing entirely: exec failure surfaces through stderr.
  const probeText = `${probe.stderr} ${probe.stdout}`.toLowerCase();
  if (probe.exitCode === null && probeText.includes('enoent')) {
    return {
      ok: false,
      error:
        'git is not installed or not on PATH — Job worktrees require git. ' +
        'Install git, then JobResume the blocked jobs.',
    };
  }

  if (isOptOut(env)) {
    return {
      ok: false,
      error: `Not a git repository: ${repoPath}. Automatic git init is disabled (${SUPERLIORA_AUTO_GIT_INIT_ENV}). ${GIT_BOOTSTRAP_SETUP_HINT}`,
    };
  }

  // 1) init — prefer an explicit default branch; old git lacks `-b`.
  let init = await runGit(kaos, repoPath, ['init', '-b', 'main']);
  if (!init.ok) {
    init = await runGit(kaos, repoPath, ['init']);
  }
  if (!init.ok) {
    return {
      ok: false,
      error: `git init failed in ${repoPath}: ${trim(init.stderr || init.stdout) || 'unknown error'}. ${GIT_BOOTSTRAP_SETUP_HINT}`,
    };
  }

  // 2) baseline commit — worktree branches need at least one commit.
  const head = await runGit(kaos, repoPath, ['rev-parse', '--verify', '--quiet', 'HEAD']);
  if (head.ok) {
    return { ok: true, root: repoPath, bootstrapped: true, baselineCommit: false };
  }

  const add = await runGit(kaos, repoPath, ['add', '-A']);
  if (!add.ok) {
    return {
      ok: false,
      error: `git add failed in ${repoPath}: ${trim(add.stderr || add.stdout) || 'unknown error'}. ${GIT_BOOTSTRAP_SETUP_HINT}`,
    };
  }

  const identity = await commitIdentityArgs(kaos, repoPath);
  const commit = await runGit(kaos, repoPath, [
    ...identity,
    'commit',
    '--no-gpg-sign',
    '-m',
    GIT_BOOTSTRAP_BASELINE_MESSAGE,
  ]);
  const committed = commit.ok || commit.stderr.includes('nothing to commit');
  const recheck = await runGit(kaos, repoPath, ['rev-parse', '--verify', '--quiet', 'HEAD']);
  if (!committed || !recheck.ok) {
    return {
      ok: false,
      error: `baseline commit failed in ${repoPath}: ${trim(commit.stderr || commit.stdout) || 'unknown error'}. ${GIT_BOOTSTRAP_SETUP_HINT}`,
    };
  }
  return { ok: true, root: repoPath, bootstrapped: true, baselineCommit: true };
}

/**
 * Inline `-c user.name/user.email` overrides — only when the local git has
 * no identity configured, so the baseline commit never fails with
 * "please tell me who you are" and never overrides the user's config.
 */
async function commitIdentityArgs(kaos: Kaos, repoPath: string): Promise<string[]> {
  const args: string[] = [];
  const name = await runGit(kaos, repoPath, ['config', 'user.name']);
  if (!name.ok || name.stdout.trim().length === 0) {
    args.push('-c', 'user.name=SuperLiora');
  }
  const email = await runGit(kaos, repoPath, ['config', 'user.email']);
  if (!email.ok || email.stdout.trim().length === 0) {
    args.push('-c', 'user.email=superliora@localhost');
  }
  return args;
}

function trim(text: string): string {
  return text.trim().slice(0, 300);
}
