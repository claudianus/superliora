/**
 * Git repository bootstrap for worktree isolation (session layer).
 *
 * Every worktree entrypoint (`liora --worktree`, `/fork --worktree`,
 * fleet workers, Conductor Jobs) needs a git repository with at least one
 * commit — `git worktree add` refuses to run against a missing repo or an
 * unborn HEAD. Starting a session in a fresh/empty folder used to block all
 * work at worktree creation; this module detects that state and bootstraps
 * a local repository automatically:
 *
 *   1. `git init` (default branch `main` when the local git supports `-b`)
 *   2. baseline commit of the current tree (`git add -A` + commit, falling
 *      back to `--allow-empty` for completely empty folders) so
 *      `git worktree add` has a base ref and workers start from real files
 *
 * The same path repairs an existing repo that never received a commit
 * (unborn HEAD): it adds only the missing baseline commit, never `init`.
 *
 * Opt out with `SUPERLIORA_AUTO_GIT_INIT=0` (legacy
 * `SUPERLIORA_CONDUCTOR_AUTO_GIT_INIT` is honored too); the failure then
 * carries actionable guidance. The bootstrap is local-only (no remote, no
 * push) and memoized per path.
 */

import type { Kaos } from '@superliora/kaos';

import { runGit } from '#/autopilot/git';

/** Env switch: set to `0`/`false`/`no`/`off` to forbid automatic bootstrap. */
export const AUTO_GIT_INIT_ENV = 'SUPERLIORA_AUTO_GIT_INIT';

/** Legacy Conductor-only switch, still honored as an opt-out. */
export const LEGACY_CONDUCTOR_AUTO_GIT_INIT_ENV = 'SUPERLIORA_CONDUCTOR_AUTO_GIT_INIT';

/** Baseline commit subject used when the repository has no commits yet. */
export const GIT_BOOTSTRAP_BASELINE_MESSAGE =
  'chore(superliora): baseline snapshot for worktree isolation';

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
  `Worktrees need a git repository with at least one commit. Run ` +
  `"git init && git add -A && git commit -m 'baseline'" in the project root ` +
  `(add "--allow-empty" when the folder has no files), then retry — or unset ` +
  `${AUTO_GIT_INIT_ENV}=0 to let SuperLiora bootstrap it automatically.`;

interface BootstrapCacheEntry {
  readonly promise: Promise<GitRepoBootstrapResult>;
}

/** In-flight + completed bootstraps per resolved path (once per process). */
const bootstrapCache = new Map<string, BootstrapCacheEntry>();

function isOptOut(env: Readonly<Record<string, string | undefined>>): boolean {
  for (const key of [AUTO_GIT_INIT_ENV, LEGACY_CONDUCTOR_AUTO_GIT_INIT_ENV]) {
    const raw = env[key]?.trim().toLowerCase();
    if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return true;
  }
  return false;
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

  // `git` missing entirely: exec failure surfaces through stderr.
  const probeText = `${probe.stderr} ${probe.stdout}`.toLowerCase();
  if (!probe.ok && probe.exitCode === null && probeText.includes('enoent')) {
    return {
      ok: false,
      error:
        'git is not installed or not on PATH — worktrees require git. ' +
        'Install git, then retry.',
    };
  }

  const root = probe.ok ? probe.stdout.trim() : '';
  if (root.length > 0) {
    // Repo exists — it still needs a commit before `worktree add` works.
    const head = await runGit(kaos, root, ['rev-parse', '--verify', '--quiet', 'HEAD']);
    if (head.ok) {
      return { ok: true, root, bootstrapped: false, baselineCommit: false };
    }
    if (isOptOut(env)) {
      return {
        ok: false,
        error: `Git repository at ${root} has no commits yet and automatic baseline creation is disabled (${AUTO_GIT_INIT_ENV} / ${LEGACY_CONDUCTOR_AUTO_GIT_INIT_ENV}). ${GIT_BOOTSTRAP_SETUP_HINT}`,
      };
    }
    const baseline = await ensureBaselineCommit(kaos, root);
    if (!baseline.ok) return baseline;
    return { ok: true, root, bootstrapped: false, baselineCommit: true };
  }

  if (isOptOut(env)) {
    return {
      ok: false,
      error: `Not a git repository: ${repoPath}. Automatic git init is disabled (${AUTO_GIT_INIT_ENV} / ${LEGACY_CONDUCTOR_AUTO_GIT_INIT_ENV}). ${GIT_BOOTSTRAP_SETUP_HINT}`,
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
  const baseline = await ensureBaselineCommit(kaos, repoPath);
  if (!baseline.ok) return baseline;
  return { ok: true, root: repoPath, bootstrapped: true, baselineCommit: true };
}

/**
 * Guarantee at least one commit exists. Completely empty folders have
 * nothing to stage, so a plain commit reports "nothing to commit" — retry
 * with `--allow-empty` so even a bare directory yields a valid base ref.
 */
async function ensureBaselineCommit(
  kaos: Kaos,
  repoPath: string,
): Promise<GitRepoBootstrapResult> {
  const head = await runGit(kaos, repoPath, ['rev-parse', '--verify', '--quiet', 'HEAD']);
  if (head.ok) {
    return { ok: true, root: repoPath, bootstrapped: false, baselineCommit: false };
  }

  const add = await runGit(kaos, repoPath, ['add', '-A']);
  if (!add.ok) {
    return {
      ok: false,
      error: `git add failed in ${repoPath}: ${trim(add.stderr || add.stdout) || 'unknown error'}. ${GIT_BOOTSTRAP_SETUP_HINT}`,
    };
  }

  const identity = await commitIdentityArgs(kaos, repoPath);
  let commit = await runGit(kaos, repoPath, [
    ...identity,
    'commit',
    '--no-gpg-sign',
    '-m',
    GIT_BOOTSTRAP_BASELINE_MESSAGE,
  ]);
  const nothingToCommit =
    !commit.ok && `${commit.stderr} ${commit.stdout}`.toLowerCase().includes('nothing to commit');
  if (nothingToCommit) {
    commit = await runGit(kaos, repoPath, [
      ...identity,
      'commit',
      '--allow-empty',
      '--no-gpg-sign',
      '-m',
      GIT_BOOTSTRAP_BASELINE_MESSAGE,
    ]);
  }

  const recheck = await runGit(kaos, repoPath, ['rev-parse', '--verify', '--quiet', 'HEAD']);
  if (!commit.ok || !recheck.ok) {
    return {
      ok: false,
      error: `baseline commit failed in ${repoPath}: ${trim(commit.stderr || commit.stdout) || 'unknown error'}. ${GIT_BOOTSTRAP_SETUP_HINT}`,
    };
  }
  return { ok: true, root: repoPath, bootstrapped: false, baselineCommit: true };
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
