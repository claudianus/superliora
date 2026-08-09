import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { resolveGuiUseWorkspaceRoot } from '../gui-use-workspace';
import {
  runSetupCommand,
  type SetupCommandOptions,
  type SetupCommandResult,
} from '../setup-command';

const CAMOUFOX_NPM_VERSION = '0.11.1';

export interface CamoufoxBinaryOptions {
  readonly cacheDir?: string | undefined;
  readonly binaryPath?: string | undefined;
}

export function resolveCamoufoxInstallDir(options: CamoufoxBinaryOptions = {}): string {
  if (options.cacheDir !== undefined) return options.cacheDir;
  const envPath = process.env['CAMOUFOX_INSTALL_DIR'];
  if (envPath !== undefined && envPath.length > 0) return envPath;
  if (process.platform === 'win32') return join(homedir(), 'AppData', 'Local', 'camoufox', 'camoufox', 'Cache');
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Caches', 'camoufox');
  return join(homedir(), '.cache', 'camoufox');
}

export function resolveCamoufoxBinaryPath(options: CamoufoxBinaryOptions = {}): string {
  if (options.binaryPath !== undefined) return options.binaryPath;
  const envPath = process.env['CAMOUFOX_EXECUTABLE_PATH'];
  if (envPath !== undefined && envPath.length > 0) return envPath;
  const root = resolveCamoufoxInstallDir(options);
  if (process.platform === 'win32') return join(root, 'camoufox.exe');
  if (process.platform === 'darwin') return join(root, 'Camoufox.app', 'Contents', 'MacOS', 'camoufox');
  return join(root, 'camoufox-bin');
}

export async function installCamoufoxBinary(
  options: SetupCommandOptions & CamoufoxBinaryOptions = {},
): Promise<SetupCommandResult> {
  return runCamoufoxCli(['fetch'], options);
}

export async function infoCamoufoxBinary(
  options: SetupCommandOptions & CamoufoxBinaryOptions = {},
): Promise<SetupCommandResult> {
  const installDir = resolveCamoufoxInstallDir(options);
  const binaryPath = resolveCamoufoxBinaryPath(options);
  const versionPath = join(installDir, 'version.json');
  if (!existsSync(versionPath) || !existsSync(binaryPath)) {
    return {
      ok: false,
      code: 1,
      stdout: '',
      stderr: `Camoufox binary not found under ${installDir}`,
      command: [binaryPath, '--version'],
      error: `Camoufox binary not found under ${installDir}`,
    };
  }

  try {
    const raw = readFileSync(versionPath, 'utf8');
    const parsed = JSON.parse(raw) as { version?: unknown; release?: unknown };
    const version = typeof parsed.version === 'string' ? parsed.version : 'unknown';
    const release = typeof parsed.release === 'string' ? parsed.release : 'unknown';
    return {
      ok: true,
      code: 0,
      stdout: `camoufox ${version}-${release}\npath: ${resolve(binaryPath)}\n`,
      stderr: '',
      command: [binaryPath, '--version'],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      code: 1,
      stdout: '',
      stderr: message,
      command: [binaryPath, '--version'],
      error: message,
    };
  }
}

/** Exposed for tests: how we invoke camoufox-js (workspace filter vs npx). */
export function resolveCamoufoxCliPlan(
  options: SetupCommandOptions = {},
): { readonly kind: 'workspace'; readonly cwd: string } | { readonly kind: 'npx' } {
  const workspaceRoot = resolveGuiUseWorkspaceRoot(options);
  if (workspaceRoot !== undefined) return { kind: 'workspace', cwd: workspaceRoot };
  return { kind: 'npx' };
}

async function runCamoufoxCli(
  args: readonly string[],
  options: SetupCommandOptions & CamoufoxBinaryOptions,
): Promise<SetupCommandResult> {
  const env = {
    ...process.env,
    ...options.env,
    CAMOUFOX_INSTALL_DIR: resolveCamoufoxInstallDir(options),
  };
  const plan = resolveCamoufoxCliPlan(options);
  if (plan.kind === 'workspace') {
    return runSetupCommand('corepack', [
      'pnpm',
      '--filter',
      '@superliora/gui-use',
      'exec',
      'camoufox-js',
      ...args,
    ], { ...options, cwd: plan.cwd, env });
  }
  return runSetupCommand(
    npxCommand(),
    ['--yes', `camoufox-js@${CAMOUFOX_NPM_VERSION}`, ...args],
    { ...options, env },
  );
}

function npxCommand(): string {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx';
}
