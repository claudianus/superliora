import {
  buildWorktreeMetadata,
  createSessionWorktreeAuto,
  resolveLioraHome,
  touchWorktreeAccess,
  type SessionWorktreeMeta,
} from '@superliora/sdk';

export interface ResolveWorktreeInput {
  /** CLI flag value: true → auto name; string → explicit name. */
  readonly worktree: boolean | string | undefined;
  readonly cwd?: string | undefined;
  readonly homeDir?: string | undefined;
}

export interface ResolveWorktreeResult {
  readonly workDir: string;
  readonly worktreeMeta?: SessionWorktreeMeta;
  readonly metadata?: Record<string, unknown>;
}

/**
 * When `--worktree` is set, create a git worktree under `~/.superliora/worktrees`
 * and return that path as the session workDir. Otherwise returns `process.cwd()`.
 *
 * Isolation is opt-in only. Prefer a dedicated worktree/branch for large or
 * long-running work so concurrent sessions do not share one dirty checkout.
 */
export async function resolveSessionWorkDir(
  input: ResolveWorktreeInput,
): Promise<ResolveWorktreeResult> {
  const cwd = input.cwd ?? process.cwd();
  const homeDir = input.homeDir ?? resolveLioraHome();

  if (input.worktree === undefined || input.worktree === false) {
    // Age-based GC uses lastAccessedAt — bump when the operator is already
    // sitting inside a registered session worktree.
    // ponytail: fire-and-forget so the common non-worktree launch does not pay a
    // registry read before the first token. Ceiling: a session that exits within
    // the read may leave lastAccessedAt one run stale, which only makes age-GC
    // (operator-driven, --dry-run first) see the worktree as older than it is.
    void touchWorktreeAccess(homeDir, cwd).catch(() => {});
    return { workDir: cwd };
  }

  const name =
    typeof input.worktree === 'string' && input.worktree.length > 0 ? input.worktree : undefined;

  const created = await createSessionWorktreeAuto({
    repoPath: cwd,
    name,
    homeDir,
  });

  await touchWorktreeAccess(homeDir, created.workDir).catch(() => {});

  return {
    workDir: created.workDir,
    worktreeMeta: created.meta,
    metadata: buildWorktreeMetadata(created.meta),
  };
}
