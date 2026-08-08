import { spawn } from 'node:child_process';

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

const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const KILL_ESCALATE_MS = 2_000;
const FORCE_SETTLE_MS = 1_000;

/**
 * Spawn a setup/install command with wall-clock timeout and optional AbortSignal.
 * Timeout/abort: SIGTERM → SIGKILL → force-resolve so callers never hang forever.
 */
export function runSetupCommand(
  command: string,
  args: readonly string[],
  options: SetupCommandOptions = {},
): Promise<SetupCommandResult> {
  const cmd = [command, ...args] as const;
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
    const child = spawn(command, [...args], {
      cwd: options.cwd ?? options.packageRoot,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
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

    child.stdout.on('data', (chunk: Buffer) => {
      stdout.push(chunk);
      if (options.quiet !== true) process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr.push(chunk);
      if (options.quiet !== true) process.stderr.write(chunk);
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
