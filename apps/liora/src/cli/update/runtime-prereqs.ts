import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { getHostPackageRoot } from '#/cli/version';

export interface RuntimePrereqResult {
  readonly gitOk: boolean;
  readonly gitBootstrapped: boolean;
  readonly warning?: string;
}

/**
 * After upgrade (or when the source tree is present), re-run the installer
 * Git bootstrap so a missing Git Bash is filled in on Windows.
 */
function resolveEnsureGitScript(packageRoot: string): string | undefined {
  const candidates = [
    join(packageRoot, 'scripts/install/ensure-git.mjs'),
    join(packageRoot, '..', 'scripts/install/ensure-git.mjs'),
    join(packageRoot, '..', '..', 'scripts/install/ensure-git.mjs'),
  ];
  return candidates.find((path) => existsSync(path));
}

export async function ensureRuntimePrereqs(
  packageRoot: string = getHostPackageRoot(),
): Promise<RuntimePrereqResult> {
  const script = resolveEnsureGitScript(packageRoot);
  if (script === undefined) {
    return { gitOk: true, gitBootstrapped: false };
  }
  try {
    const mod = (await import(pathToFileURL(script).href)) as {
      ensureGit: (opts?: { noShellRc?: boolean }) => Promise<{
        bootstrapped?: boolean;
        missing?: boolean;
        message?: string;
        bashPath?: string;
        gitPath?: string;
      }>;
    };
    const result = await mod.ensureGit();
    if (result.missing) {
      return {
        gitOk: false,
        gitBootstrapped: false,
        warning: result.message,
      };
    }
    return { gitOk: true, gitBootstrapped: result.bootstrapped === true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { gitOk: false, gitBootstrapped: false, warning: `Git bootstrap failed: ${message}` };
  }
}
