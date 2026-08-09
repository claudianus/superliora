/**
 * Detect cwd nested under a git root (F11). Pure + thin spawn wrapper.
 */

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { ttui } from '#/tui/utils/tui-i18n';

export interface CwdBelowGitRoot {
  readonly cwd: string;
  readonly gitRoot: string;
}

export function formatCwdBelowGitRootNotice(info: CwdBelowGitRoot): {
  readonly title: string;
  readonly detail: string;
} {
  return {
    title: ttui('tui.notice.cwdBelowGitRoot.title'),
    detail: info.gitRoot,
  };
}

/**
 * When `cwd` is inside a git work tree but not the toplevel, return both paths.
 * Returns undefined when not a repo, equal after resolve, or git is unavailable.
 */
export function detectCwdBelowGitRoot(
  cwd: string,
  runGit: (cwd: string) => string | undefined = defaultShowToplevel,
): CwdBelowGitRoot | undefined {
  const root = runGit(cwd)?.trim();
  if (root === undefined || root.length === 0) return undefined;
  const resolvedCwd = resolve(cwd);
  const resolvedRoot = resolve(root);
  if (resolvedCwd === resolvedRoot) return undefined;
  // cwd must be under root (nested open), not a sibling path.
  const prefix = resolvedRoot.endsWith('/') ? resolvedRoot : `${resolvedRoot}/`;
  if (!resolvedCwd.startsWith(prefix) && resolvedCwd !== resolvedRoot) {
    // Still surface when git reports a different toplevel (submodule / weird mounts).
    if (!resolvedCwd.startsWith(resolvedRoot)) return undefined;
  }
  return { cwd: resolvedCwd, gitRoot: resolvedRoot };
}

function defaultShowToplevel(cwd: string): string | undefined {
  try {
    const result = spawnSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      timeout: 500,
    });
    if (result.status !== 0) return undefined;
    const out = (result.stdout ?? '').trim();
    return out.length === 0 ? undefined : out;
  } catch {
    return undefined;
  }
}
