/**
 * Worker security guards for Conductor execution lane.
 * - No git push / force-push from workers
 * - Prefer worktree-root writes (caller may combine with kaos path guards)
 */

export interface WorkerShellGuardResult {
  readonly allowed: boolean;
  readonly reason?: string;
}

/** Detect remote-mutating git commands that workers must not run. */
export function isWorkerForbiddenGitRemoteCommand(command: string): boolean {
  const c = command.trim();
  if (c.length === 0) return false;
  // git push / git push --force / git push origin HEAD etc.
  if (/(?:^|[;&|\n]|&&|\|\|)\s*git\s+push\b/i.test(c)) return true;
  // gh pr merge --admin that pushes; keep narrow: git push only per product lock
  if (/(?:^|[;&|\n]|&&|\|\|)\s*git\s+send-pack\b/i.test(c)) return true;
  return false;
}

export function guardWorkerShellCommand(
  command: string,
  options?: { readonly isWorker?: boolean },
): WorkerShellGuardResult {
  if (options?.isWorker !== true) {
    return { allowed: true };
  }
  if (isWorkerForbiddenGitRemoteCommand(command)) {
    return {
      allowed: false,
      reason:
        'Conductor workers must not push (or force-push) to remotes. Local commits in the job worktree are OK; remote publish is PushJob / Push Preview (user-gated offload).',
    };
  }
  return { allowed: true };
}

/**
 * True when path escapes job worktree root (string prefix check; resolve before call).
 */
export function isPathOutsideWorktree(worktreeRoot: string, targetPath: string): boolean {
  const root = worktreeRoot.replace(/\/+$/, '');
  const target = targetPath;
  if (root.length === 0) return false;
  if (target === root) return false;
  if (target.startsWith(`${root}/`)) return false;
  // relative that clearly walks up
  if (target.startsWith('..')) return true;
  // absolute different prefix
  if (target.startsWith('/') && !target.startsWith(`${root}/`) && target !== root) {
    return true;
  }
  return false;
}
