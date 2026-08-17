/**
 * Resolve merge/push git roots from job ownership — never land/push a
 * superliora-owned Job into metalslug isolation (or the reverse).
 *
 * Session worktrees are often bootstrapped from the interactive cwd
 * (e.g. metalslug with no origin). Ownership is the sole witness for
 * which product repo may receive merge/push.
 */

import { existsSync } from 'node:fs';
import { dirname, isAbsolute, normalize, resolve as resolvePath } from 'node:path';

export type OwnedRepoHint = 'superliora' | 'metalslug';

const DEFAULT_SUPERLIORA_ROOTS = [
  'C:/Users/Administrator/superliora',
  'C:\\Users\\Administrator\\superliora',
] as const;

const DEFAULT_METALSLUG_ROOTS = [
  'C:/Users/Administrator/code/metalslug',
  'C:\\Users\\Administrator\\code\\metalslug',
] as const;

export function normalizeRepoPathKey(path: string): string {
  return normalize(path.trim()).replace(/[/\\]+$/, '').toLowerCase();
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
  // Isolation worktrees: .../.superliora/worktrees/metalslug-*/...
  // These are metalslug product isolation hosts even though the path also
  // contains `.superliora` (home config), not the superliora git product.
  if (/worktrees[/\\]metalslug/i.test(path) || /[/\\]metalslug-[0-9a-f]+[/\\]/i.test(path)) {
    return 'metalslug';
  }
  // Product checkouts under code/metalslug or */metalslug (not .superliora home).
  if (pathMentionsRepo(path, 'metalslug') && !/[.]superliora[/\\]/i.test(path)) {
    return 'metalslug';
  }
  // superliora product checkout / ownership (exclude pure .superliora home dirs
  // that are not the git product root — those rarely appear as land targets).
  if (pathMentionsRepo(path, 'superliora')) {
    // `.superliora/worktrees/...` without metalslug marker is still isolation,
    // but we cannot invent a product — leave undefined unless superliora repo.
    if (/[.]superliora[/\\]worktrees/i.test(path) && !/superliora[/\\]packages/i.test(path)) {
      return undefined;
    }
    return 'superliora';
  }
  return undefined;
}

/**
 * Ownership claim set → product repo. Mixed superliora+metalslug claims are
 * undefined (caller must not invent a target).
 */
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
  readonly ownership?: OwnedRepoHint;
  readonly target?: OwnedRepoHint;
}

/**
 * Hold MergeJob/PushJob when ownership names one product repo and the
 * land/push target (session cwd, worktree, or resolved root) is the other.
 */
export function evaluateCrossOwnershipHold(input: {
  readonly ownershipPaths?: readonly string[] | undefined;
  readonly targetRepoPath?: string | undefined;
  readonly worktreePath?: string | undefined;
}): CrossOwnershipHoldResult {
  const ownership = inferOwnershipRepoHint(input.ownershipPaths);
  if (ownership === undefined) return { hold: false };

  const target =
    inferPathRepoHint(input.targetRepoPath) ?? inferPathRepoHint(input.worktreePath);
  if (target === undefined) return { hold: false, ownership };

  if (ownership !== target) {
    return {
      hold: true,
      ownership,
      target,
      reason:
        `cross_ownership_hold: ownership=${ownership} target=${target} — ` +
        'refuse MergeJob/PushJob into a foreign repo (wrong land erases product worktrees)',
    };
  }
  return { hold: false, ownership, target };
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

function firstExisting(roots: readonly string[]): string | undefined {
  for (const root of roots) {
    if (existsSync(root)) return root.replace(/[/\\]+$/, '');
  }
  return undefined;
}

function extractNamedRoot(path: string, name: string): string | undefined {
  const normalized = normalize(path);
  const re = new RegExp(`^(.*?[/\\\\]${name})(?:[/\\\\]|$)`, 'i');
  const match = re.exec(normalized);
  const root = match?.[1];
  if (root !== undefined && existsSync(root)) {
    return root.replace(/[/\\]+$/, '');
  }
  return undefined;
}

/**
 * Relative ownership under a preferred root: path exists, or monorepo
 * packages/apps claim while the root itself is a git checkout.
 */
function resolveRelativeOwnershipRoot(
  ownershipPaths: readonly string[],
  roots: readonly string[],
): string | undefined {
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const normalizedRoot = root.replace(/[/\\]+$/, '');
    for (const raw of ownershipPaths) {
      const rel = raw.trim();
      if (rel.length === 0 || isAbsolute(rel)) continue;
      const candidate = resolvePath(normalizedRoot, rel);
      if (existsSync(candidate)) return normalizedRoot;
      // monorepo package claim — prefer product root that has that package dir
      if (/^(packages|apps)[/\\]/i.test(rel) && existsSync(resolvePath(normalizedRoot, rel.split(/[/\\]/)[0]!))) {
        return normalizedRoot;
      }
    }
  }
  return undefined;
}

/**
 * Resolve the git root for merge/push from ownership_paths.
 * Absolute ownership paths and known product roots beat session isolation cwd.
 */
