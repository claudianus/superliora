import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { tryGetHostPackageRoot } from '#/cli/version';

export interface RuntimePrereqResult {
  readonly gitOk: boolean;
  readonly gitBootstrapped: boolean;
  readonly terminalOk: boolean;
  readonly pnpmOk: boolean;
  readonly pnpmBootstrapped: boolean;
  readonly warning?: string;
}

/**
 * After upgrade (or when the source tree is present), re-run the installer
 * Git bootstrap so a missing Git Bash is filled in on Windows.
 */
function resolveInstallScript(packageRoot: string, fileName: string): string | undefined {
  const candidates = [
    join(packageRoot, 'scripts/install', fileName),
    join(packageRoot, '..', 'scripts/install', fileName),
    join(packageRoot, '..', '..', 'scripts/install', fileName),
  ];
  return candidates.find((path) => existsSync(path));
}

export async function ensureRuntimePrereqs(
  packageRoot?: string,
): Promise<RuntimePrereqResult> {
  const resolvedRoot = packageRoot ?? tryGetHostPackageRoot();
  if (resolvedRoot === undefined) {
    return {
      gitOk: true,
      gitBootstrapped: false,
      terminalOk: true,
      pnpmOk: true,
      pnpmBootstrapped: false,
    };
  }
  return ensureRuntimePrereqsAt(resolvedRoot);
}

async function ensureRuntimePrereqsAt(
  packageRoot: string,
): Promise<RuntimePrereqResult> {
  const gitScript = resolveInstallScript(packageRoot, 'ensure-git.mjs');
  const terminalScript = resolveInstallScript(packageRoot, 'ensure-terminal.mjs');
  const pnpmScript = resolveInstallScript(packageRoot, 'ensure-pnpm.mjs');
  if (gitScript === undefined && terminalScript === undefined && pnpmScript === undefined) {
    return {
      gitOk: true,
      gitBootstrapped: false,
      terminalOk: true,
      pnpmOk: true,
      pnpmBootstrapped: false,
    };
  }

  const warnings: string[] = [];
  let gitOk = true;
  let gitBootstrapped = false;
  let terminalOk = true;
  let pnpmOk = true;
  let pnpmBootstrapped = false;

  if (gitScript !== undefined) {
    try {
      const mod = (await import(pathToFileURL(gitScript).href)) as {
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
        gitOk = false;
        if (result.message) warnings.push(result.message);
      } else {
        gitBootstrapped = result.bootstrapped === true;
      }
    } catch (error) {
      gitOk = false;
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Git bootstrap failed: ${message}`);
    }
  }

  if (terminalScript !== undefined) {
    try {
      const mod = (await import(pathToFileURL(terminalScript).href)) as {
        ensureTerminal: (opts?: { noShellRc?: boolean }) => Promise<{
          ok?: boolean;
          skipped?: boolean;
          message?: string;
        }>;
      };
      const result = await mod.ensureTerminal({
        noShellRc: true,
        // Upgrade must not install packages; only refresh fragment/shortcut when wt.exe exists.
        skipPackages: true,
        runWinget: () => ({ status: 1, message: 'skipped during upgrade' }),
        fetchLatestRelease: async () => undefined,
      });
      if (result.ok === false) {
        terminalOk = false;
        if (result.message) warnings.push(result.message);
      }
    } catch (error) {
      terminalOk = false;
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Windows Terminal setup failed: ${message}`);
    }
  }

  if (pnpmScript !== undefined) {
    try {
      const mod = (await import(pathToFileURL(pnpmScript).href)) as {
        ensurePnpm: (opts?: { noShellRc?: boolean }) => Promise<{
          cmd?: string;
          bootstrapped?: boolean;
          missing?: boolean;
        }>;
      };
      const result = await mod.ensurePnpm({ noShellRc: true });
      if (result.missing || !result.cmd) {
        pnpmOk = false;
        warnings.push('pnpm bootstrap failed');
      } else {
        pnpmBootstrapped = result.bootstrapped === true;
      }
    } catch (error) {
      pnpmOk = false;
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`pnpm bootstrap failed: ${message}`);
    }
  }

  return {
    gitOk,
    gitBootstrapped,
    terminalOk,
    pnpmOk,
    pnpmBootstrapped,
    warning: warnings.length > 0 ? warnings.join(' ') : undefined,
  };
}
