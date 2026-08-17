/**
 * Resolve merge/push git roots from the job's own product identity.
 *
 * Session cwd is not a product id. Isolation worktrees are often created
 * from whichever checkout the TUI happened to be in; later MergeJob/PushJob
 * must not follow a later session cwd (or a hardcoded two-repo allowlist)
 * into a foreign history.
 *
 * Witness order: persisted `repoRoot` → worktree main checkout → absolute
 * ownership git roots → relative ownership under the session → session.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, normalize, resolve as resolvePath } from 'node:path';

/** Folder-name fallback when paths are not on disk (unit tests / diagnostics). */
export type OwnedRepoHint = 'superliora' | 'metalslug';

export function normalizeRepoPathKey(path: string): string {
  return normalize(path.trim()).replace(/[/\\]+$/, '').toLowerCase();
}

export function sameRepoPath(a: string, b: string): boolean {
  return normalizeRepoPathKey(a) === normalizeRepoPathKey(b);
}

/** True when a path segment equals the repo folder name. */
export function pathMentionsRepo(path: string, repoName: string): boolean {
  const n = normalizeRepoPathKey(path);
  if (n.length === 0) return false;
  const re = new RegExp(`(?:^|[/\\\\])${repoName}(?:[/\\\\]|$)`, 'i');
  return re.test(n);
}

export function inferPathRepoHint(path: string | undefined): OwnedRepoHint | undefined {
  if (path === undefined || path.trim().length === 0) return undefined;
  // Isolation worktrees: .../.superliora/worktrees/<product>-<hash>/...
  if (/worktrees[/\\]metalslug/i.test(path) || /[/\\]metalslug-[0-9a-f]+[/\\]/i.test(path)) {
    return 'metalslug';
  }
  if (pathMentionsRepo(path, 'metalslug') && !/[.]superliora[/\\]/i.test(path)) {
    return 'metalslug';
  }
  if (pathMentionsRepo(path, 'superliora')) {
    if (/[.]superliora[/\\]worktrees/i.test(path) && !/superliora[/\\]packages/i.test(path)) {
      return undefined;
    }
    return 'superliora';
  }
  return undefined;
}

export function inferOwnershipRepoHint(
  ownershipPaths: readonly string[] | undefined,
): OwnedRepoHint | undefined {
  if (ownershipPaths === undefined || ownershipPaths.length === 0) return undefined;
  let hasSuper = false;
  let hasMetal = false;
  for (const raw of ownershipPaths) {
    const hint = inferPathRepoHint(raw);
    if (hint === 'superliora') hasSuper = true;
    if (hint === 'metalslug') hasMetal = true;
  }
  if (hasSuper && hasMetal) return undefined;
  if (hasSuper) return 'superliora';
  if (hasMetal) return 'metalslug';
  return undefined;
}

export interface CrossOwnershipHoldResult {
  readonly hold: boolean;
  readonly reason?: string;
  readonly ownership?: string;
  readonly target?: string;
}

/**
 * Hold MergeJob/PushJob when the job's product root and the land/push
 * target are different git checkouts. Compares canonical roots when they
 * exist on disk; falls back to folder-name hints for off-disk unit paths.
 */
export function evaluateCrossOwnershipHold(input: {
  readonly ownershipPaths?: readonly string[] | undefined;
  readonly persistedRepoRoot?: string | undefined;
  readonly targetRepoPath?: string | undefined;
  readonly worktreePath?: string | undefined;
}): CrossOwnershipHoldResult {
  const ownershipRoot =
    mainCheckoutFromPath(input.persistedRepoRoot) ??
    firstOwnershipGitRoot(input.ownershipPaths);
  const targetRoot =
    mainCheckoutFromPath(input.targetRepoPath) ?? mainCheckoutFromPath(input.worktreePath);

  if (ownershipRoot !== undefined && targetRoot !== undefined) {
    if (sameRepoPath(ownershipRoot, targetRoot)) {
      return { hold: false, ownership: ownershipRoot, target: targetRoot };
    }
    return {
      hold: true,
      ownership: ownershipRoot,
      target: targetRoot,
      reason:
        `cross_repo_hold: job=${ownershipRoot} target=${targetRoot} — ` +
        'refuse MergeJob/PushJob into a foreign git checkout',
    };
  }

  const ownershipHint =
    inferPathRepoHint(input.persistedRepoRoot) ?? inferOwnershipRepoHint(input.ownershipPaths);
  const targetHint =
    inferPathRepoHint(input.targetRepoPath) ?? inferPathRepoHint(input.worktreePath);
  if (ownershipHint !== undefined && targetHint !== undefined && ownershipHint !== targetHint) {
    return {
      hold: true,
      ownership: ownershipHint,
      target: targetHint,
      reason:
        `cross_ownership_hold: ownership=${ownershipHint} target=${targetHint} — ` +
        'refuse MergeJob/PushJob into a foreign repo (wrong land erases product worktrees)',
    };
  }
  return {
    hold: false,
    ownership: ownershipRoot ?? ownershipHint,
    target: targetRoot ?? targetHint,
  };
}

