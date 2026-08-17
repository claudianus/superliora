import { updateBrowserUseRuntimes, updateCuaDriver } from '@superliora/gui-use';

import { tryGetHostPackageRoot } from '#/cli/version';
import { ensureRuntimePrereqs } from './runtime-prereqs';

export interface GuiUseRefreshResult {
  readonly browserOk: boolean;
  readonly computerOk: boolean;
  readonly gitOk: boolean;
  readonly warnings: readonly string[];
}

const SKIPPED_REFRESH: GuiUseRefreshResult = {
  browserOk: false,
  computerOk: false,
  gitOk: true,
  warnings: [],
};

/**
 * Soft-refresh browser-use / CUA sidecars after a successful upgrade.
 * Failures never throw — callers surface warnings as they prefer.
 * Native SEA installs have no source `package.json`; skip (installer already
 * handled sidecars) instead of throwing from a default package-root lookup.
 */
export async function refreshGuiUseAfterUpgrade(
  packageRoot?: string,
): Promise<GuiUseRefreshResult> {
  let resolvedRoot: string | undefined;
  try {
    resolvedRoot = packageRoot ?? tryGetHostPackageRoot();
  } catch (error) {
    return {
      browserOk: false,
      computerOk: false,
      gitOk: true,
      warnings: [`sidecar refresh skipped: ${formatError(error)}`],
    };
  }
  if (resolvedRoot === undefined) {
    return SKIPPED_REFRESH;
  }
  return refreshGuiUseAtPackageRoot(resolvedRoot);
}

async function refreshGuiUseAtPackageRoot(packageRoot: string): Promise<GuiUseRefreshResult> {
  const warnings: string[] = [];
  let browserOk = false;
  let computerOk = false;
  let gitOk = true;

  try {
    const git = await ensureRuntimePrereqs(packageRoot);
    gitOk = git.gitOk;
    if (git.warning) warnings.push(git.warning);
  } catch (error) {
    gitOk = false;
    warnings.push(`Git bootstrap failed: ${formatError(error)}`);
  }

  try {
    const result = await updateBrowserUseRuntimes({ packageRoot, quiet: true });
    browserOk = result.ok;
    if (!result.ok) {
      const detail = result.error ?? firstNonEmpty(result.stderr, result.stdout);
      warnings.push(
        detail.length > 0
          ? `browser-use refresh failed: ${detail}`
          : 'browser-use refresh failed',
      );
    }
  } catch (error) {
    warnings.push(`browser-use refresh failed: ${formatError(error)}`);
  }

  try {
    const result = await updateCuaDriver({ cwd: packageRoot, quiet: true });
    computerOk = result.ok;
    if (!result.ok) {
      const detail = result.error ?? firstNonEmpty(result.stderr, result.stdout);
      warnings.push(
        detail.length > 0 ? `CUA refresh failed: ${detail}` : 'CUA refresh failed',
      );
    }
  } catch (error) {
    warnings.push(`CUA refresh failed: ${formatError(error)}`);
  }

  return { browserOk, computerOk, gitOk, warnings };
}

function firstNonEmpty(...values: readonly string[]): string {
  return values.map((value) => value.trim()).find((value) => value.length > 0) ?? '';
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
