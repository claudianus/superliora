import { spawn } from 'node:child_process';
import { extname } from 'node:path';

export interface SetupCommandOptions {
  readonly cwd?: string | undefined;
  readonly packageRoot?: string | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly timeoutMs?: number | undefined;
  readonly quiet?: boolean | undefined;
  /** Abort mid-flight install/info spawns (SIGTERM, then SIGKILL). */
  readonly signal?: AbortSignal | undefined;
}

export interface SetupCommandResult {
  readonly ok: boolean;
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly command: readonly string[];
  readonly error?: string | undefined;
}

export interface SetupSpawnResolution {
  readonly command: string;
  readonly args: readonly string[];
  readonly windowsVerbatimArguments?: boolean | undefined;
  readonly displayCommand: readonly string[];
}

export interface ResolveSetupSpawnOptions {
  readonly platform?: NodeJS.Platform | undefined;
  readonly comspec?: string | undefined;
}

const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const KILL_ESCALATE_MS = 2_000;
const FORCE_SETTLE_MS = 1_000;

const WINDOWS_CMD_SHIMS = new Set(['npx', 'npm', 'pnpm', 'corepack', 'yarn']);

function quoteWindowsCmdArg(value: string): string {
  if (value.length === 0) return '""';
  if (!/[\s"]/.test(value)) return value;
  return `"${value.replaceAll(/"/g, '\\"')}"`;
}

/**
 * Windows cannot spawn `.cmd` / `.bat` (or extensionless npm shims) with `shell: false`.
 * Node reports `EINVAL`. Route those through `cmd.exe /d /s /c` instead.
 */
export function needsWindowsCmdWrapper(
  command: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform !== 'win32') return false;
  const base = command.replaceAll(/\\/g, '/').split('/').pop() ?? command;
  const ext = extname(base).toLowerCase();
  if (ext === '.cmd' || ext === '.bat') return true;
  if (ext === '.exe' || ext === '.com' || ext === '.mjs' || ext === '.js' || ext === '.ps1') {
    return false;
  }
  const stem = ext.length > 0 ? base.slice(0, -ext.length) : base;
  return WINDOWS_CMD_SHIMS.has(stem.toLowerCase());
}

export function resolveSetupSpawn(
  command: string,
  args: readonly string[],
  options: ResolveSetupSpawnOptions = {},
): SetupSpawnResolution {
  const platform = options.platform ?? process.platform;
  const displayCommand = [command, ...args] as const;
  if (!needsWindowsCmdWrapper(command, platform)) {
    return { command, args, displayCommand };
  }
  const comspec = options.comspec ?? process.env['ComSpec'] ?? 'cmd.exe';
  const cmdline = [command, ...args].map(quoteWindowsCmdArg).join(' ');
  return {
    command: comspec,
    args: ['/d', '/s', '/c', cmdline],
    windowsVerbatimArguments: true,
    displayCommand,
  };
}

/**
 * Spawn a setup/install command with wall-clock timeout and optional AbortSignal.
 * Timeout/abort: SIGTERM → SIGKILL → force-resolve so callers never hang forever.
 */
export function runSetupCommand(
  command: string,
  args: readonly string[],
  options: SetupCommandOptions = {},
): Promise<SetupCommandResult> {
  const spawned = resolveSetupSpawn(command, args);
  const cmd = spawned.displayCommand;
  if (options.signal?.aborted) {
    return Promise.resolve({
      ok: false,
      code: null,
      stdout: '',
      stderr: '',
      command: cmd,
      error: 'Aborted',
    });
  }

  return new Promise((resolve) => {
    const child = spawn(spawned.command, [...spawned.args], {
      cwd: options.cwd ?? options.packageRoot,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      windowsVerbatimArguments: spawned.windowsVerbatimArguments,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    let killEscalation: ReturnType<typeof setTimeout> | undefined;
    let forceSettle: ReturnType<typeof setTimeout> | undefined;

    const finish = (result: SetupCommandResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (killEscalation !== undefined) clearTimeout(killEscalation);
      if (forceSettle !== undefined) clearTimeout(forceSettle);
      options.signal?.removeEventListener('abort', onAbort);
      resolve(result);
    };

    const stopChild = (reason: string): void => {
      try {
        child.kill('SIGTERM');
      } catch {
        // already dead
      }
      killEscalation = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // already dead
        }
      }, KILL_ESCALATE_MS);
      forceSettle = setTimeout(() => {
        finish({
          ok: false,
          code: null,
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
          command: cmd,
          error: reason,
        });
      }, KILL_ESCALATE_MS + FORCE_SETTLE_MS);
    };

    const onAbort = (): void => {
      stopChild('Aborted');
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    const timeout = setTimeout(() => {
      stopChild(`Timed out after ${String(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)}ms`);
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    // Default quiet: live echo onto process.stdio corrupts a raw-mode TUI.
    // Opt in with `quiet: false` only for dedicated CLI progress surfaces.
    child.stdout.on('data', (chunk: Buffer) => {
      stdout.push(chunk);
      if (options.quiet === false) process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr.push(chunk);
      if (options.quiet === false) process.stderr.write(chunk);
    });
    child.on('error', (error) => {
      finish({
        ok: false,
        code: null,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        command: cmd,
        error: error.message,
      });
    });
    child.on('close', (code) => {
      finish({
        ok: code === 0,
        code,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        command: cmd,
      });
    });
  });
}
