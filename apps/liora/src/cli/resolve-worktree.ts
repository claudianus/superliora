import {
  buildWorktreeMetadata,
  createSessionWorktreeAuto,
  ErrorCodes,
  LioraError,
  resolveLioraHome,
  worktreesRoot,
  type SessionWorktreeMeta,
} from '@superliora/sdk';
import { resolve as resolvePath } from 'node:path';

export type WorktreeOption = boolean | string;

export interface ResolveWorktreeInput {
  /**
   * CLI / caller value:
   * - `undefined` → default auto-isolate when `autoIsolate` allows
   * - `true` → force auto-named worktree
   * - `string` → named worktree
   * - `false` → stay on the current checkout (`--no-worktree`)
   */
  readonly worktree: WorktreeOption | false | undefined;
  /**
   * When true (default), `worktree === undefined` creates a session worktree
   * for git checkouts so concurrent agents do not share one dirty tree.
   * Callers disable this for resume / continue / attach paths.
   */
  readonly autoIsolate?: boolean;
  readonly cwd?: string | undefined;
  readonly homeDir?: string | undefined;
  readonly env?: NodeJS.ProcessEnv;
}

export interface ResolveWorktreeResult {
  readonly workDir: string;
  readonly worktreeMeta?: SessionWorktreeMeta;
  readonly metadata?: Record<string, unknown>;
  /** True when isolation was skipped because cwd is already a SuperLiora worktree. */
  readonly reusedExisting?: boolean;
}

function envDisablesAutoIsolate(env: NodeJS.ProcessEnv): boolean {
  const raw = env.SUPERLIORA_NO_WORKTREE ?? env.LIORA_NO_WORKTREE;
  if (raw === undefined) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

/**
 * True when `dir` lives under `~/.superliora/worktrees/` (a session isolation tree).
 * Nested isolation is noise — stay put if already inside one.
 */
export function isUnderSessionWorktreesRoot(
  dir: string,
  homeDir?: string | undefined,
): boolean {
  const root = resolvePath(worktreesRoot(homeDir));
  const resolved = resolvePath(dir);
  if (resolved === root) return true;
  const prefix = root.endsWith('/') ? root : `${root}/`;
  return resolved.startsWith(prefix);
}

/**
 * Decide whether this launch should create a session worktree.
 * Pure helper so unit tests do not need git.
 */
export function shouldCreateSessionWorktree(input: {
  readonly worktree?: WorktreeOption | false;
  readonly autoIsolate?: boolean;
  readonly envDisables?: boolean;
  readonly alreadyInSessionWorktree?: boolean;
}): 'skip' | 'create' {
  if (input.worktree === false) return 'skip';
  if (input.alreadyInSessionWorktree === true) return 'skip';
  if (typeof input.worktree === 'string') return 'create';
  if (input.envDisables === true) return 'skip';
  if (input.worktree === true) return 'create';
  // Default path: auto-isolate new sessions unless the caller opted out.
  if (input.worktree === undefined && input.autoIsolate !== false) return 'create';
  return 'skip';
}

/**
 * Resolve the working directory for a session launch.
 *
 * Default (no flags): create a dedicated git worktree + branch under
 * `~/.superliora/worktrees/` so concurrent agents never share one dirty checkout.
 * Opt out with `--no-worktree` or `SUPERLIORA_NO_WORKTREE=1`.
 * Resume / continue callers pass `autoIsolate: false`.
 */
export async function resolveSessionWorkDir(
  input: ResolveWorktreeInput,
): Promise<ResolveWorktreeResult> {
  const env = input.env ?? process.env;
  const cwd = input.cwd ?? process.cwd();
  const homeDir = input.homeDir ?? resolveLioraHome();
  const alreadyInSessionWorktree = isUnderSessionWorktreesRoot(cwd, homeDir);

  const decision = shouldCreateSessionWorktree({
    worktree: input.worktree,
    autoIsolate: input.autoIsolate,
    envDisables: envDisablesAutoIsolate(env),
    alreadyInSessionWorktree,
  });

  if (decision === 'skip') {
    return {
      workDir: cwd,
      reusedExisting: alreadyInSessionWorktree ? true : undefined,
    };
  }

  const name =
    typeof input.worktree === 'string' && input.worktree.length > 0 ? input.worktree : undefined;
  const explicit = input.worktree === true || typeof input.worktree === 'string';

  try {
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
  } catch (err) {
    // Non-git directories: soft-fail only for default auto mode. Explicit
    // `--worktree` still surfaces the hard error so users know why isolation failed.
    if (
      !explicit &&
      err instanceof LioraError &&
      err.code === ErrorCodes.WORKTREE_NOT_A_GIT_REPO
    ) {
      return { workDir: cwd };
    }
    throw err;
  }
}