export function resolveGitRootFromOwnership(input: {
  readonly ownershipPaths?: readonly string[] | undefined;
  readonly sessionRepoPath?: string | undefined;
  readonly preferredSuperlioraRoots?: readonly string[];
  readonly preferredMetalslugRoots?: readonly string[];
}): string | undefined {
  const superRoots = input.preferredSuperlioraRoots ?? DEFAULT_SUPERLIORA_ROOTS;
  const metalRoots = input.preferredMetalslugRoots ?? DEFAULT_METALSLUG_ROOTS;
  const ownershipPaths = input.ownershipPaths ?? [];

  // 1) Absolute ownership paths → git root / named product root
  for (const raw of ownershipPaths) {
    const path = raw.trim();
    if (path.length === 0 || !isAbsolute(path)) continue;
    const gitRoot = findGitRootFromPath(path);
    if (gitRoot !== undefined) return gitRoot;
    const named =
      extractNamedRoot(path, 'superliora') ?? extractNamedRoot(path, 'metalslug');
    if (named !== undefined) return named;
  }

  // 2) Ownership hint → preferred product checkout
  const hint = inferOwnershipRepoHint(ownershipPaths);
  if (hint === 'superliora') {
    const preferred = firstExisting(superRoots);
    if (preferred !== undefined) return preferred;
    const session = input.sessionRepoPath?.trim();
    if (session && inferPathRepoHint(session) === 'superliora') {
      return findGitRootFromPath(session) ?? session;
    }
  }
  if (hint === 'metalslug') {
    const preferred = firstExisting(metalRoots);
    if (preferred !== undefined) return preferred;
    const session = input.sessionRepoPath?.trim();
    if (session && inferPathRepoHint(session) === 'metalslug') {
      return findGitRootFromPath(session) ?? session;
    }
  }

  // 3) Relative ownership under preferred product roots (isolation-safe).
  // Prefer superliora when packages/apps claims exist there — session metalslug
  // must not steal harness jobs that own agent-core / liora monorepo paths.
  const underSuper = resolveRelativeOwnershipRoot(ownershipPaths, superRoots);
  const underMetal = resolveRelativeOwnershipRoot(ownershipPaths, metalRoots);
  if (underSuper !== undefined && underMetal === undefined) return underSuper;
  if (underMetal !== undefined && underSuper === undefined) return underMetal;
  if (underSuper !== undefined && underMetal !== undefined) {
    // Ambiguous — prefer session if it matches one root, else superliora when
    // ownership is monorepo packages/apps (harness default product).
    const sessionHint = inferPathRepoHint(input.sessionRepoPath);
    if (sessionHint === 'metalslug') return underMetal;
    return underSuper;
  }

  // 4) Session fallback only when ownership does not name a foreign product.
  const session = input.sessionRepoPath?.trim();
  if (session) {
    return findGitRootFromPath(session) ?? session;
  }
  return undefined;
}

/**
 * Merge/land/push working directory: ownership git root wins over job worktree
 * isolation and session cwd. Prevents `git push` in metalslug with no origin.
 *
 * Land hold: when ownership names product A but the job worktree lives under
 * product B, refuse — different git histories cannot land (wrong merge GC).
 * Push: still redirect cwd to ownership root so origin is correct even if the
 * worker ran in isolation (localRef may be explicit).
 */
export function resolveMergePushCwd(input: {
  readonly ownershipPaths?: readonly string[] | undefined;
  readonly worktreePath?: string | undefined;
  readonly sessionRepoPath?: string | undefined;
  readonly preferredSuperlioraRoots?: readonly string[];
  readonly preferredMetalslugRoots?: readonly string[];
  /**
   * `land` holds when worktree product ≠ ownership product.
   * `push` redirects to ownership root and only holds when the resolved push
   * root itself is foreign to ownership (should not happen after resolve).
   */
  readonly mode?: 'land' | 'push';
}): {
  readonly cwd?: string;
  readonly fromOwnership: boolean;
  readonly hold?: CrossOwnershipHoldResult;
} {
  const mode = input.mode ?? 'push';
  const ownershipRoot = resolveGitRootFromOwnership({
    ownershipPaths: input.ownershipPaths,
    sessionRepoPath: input.sessionRepoPath,
    preferredSuperlioraRoots: input.preferredSuperlioraRoots,
    preferredMetalslugRoots: input.preferredMetalslugRoots,
  });

  const candidate =
    ownershipRoot ??
    input.worktreePath?.trim() ??
    input.sessionRepoPath?.trim() ??
    undefined;

  // Land: refuse when isolation worktree is a different product than ownership
  // (metalslug-linked wt cannot merge into superliora main — and vice versa).
  if (mode === 'land' && input.worktreePath) {
    const worktreeHold = evaluateCrossOwnershipHold({
      ownershipPaths: input.ownershipPaths,
      targetRepoPath: input.worktreePath,
    });
    if (worktreeHold.hold) {
      return {
        cwd: candidate,
        fromOwnership: ownershipRoot !== undefined,
        hold: worktreeHold,
      };
    }
  }

  // Session/repoPath foreign to ownership without a successful ownership redirect.
  const sessionHold = evaluateCrossOwnershipHold({
    ownershipPaths: input.ownershipPaths,
    targetRepoPath: ownershipRoot ?? input.sessionRepoPath,
    worktreePath: ownershipRoot !== undefined ? undefined : input.worktreePath,
  });
  if (sessionHold.hold) {
    return {
      cwd: candidate,
      fromOwnership: ownershipRoot !== undefined,
      hold: sessionHold,
    };
  }

  return {
    cwd: candidate,
    fromOwnership: ownershipRoot !== undefined,
    hold: { hold: false },
  };
}
