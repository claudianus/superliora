import type { Kaos, KaosProcess } from '@superliora/kaos';
import type { Readable } from 'node:stream';

const DEFAULT_TIMEOUT_MS = 60_000;
const GIT_OUTPUT_CAP_CHARS = 10 * 1024 * 1024;
export interface GitCommandResult {
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly outputTruncated?: boolean;
  readonly spawnFailed?: boolean;
}

export function hasUnsettledExecutionResources(error: unknown): boolean {
  return (error !== null && typeof error === 'object' && 'resourcesSettled' in error && error.resourcesSettled === false)
    || (error instanceof AggregateError && error.errors.some(hasUnsettledExecutionResources));
}

export class NativeProcessCleanupError extends Error {
  readonly code = 'native_process_cleanup_failed';
  private disposed = false;
  constructor(private readonly proc: KaosProcess, private exitConfirmed: boolean, cause: unknown) {
    super(`Native process cleanup failed${cause === undefined ? '.' : `: ${cause instanceof Error ? cause.message : String(cause)}`}`, { cause });
  }
  get resourcesSettled(): boolean {
    return this.proc.resourcesSettled ?? (this.exitConfirmed && this.disposed);
  }
  async settleResources(): Promise<void> {
    if (this.resourcesSettled) return;
    const errors: unknown[] = [];
    if (!this.exitConfirmed) {
      try { await this.proc.kill('SIGKILL'); } catch (error) { errors.push(error); }
      try {
        await this.proc.wait();
        this.exitConfirmed = true;
      } catch (error) {
        errors.push(error);
      }
    }
    try {
      await this.proc.dispose();
      this.disposed = true;
    } catch (error) {
      errors.push(error);
    }
    if (!this.resourcesSettled) throw new AggregateError([...errors, this], 'Native process cleanup failed.');
  }
}

export function runGit(kaos: Kaos, cwd: string, args: readonly string[], timeoutMs = DEFAULT_TIMEOUT_MS, signal?: AbortSignal): Promise<GitCommandResult> {
  return runCommand(kaos, ['git', '--no-pager', '-C', cwd, ...args], timeoutMs, signal);
}
export function runGh(kaos: Kaos, args: readonly string[], timeoutMs = DEFAULT_TIMEOUT_MS, signal?: AbortSignal): Promise<GitCommandResult> {
  return runCommand(kaos, ['gh', ...args], timeoutMs, signal);
}

async function runCommand(kaos: Kaos, args: readonly string[], timeoutMs: number, signal?: AbortSignal): Promise<GitCommandResult> {
  signal?.throwIfAborted();
  let proc: KaosProcess;
  try {
    proc = await kaos.exec(...args);
  } catch (error) {
    if (hasUnsettledExecutionResources(error)) throw error;
    return { ok: false, spawnFailed: true, stdout: '', stderr: error instanceof Error ? error.message : String(error), exitCode: null };
  }
  try { proc.stdin.end(); } catch { /* stdin may already be closed */ }
  const stop = (): void => { void proc.kill('SIGKILL').catch(() => {}); };
  let timer: NodeJS.Timeout | undefined;
  if (timeoutMs > 0) timer = setTimeout(stop, timeoutMs);
  if (signal?.aborted) stop();
  else signal?.addEventListener('abort', stop, { once: true });
  const wait = proc.wait();
  let exitConfirmed = false;
  void wait.then(() => { exitConfirmed = true; }, () => {});
  const [stdout, stderr, exit] = await Promise.allSettled([
    collect(proc.stdout, GIT_OUTPUT_CAP_CHARS),
    collect(proc.stderr, GIT_OUTPUT_CAP_CHARS),
    wait,
  ]);
  clearTimeout(timer);
  signal?.removeEventListener('abort', stop);
  try {
    await proc.dispose();
    if (proc.resourcesSettled === false || (!exitConfirmed && proc.resourcesSettled !== true)) {
      throw new NativeProcessCleanupError(proc, exitConfirmed, exit.status === 'rejected' ? exit.reason : undefined);
    }
  } catch (error) {
    if (error instanceof NativeProcessCleanupError) throw error;
    throw new NativeProcessCleanupError(proc, exitConfirmed, error);
  }
  if (stdout.status === 'rejected') throw stdout.reason;
  if (stderr.status === 'rejected') throw stderr.reason;
  if (exit.status === 'rejected') throw exit.reason;
  return {
    ok: exit.value === 0,
    stdout: stdout.value.text,
    stderr: stderr.value.text,
    exitCode: exit.value,
    ...(stdout.value.truncated || stderr.value.truncated ? { outputTruncated: true } : {}),
  };
}

async function collect(stream: Readable, cap: number): Promise<{ text: string; truncated: boolean }> {
  stream.setEncoding('utf8');
  let text = '';
  let truncated = false;
  for await (const chunk of stream) {
    const value = String(chunk);
    const remaining = cap - text.length;
    if (value.length > remaining) truncated = true;
    if (remaining > 0) text += value.length > remaining ? value.slice(0, remaining) : value;
  }
  return { text, truncated };
}
export function createWorktree(kaos: Kaos, root: string, target: string, branch: string, base: string, signal?: AbortSignal): Promise<GitCommandResult> {
  return runGit(kaos, root, ['worktree', 'add', '-b', branch, target, base], 0, signal);
}
/** Reattach an existing branch to a worktree path (`git worktree add <path> <branch>`). */
export function attachWorktree(kaos: Kaos, root: string, target: string, branch: string, signal?: AbortSignal): Promise<GitCommandResult> {
  return runGit(kaos, root, ['worktree', 'add', target, branch], 0, signal);
}
export async function removeWorktree(kaos: Kaos, root: string, target: string, signal?: AbortSignal): Promise<void> {
  const removal = await runGit(kaos, root, ['worktree', 'remove', '--force', target], 0, signal);
  if (!removal.ok) throw new Error(removal.stderr || `Git worktree remove exited with ${String(removal.exitCode)}.`);
}

export interface GhCliAuthStatus {
  readonly state: 'ok' | 'logged_out' | 'binary_missing' | 'unknown';
  readonly account?: string;
  readonly detail?: string;
}

function parseGhAccountLogin(stdout: string): string | undefined {
  const login = stdout.trim();
  return login.length > 0 && !login.startsWith('{') ? login : undefined;
}

/** Probe GitHub CLI credentials without reading its sensitive config files. */
export async function checkGhCliAuth(
  kaos: Kaos,
  options: { readonly timeoutMs?: number } = {},
): Promise<GhCliAuthStatus> {
  const res = await runGh(kaos, ['api', 'user', '--jq', '.login'], options.timeoutMs ?? 15_000);
  if (res.ok) {
    return { state: 'ok', account: parseGhAccountLogin(res.stdout) };
  }
  const blob = `${res.stderr}\n${res.stdout}`.toLowerCase();
  if (blob.includes('executable file not found') || blob.includes('no such file') || blob.includes('command not found')) {
    return {
      state: 'binary_missing',
      detail: 'gh CLI is not installed (https://cli.github.com). Remote push and GitHub Pages enable cannot run.',
    };
  }
  if (blob.includes('gh auth login') || blob.includes('401') || blob.includes('unauthorized') || blob.includes('not logged in') || blob.includes('no accessible token')) {
    return {
      state: 'logged_out',
      detail: 'GitHub CLI is not logged in. Run `gh auth login` (or /github-connect in the TUI) and retry the push.',
    };
  }
  return {
    state: 'unknown',
    detail: `gh auth probe failed (exit ${String(res.exitCode)}): ${(res.stderr || res.stdout).trim().slice(0, 200)}`,
  };
}
