import {
  buildWorktreeMetadata,
  createSessionWorktreeAuto,
  resolveLioraHome,
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
 */
export async function resolveSessionWorkDir(
  input: ResolveWorktreeInput,
): Promise<ResolveWorktreeResult> {
  const cwd = input.cwd ?? process.cwd();
  if (input.worktree === undefined || input.worktree === false) {
    return { workDir: cwd };
  }

  const name =
    typeof input.worktree === 'string' && input.worktree.length > 0 ? input.worktree : undefined;
  const homeDir = input.homeDir ?? resolveLioraHome();

  const created = await createSessionWorktreeAuto({
    repoPath: cwd,
    name,
    homeDir,
  });

  return {
    workDir: created.workDir,
    worktreeMeta: created.meta,
    metadata: buildWorktreeMetadata(created.meta),
  };
}
