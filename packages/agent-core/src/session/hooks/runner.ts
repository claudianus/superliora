import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { statSync } from 'node:fs';

import { z } from 'zod';

import type { HookResult } from './types';

export interface RunHookOptions {
  readonly timeout: number;
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
  /** Exec-form argv; when set, spawn without shell. */
  readonly args?: readonly string[];
}

const DEFAULT_TIMEOUT_SECONDS = 30;
const KILL_GRACE_MS = 100;
const OptionalStringSchema = z.preprocess(
  (value) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
      return String(value);
    }
    return undefined;
  },
  z.string().optional(),
);
const HookSpecificOutputSchema = z.preprocess(
  (value) => (isRecord(value) ? value : undefined),
  z
    .looseObject({
      message: OptionalStringSchema,
      permissionDecision: z.unknown().optional(),
      permissionDecisionReason: OptionalStringSchema,
    })
    .optional(),
);
const HookJsonOutputSchema = z.looseObject({
  message: OptionalStringSchema,
  continue: z.unknown().optional(),
  stopReason: OptionalStringSchema,
  systemMessage: OptionalStringSchema,
  hookSpecificOutput: HookSpecificOutputSchema,
});

export async function runHook(
  command: string,
  input: Record<string, unknown>,
  options: RunHookOptions,
): Promise<HookResult> {
  let child: ChildProcessWithoutNullStreams;
  try {
    const useExec = options.args !== undefined;
    child = useExec
      ? spawn(command, [...options.args], {
          shell: false,
          cwd: options.cwd,
          stdio: 'pipe',
          detached: process.platform !== 'win32',
          env: options.env ? { ...process.env, ...options.env } : undefined,
        })
      : spawnShellForm(command, {
          cwd: options.cwd,
          env: options.env,
        });
  } catch (error) {
    return allowResult({ stderr: errorMessage(error) });
  }

  return new Promise<HookResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeoutMs = timeoutSeconds(options.timeout) * 1000;

    const cleanup = () => {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', onAbort);
    };

    const settle = (result: HookResult): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const timeout = setTimeout(() => {
      killProcess(child);
      settle(allowResult({ stdout, stderr, timedOut: true }));
    }, timeoutMs);

    const onAbort = (): void => {
      killProcess(child);
      settle(allowResult({ stdout, stderr }));
    };

    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted === true) {
      onAbort();
      return;
    }

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      settle(allowResult({ stdout, stderr: stderr + errorMessage(error) }));
    });
    child.on('close', (code) => {
      settle(hookResultFromOutput(code ?? 0, stdout, stderr));
    });

    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(input));
  });
}

function timeoutSeconds(timeout: number): number {
  return Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_SECONDS;
}

/**
 * Run a shell-form hook command.
 *
 * `spawn(command, { shell: true })` hands the string to cmd.exe / sh as-is:
 * an executable path containing spaces (`C:\Program Files\...\node.exe`) gets
 * cut at the first space, so every hook whose command points inside such a
 * path silently failed with "not recognized" on Windows. Quoting does not
 * help either — cmd.exe strips the outer quotes around the whole command
 * line.
 *
 * When the command starts with an existing executable path that contains
 * whitespace (and is not already quoted), split it off and spawn exec-form
 * instead: the executable is passed as argv[0] (no shell word-splitting) and
 * the rest of the line is parsed into argv with basic quote grouping.
 * Commands whose remainder needs real shell syntax (`|`, `&&`, redirection)
 * keep the shell path with a cmd-safe quoted executable prefix.
 */
function spawnShellForm(
  command: string,
  options: { readonly cwd?: string; readonly env?: Readonly<Record<string, string>> },
): ChildProcessWithoutNullStreams {
  const spawnOptions = {
    cwd: options.cwd,
    stdio: 'pipe' as const,
    detached: process.platform !== 'win32',
    env: options.env ? { ...process.env, ...options.env } : undefined,
  };

  const head = leadingExecutablePath(command);
  if (head !== undefined) {
    const rest = command.slice(command.indexOf(head) + head.length).trimStart();
    if (containsShellSyntax(rest)) {
      return spawn(`"${head}" ${rest}`, { shell: true, ...spawnOptions });
    }
    const argv = splitSimpleArgv(head, rest);
    return spawn(argv[0]!, argv.slice(1), { shell: false, ...spawnOptions });
  }
  return spawn(command, { shell: true, ...spawnOptions });
}

/**
 * Longest leading run of the command that resolves to an existing file.
 *
 * Tokens are merged greedily: a spaced executable (`C:\Program Files\...\node.exe`)
 * never exists as a single token, so each next token is appended until the
 * accumulated path exists on disk. Ordinary commands (`sh -c …`,
 * `python script.py`) stop early because the first token is the executable
 * and the second (a script name relative to cwd) does not extend it into a
 * file — those stay on the plain shell path.
 */
function leadingExecutablePath(command: string): string | undefined {
  const trimmed = command.trimStart();
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) return undefined;
  const tokens = trimmed.split(/\s+/).filter((token) => token.length > 0);
  if (tokens.length === 0) return undefined;

  let candidate = tokens[0]!;
  let found = isFile(candidate);
  for (let i = 1; !found && i < tokens.length; i++) {
    const next = `${candidate} ${tokens[i]}`;
    if (!isFile(next)) break;
    candidate = next;
    found = true;
  }
  if (!found) return undefined;
  // Only take over when the path itself carries a space; otherwise the plain
  // shell form already works and may rely on shell features.
  if (!candidate.includes(' ')) return undefined;
  return candidate;
}

