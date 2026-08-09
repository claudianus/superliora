import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import type { SetupCommandOptions } from './setup-command';

/** Resolve the directory used to discover a SuperLiora / gui-use workspace. */
export function resolveInstallCwd(options: SetupCommandOptions): string {
  return options.packageRoot ?? options.cwd ?? process.cwd();
}

/** Walk parents for `pnpm-workspace.yaml`. */
export function findWorkspaceRoot(start: string): string | undefined {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** True when the workspace contains this package (monorepo checkout). */
export function isGuiUseWorkspace(workspaceRoot: string): boolean {
  return existsSync(resolve(workspaceRoot, 'packages/gui-use/package.json'));
}

/**
 * Prefer `pnpm --filter @superliora/gui-use exec <bin>` inside this monorepo;
 * otherwise callers should fall back to npx.
 */
export function resolveGuiUseWorkspaceRoot(
  options: SetupCommandOptions,
): string | undefined {
  const workspaceRoot = findWorkspaceRoot(resolveInstallCwd(options));
  if (workspaceRoot === undefined) return undefined;
  if (!isGuiUseWorkspace(workspaceRoot)) return undefined;
  return workspaceRoot;
}
