import { updateBrowserUseRuntimes, updateCuaDriver } from '@superliora/gui-use';

import { getHostPackageRoot } from '#/cli/version';

export interface GuiUseRefreshResult {
  readonly browserOk: boolean;
  readonly computerOk: boolean;
  readonly warnings: readonly string[];
}

/**
 * Soft-refresh browser-use / CUA sidecars after a successful upgrade.
 * Failures never throw — callers surface warnings as they prefer.
 */
export async function refreshGuiUseAfterUpgrade(
  packageRoot: string = getHostPackageRoot(),
): Promise<GuiUseRefreshResult> {
  const warnings: string[] = [];
  let browserOk = false;
  let computerOk = false;

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

  return { browserOk, computerOk, warnings };
}

function firstNonEmpty(...values: readonly string[]): string {
  return values.map((value) => value.trim()).find((value) => value.length > 0) ?? '';
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