function isFile(path: string): boolean {
  try {
    statSync(path).isFile();
    return true;
  } catch {
    return false;
  }
}

function containsShellSyntax(text: string): boolean {
  return /[|&<>;$]|\$\(/.test(text);
}

/** Split `head rest` into argv with double-quote grouping; no escapes. */
function splitSimpleArgv(head: string, rest: string): string[] {
  const argv: string[] = [head];
  if (rest.length === 0) return argv;
  for (const token of rest.match(/"[^"]*"|\S+/g) ?? []) {
    argv.push(token.startsWith('"') && token.endsWith('"') && token.length > 1 ? token.slice(1, -1) : token);
  }
  return argv;
}

/** Shared by command runner and http dispatch (body treated as stdout). */
export function hookResultFromOutput(
  exitCode: number,
  stdout: string,
  stderr: string,
): HookResult {
  if (exitCode === 2) {
    const message = stderr.trim();
    return {
      action: 'block',
      message,
      reason: message,
      stdout,
      stderr,
      exitCode,
    };
  }

  const structured = exitCode === 0 ? structuredOutput(stdout) : undefined;
  if (structured?.halt === true) {
    return {
      action: 'allow',
      halt: true,
      stopReason: structured.stopReason,
      systemMessage: structured.systemMessage,
      message: structured.message ?? structured.stopReason,
      reason: structured.stopReason,
      stdout,
      stderr,
      exitCode,
      structuredOutput: structured.structuredOutput,
    };
  }
  if (structured?.action === 'block') {
    return {
      action: 'block',
      message: structured.message ?? structured.reason,
      reason: structured.reason,
      systemMessage: structured.systemMessage,
      stdout,
      stderr,
      exitCode,
      structuredOutput: structured.structuredOutput,
    };
  }

  return allowResult({
    message: structured?.message,
    systemMessage: structured?.systemMessage,
    stdout,
    stderr,
    exitCode,
    structuredOutput: structured?.structuredOutput,
  });
}

function structuredOutput(
  stdout: string,
): {
  action?: 'block';
  halt?: boolean;
  stopReason?: string;
  systemMessage?: string;
  reason?: string;
  message?: string;
  structuredOutput: true;
} | undefined {
  const text = stdout.trim();
  if (text.length === 0) return undefined;

  try {
    const parsed = JSON.parse(text) as unknown;
    const output = HookJsonOutputSchema.safeParse(parsed);
    if (!output.success) return undefined;

    const {
      message,
      hookSpecificOutput,
      continue: continueFlag,
      stopReason,
      systemMessage,
    } = output.data;
    const resolvedMessage = message ?? hookSpecificOutput?.message;
    const resolvedSystemMessage =
      typeof systemMessage === 'string' && systemMessage.trim().length > 0
        ? systemMessage.trim()
        : undefined;
    // Claude Agent Teams / Stop: continue:false stops the teammate entirely.
    if (continueFlag === false) {
      const reason =
        typeof stopReason === 'string' && stopReason.trim().length > 0
          ? stopReason.trim()
          : resolvedMessage ?? 'Stopped by hook (continue: false)';
      return {
        halt: true,
        stopReason: reason,
        systemMessage: resolvedSystemMessage,
        message: resolvedMessage,
        structuredOutput: true,
      };
    }
    if (hookSpecificOutput?.permissionDecision !== 'deny') {
      return {
        message: resolvedMessage,
        systemMessage: resolvedSystemMessage,
        structuredOutput: true,
      };
    }
    return {
      action: 'block',
      message: resolvedMessage,
      reason: hookSpecificOutput.permissionDecisionReason,
      systemMessage: resolvedSystemMessage,
      structuredOutput: true,
    };
  } catch {
    return undefined;
  }
}

function allowResult(input: {
  readonly message?: string;
  readonly systemMessage?: string;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode?: number;
  readonly timedOut?: boolean;
  readonly structuredOutput?: boolean;
}): HookResult {
  return {
    action: 'allow',
    message: input.message,
    systemMessage: input.systemMessage,
    stdout: input.stdout,
    stderr: input.stderr,
    exitCode: input.exitCode,
    timedOut: input.timedOut,
    structuredOutput: input.structuredOutput,
  };
}

function killProcess(child: ChildProcessWithoutNullStreams): void {
  tryKillProcess(child, 'SIGTERM');
  const killTimer = setTimeout(() => {
    tryKillProcess(child, 'SIGKILL');
  }, KILL_GRACE_MS);
  killTimer.unref();
}

function tryKillProcess(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): void {
  if (process.platform === 'win32') {
    // On Windows, `ChildProcess.kill()` only signals the shell spawned by
    // `shell: true`, leaving grandchildren (the actual hook command) alive
    // and holding the cwd. `taskkill /T` terminates the whole process tree.
    killProcessTreeWindows(child, signal === 'SIGKILL');
    return;
  }
  try {
    if (child.pid !== undefined) {
      process.kill(-child.pid, signal);
    } else {
      child.kill(signal);
    }
  } catch {
    try {
      child.kill(signal);
    } catch {}
  }
}

function killProcessTreeWindows(child: ChildProcessWithoutNullStreams, _force: boolean): void {
  if (child.pid === undefined) return;
  // Unforced `taskkill /T` sends WM_CLOSE, which node.exe with a live
  // interval/timeout ignores. Always `/F` so hook timeout and session-close
  // actually reap the process tree on Windows.
  const args = ['/T', '/F', '/PID', String(child.pid)];
  try {
    const killer = spawn('taskkill', args, { stdio: 'ignore', windowsHide: true });
    killer.once('error', () => {});
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {}
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
