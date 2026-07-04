import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export interface SetupCommandOptions {
  readonly cwd?: string | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly timeoutMs?: number | undefined;
  readonly quiet?: boolean | undefined;
}

export interface SetupCommandResult {
  readonly ok: boolean;
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly command: readonly string[];
  readonly error?: string | undefined;
}

const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const CLOAKBROWSER_NPM_VERSION = '0.4.5';

export async function installCloakBrowser(options: SetupCommandOptions = {}): Promise<SetupCommandResult> {
  return runPnpmCloak(['install'], options);
}

export async function updateCloakBrowser(options: SetupCommandOptions = {}): Promise<SetupCommandResult> {
  return runPnpmCloak(['update'], options);
}

export async function infoCloakBrowser(options: SetupCommandOptions = {}): Promise<SetupCommandResult> {
  return runPnpmCloak(['info'], options);
}

export async function installCuaDriver(
  options: SetupCommandOptions = {},
): Promise<SetupCommandResult> {
  const command = cuaInstallCommand();
  if (command === undefined) {
    return {
      ok: false,
      code: null,
      stdout: '',
      stderr: `Unsupported platform for cua-driver: ${process.platform}`,
      command: [],
      error: 'unsupported platform',
    };
  }
  const [cmd, ...args] = command;
  if (cmd === undefined) {
    return {
      ok: false,
      code: null,
      stdout: '',
      stderr: 'Invalid empty cua-driver install command.',
      command: [],
      error: 'empty command',
    };
  }
  return runCommand(cmd, args, options);
}

export async function updateCuaDriver(
  options: SetupCommandOptions = {},
): Promise<SetupCommandResult> {
  return installCuaDriver(options);
}

export function statusCuaDriver(driverCmd = process.env['KIMI_CUA_DRIVER_CMD'] ?? process.env['HERMES_CUA_DRIVER_CMD'] ?? 'cua-driver'): {
  readonly installed: boolean;
  readonly version?: string | undefined;
  readonly error?: string | undefined;
} {
  const result = spawnSync(driverCmd, ['--version'], {
    encoding: 'utf8',
    timeout: 5000,
  });
  if (result.error !== undefined) {
    return { installed: false, error: result.error.message };
  }
  return {
    installed: result.status === 0,
    version: (result.stdout || result.stderr || '').trim() || undefined,
    error: result.status === 0 ? undefined : (result.stderr || result.stdout || '').trim(),
  };
}

function runPnpmCloak(
  args: readonly string[],
  options: SetupCommandOptions,
): Promise<SetupCommandResult> {
  const workspaceRoot = findWorkspaceRoot(options.cwd ?? process.cwd());
  if (workspaceRoot !== undefined && isGuiUseWorkspace(workspaceRoot)) {
    return runCommand('corepack', [
      'pnpm',
      '--filter',
      '@superliora/gui-use',
      'exec',
      'cloakbrowser',
      ...args,
    ], { ...options, cwd: workspaceRoot });
  }

  return runCommand(npxCommand(), [
    '--yes',
    `cloakbrowser@${CLOAKBROWSER_NPM_VERSION}`,
    ...args,
  ], options);
}

function isGuiUseWorkspace(workspaceRoot: string): boolean {
  return existsSync(resolve(workspaceRoot, 'packages/gui-use/package.json'));
}

function npxCommand(): string {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx';
}

function findWorkspaceRoot(start: string): string | undefined {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function cuaInstallCommand(): readonly string[] | undefined {
  if (process.platform === 'win32') {
    return [
      'powershell',
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      'irm https://raw.githubusercontent.com/trycua/cua/main/libs/cua-driver/scripts/install.ps1 | iex',
    ];
  }
  if (process.platform === 'darwin' || process.platform === 'linux') {
    return [
      '/bin/bash',
      '-c',
      'curl -fsSL https://raw.githubusercontent.com/trycua/cua/main/libs/cua-driver/scripts/install.sh | /bin/bash',
    ];
  }
  return undefined;
}

function runCommand(
  command: string,
  args: readonly string[],
  options: SetupCommandOptions,
): Promise<SetupCommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout.push(chunk);
      if (options.quiet !== true) process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr.push(chunk);
      if (options.quiet !== true) process.stderr.write(chunk);
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      resolve({
        ok: false,
        code: null,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        command: [command, ...args],
        error: error.message,
      });
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve({
        ok: code === 0,
        code,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        command: [command, ...args],
      });
    });
  });
}