/** Walk parents for a `.git` entry (file or directory). */
export function findGitRootFromPath(start: string): string | undefined {
  const trimmed = start.trim();
  if (trimmed.length === 0) return undefined;
  let cur = isAbsolute(trimmed) ? trimmed : resolvePath(trimmed);
  for (let i = 0; i < 16; i++) {
    if (existsSync(resolvePath(cur, '.git'))) {
      return cur.replace(/[/\\]+$/, '');
    }
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return undefined;
}

/**
 * Map `git rev-parse --git-common-dir` (or a `gitdir:` pointer) to the main
 * checkout root. Linked worktrees report the shared `.git` directory.
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
  const worktrees = /[/\\]\.git[/\\]worktrees[/\\][^/\\]+$/i.exec(normalized);
  if (worktrees !== null) {
    return dirname(dirname(dirname(normalized)));
  }
  return undefined;
}

function readGitdirPointer(gitEntry: string): string | undefined {
  try {
    const text = readFileSync(gitEntry, 'utf8');
    const match = /^gitdir:\s*(.+)\s*$/m.exec(text);
    const pointer = match?.[1]?.trim();
    return pointer !== undefined && pointer.length > 0 ? pointer : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Main product checkout for a path inside a repo or linked worktree.
 * Isolation worktrees resolve to the source checkout, not the worktree dir.
 */
export function mainCheckoutFromPath(start: string | undefined): string | undefined {
  if (start === undefined || start.trim().length === 0) return undefined;
  const gitRoot = findGitRootFromPath(start);
  if (gitRoot === undefined) return undefined;
  const gitEntry = resolvePath(gitRoot, '.git');
  try {
    const st = statSync(gitEntry);
    if (st.isDirectory()) return gitRoot;
    if (st.isFile()) {
      const pointer = readGitdirPointer(gitEntry);
      if (pointer === undefined) return gitRoot;
      return repoRootFromGitCommonDir(pointer, gitRoot) ?? gitRoot;
    }
  } catch {
    return gitRoot;
  }
  return gitRoot;
}

function firstOwnershipGitRoot(
  ownershipPaths: readonly string[] | undefined,
): string | undefined {
  if (ownershipPaths === undefined) return undefined;
  for (const raw of ownershipPaths) {
    const path = raw.trim();
    if (path.length === 0 || !isAbsolute(path)) continue;
    const root = mainCheckoutFromPath(path);
    if (root !== undefined) return root;
  }
  return undefined;
}

function resolveRelativeOwnershipUnderSession(
  ownershipPaths: readonly string[],
  sessionRoot: string,
): string | undefined {
  if (!existsSync(sessionRoot)) return undefined;
  const normalizedRoot = sessionRoot.replace(/[/\\]+$/, '');
  for (const raw of ownershipPaths) {
    const rel = raw.trim();
    if (rel.length === 0 || isAbsolute(rel)) continue;
    const candidate = resolvePath(normalizedRoot, rel);
    if (existsSync(candidate)) return normalizedRoot;
    if (/^(packages|apps)[/\\]/i.test(rel)) {
      const top = rel.split(/[/\\]/)[0];
      if (top !== undefined && existsSync(resolvePath(normalizedRoot, top))) {
        return normalizedRoot;
      }
    }
  }
  return undefined;
}

export type JobRepoRootSource = 'persisted' | 'worktree' | 'ownership' | 'session';

/**
 * Resolve the product git root for a new or existing Job.
 * Never scans a hardcoded machine path list for a second product.
 */
export function resolveRepoRootForNewJob(input: {
  readonly persistedRepoRoot?: string | undefined;
  readonly ownershipPaths?: readonly string[] | undefined;
  readonly worktreePath?: string | undefined;
  readonly sessionRepoPath?: string | undefined;
}): string | undefined {
  return resolveGitRootFromOwnership(input);
}

/**
 * Resolve the git root for merge/push from job identity.
 * Absolute ownership and persisted roots beat session isolation cwd.
 */
export function resolveGitRootFromOwnership(input: {
  readonly persistedRepoRoot?: string | undefined;
  readonly ownershipPaths?: readonly string[] | undefined;
  readonly worktreePath?: string | undefined;
  readonly sessionRepoPath?: string | undefined;
  /** @deprecated unused — kept so older tests can pass the field */
  readonly preferredSuperlioraRoots?: readonly string[];
  /** @deprecated unused — kept so older tests can pass the field */
  readonly preferredMetalslugRoots?: readonly string[];
}): string | undefined {
  const persisted = input.persistedRepoRoot?.trim();
  if (persisted) {
    const fromPersisted = mainCheckoutFromPath(persisted) ?? (existsSync(persisted) ? persisted : undefined);
    if (fromPersisted !== undefined) return fromPersisted;
    // Off-disk unit paths still count as an explicit identity.
    if (isAbsolute(persisted)) return persisted.replace(/[/\\]+$/, '');
  }

  const fromOwnership = firstOwnershipGitRoot(input.ownershipPaths);
  if (fromOwnership !== undefined) return fromOwnership;

  const fromWorktree = mainCheckoutFromPath(input.worktreePath);
  if (fromWorktree !== undefined) return fromWorktree;

  const session = input.sessionRepoPath?.trim();
  const sessionRoot = session ? (mainCheckoutFromPath(session) ?? findGitRootFromPath(session) ?? session) : undefined;
  if (sessionRoot !== undefined && input.ownershipPaths !== undefined && input.ownershipPaths.length > 0) {
    const underSession = resolveRelativeOwnershipUnderSession(input.ownershipPaths, sessionRoot);
    if (underSession !== undefined) return underSession;
  }

  if (sessionRoot !== undefined) return sessionRoot.replace(/[/\\]+$/, '');
  return undefined;
}

/**
 * Merge/land/push working directory: job product root wins over job worktree
 * isolation and the live session cwd.
 *
 * Land hold: when the worktree's main checkout is a different product than
 * the job root, refuse — different git histories cannot land.
 * Push: redirect cwd to the job root so origin is the product remote even
 * if the worker ran in isolation (localRef may be explicit).
 */
export function resolveMergePushCwd(input: {
  readonly persistedRepoRoot?: string | undefined;
  readonly ownershipPaths?: readonly string[] | undefined;
  readonly worktreePath?: string | undefined;
  readonly sessionRepoPath?: string | undefined;
  readonly preferredSuperlioraRoots?: readonly string[];
  readonly preferredMetalslugRoots?: readonly string[];
  readonly mode?: 'land' | 'push';
}): {
  readonly cwd?: string;
  readonly fromOwnership: boolean;
  readonly hold?: CrossOwnershipHoldResult;
} {
  const mode = input.mode ?? 'push';
  const jobRoot = resolveGitRootFromOwnership({
    persistedRepoRoot: input.persistedRepoRoot,
    ownershipPaths: input.ownershipPaths,
    sessionRepoPath: input.sessionRepoPath,
  });
  const worktreeMain = mainCheckoutFromPath(input.worktreePath);

  if (jobRoot !== undefined && worktreeMain !== undefined && !sameRepoPath(jobRoot, worktreeMain)) {
    // Isolation may have been created from a later TUI cwd. Land must not
    // merge foreign histories. Push still runs at the job product root
    // (shared remotes live there), not the isolation dir.
    if (mode === 'land') {
      const hold = evaluateCrossOwnershipHold({
        persistedRepoRoot: jobRoot,
        ownershipPaths: input.ownershipPaths,
        targetRepoPath: worktreeMain,
      });
      if (hold.hold) {
        return { cwd: jobRoot, fromOwnership: true, hold };
      }
    }
  }

  const ownershipRoot = jobRoot ?? worktreeMain;
  const candidate =
    ownershipRoot ??
    input.worktreePath?.trim() ??
    input.sessionRepoPath?.trim() ??
    undefined;

  if (mode === 'land' && input.worktreePath) {
    const worktreeHold = evaluateCrossOwnershipHold({
      persistedRepoRoot: input.persistedRepoRoot ?? ownershipRoot,
      ownershipPaths: input.ownershipPaths,
      targetRepoPath: worktreeMain ?? input.worktreePath,
    });
    if (worktreeHold.hold) {
      return {
        cwd: candidate,
        fromOwnership: jobRoot !== undefined,
        hold: worktreeHold,
      };
    }
  }

  const sessionHold = evaluateCrossOwnershipHold({
    persistedRepoRoot: input.persistedRepoRoot ?? ownershipRoot,
    ownershipPaths: input.ownershipPaths,
    targetRepoPath: ownershipRoot ?? input.sessionRepoPath,
    worktreePath: ownershipRoot !== undefined ? undefined : input.worktreePath,
  });
  if (sessionHold.hold) {
    return {
      cwd: candidate,
      fromOwnership: jobRoot !== undefined,
      hold: sessionHold,
    };
  }

  return {
    cwd: candidate,
    fromOwnership: jobRoot !== undefined || worktreeMain !== undefined,
    hold: { hold: false },
  };
}
