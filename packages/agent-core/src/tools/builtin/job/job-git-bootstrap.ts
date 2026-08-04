/**
 * Conductor git bootstrap — compatibility shim.
 *
 * The bootstrap moved to the session layer (`#/session/git-bootstrap`) so
 * every worktree entrypoint (`liora --worktree`, `/fork --worktree`, fleet
 * workers, Conductor Jobs) shares the same auto `git init` + baseline-commit
 * behavior instead of blocking on fresh/empty folders. Existing Conductor
 * imports keep working through these re-exports.
 */

export {
  ensureGitRepoForWorktrees,
  resetGitBootstrapCache,
  GIT_BOOTSTRAP_BASELINE_MESSAGE,
  GIT_BOOTSTRAP_SETUP_HINT,
  AUTO_GIT_INIT_ENV,
  LEGACY_CONDUCTOR_AUTO_GIT_INIT_ENV as SUPERLIORA_AUTO_GIT_INIT_ENV,
  type GitRepoBootstrapResult,
} from '#/session/git-bootstrap';
