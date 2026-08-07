/**
 * Goal gate command — a user-set shell command that must pass before the goal
 * may complete (Prime Agent's `--autonomous-gate` equivalent).
 *
 * Semantics:
 * - Runs on every `markComplete` attempt while the goal carries `gateCommand`.
 * - A failed gate rejects completion with the bounded output tail, so the
 *   autonomous loop gets concrete repair evidence instead of a bare "no".
 * - A failed gate is NOT re-run while the workspace is unchanged since the
 *   last attempt (git status + diff + untracked-stat hash) — the cached
 *   failure is replayed. This kills reject→retry loops that burn turns
 *   without touching files.
 * - Failures are counted per command; once `maxRetries` is exceeded the gate
 *   reports `gate_retry_exhausted` so the caller can park the goal instead of
 *   burning the whole budget on an unfixable verifier.
 * - Outside a git worktree (or a repo without HEAD) the hash is unavailable,
 *   so the gate always runs.
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readlink } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { CompletionAuditRejection } from './completion-audit';

export const GOAL_GATE_TIMEOUT_MS = 120_000;
/** Bounded output tail returned to the model on gate failure. */
export const GOAL_GATE_OUTPUT_TAIL_CHARS = 4_000;
/** Failed attempts tolerated before the gate gives up (Prime parity: 3). */
export const GOAL_GATE_MAX_RETRIES = 3;

export interface GateRunResult {
  readonly ok: boolean;
  readonly detail: string;
}

export interface GateAttempt {
  /** Command the attempt ran against — a stale cache is dropped when the goal's gateCommand changes. */
  readonly command: string;
  readonly workspaceHash: string | null;
  readonly result: GateRunResult;
  /** Consecutive failures for this command (cached replays included). */
  readonly attempts: number;
}

export interface RunGoalGateOptions {
  readonly command: string;
  readonly cwd: string;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  /** Injected for tests. */
  readonly run?: (command: string, cwd: string, timeoutMs: number) => Promise<GateRunResult>;
  readonly workspaceHash?: (cwd: string) => Promise<string | null>;
}

export type GateAuditOutcome =
  | { readonly kind: 'passed' }
  | { readonly kind: 'failed'; readonly rejection: CompletionAuditRejection }
  | { readonly kind: 'exhausted'; readonly rejection: CompletionAuditRejection };

/**
 * Evaluate the gate for a completion attempt. `lastAttempt` carries the
 * previous failure cache; pass it in and store the returned attempt.
 */
export async function auditGoalGate(
  options: RunGoalGateOptions,
  lastAttempt: GateAttempt | undefined,
): Promise<{ readonly outcome: GateAuditOutcome; readonly attempt: GateAttempt | undefined }> {
  const timeoutMs = options.timeoutMs ?? GOAL_GATE_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? GOAL_GATE_MAX_RETRIES;
  const hashFn = options.workspaceHash ?? gitWorkspaceHash;
  const workspaceHash = await hashFn(options.cwd);
  const prior = lastAttempt?.command === options.command ? lastAttempt : undefined;

  if (prior !== undefined && !prior.result.ok && workspaceHash !== null && prior.workspaceHash === workspaceHash) {
    const attempts = prior.attempts + 1;
    const attempt: GateAttempt = { ...prior, attempts };
    if (attempts > maxRetries) {
      return { outcome: { kind: 'exhausted', rejection: gateRejection(options.command, prior.result, true, attempts, maxRetries) }, attempt };
    }
    return {
      outcome: { kind: 'failed', rejection: gateRejection(options.command, prior.result, true, attempts, maxRetries) },
      attempt,
    };
  }

  const run = options.run ?? spawnGateCommand;
  const result = await run(options.command, options.cwd, timeoutMs);
  if (result.ok) {
    // A pass clears the failure cache so a later regression starts fresh.
    return { outcome: { kind: 'passed' }, attempt: undefined };
  }
  const attempts = (prior?.attempts ?? 0) + 1;
  const attempt: GateAttempt = { command: options.command, workspaceHash, result, attempts };
  if (attempts > maxRetries) {
    return { outcome: { kind: 'exhausted', rejection: gateRejection(options.command, result, false, attempts, maxRetries) }, attempt };
  }
  return { outcome: { kind: 'failed', rejection: gateRejection(options.command, result, false, attempts, maxRetries) }, attempt };
}

function gateRejection(
  command: string,
  result: GateRunResult,
  skippedRerun: boolean,
  attempts: number,
  maxRetries: number,
): CompletionAuditRejection {
  if (attempts > maxRetries) {
    return {
      ok: false,
      code: 'gate_retry_exhausted',
      reasons: [
        `Completion rejected: the goal gate command keeps failing after ${String(attempts - 1)} attempts: \`${command}\``,
        result.detail,
      ],
      nextActions: [
        'Stop attempting completion — the gate is not passing and the retry budget is spent.',
        'Summarize the blocker with the gate output above and report it instead of calling UpdateGoal(complete) again.',
      ],
    };
  }
  return {
    ok: false,
    code: 'gate_failed',
    reasons: [
      `Completion rejected: the goal gate command failed (attempt ${String(attempts)}/${String(maxRetries)}): \`${command}\``,
      ...(skippedRerun
        ? ['Workspace unchanged since the last failed gate run — replaying the cached result.']
        : []),
      result.detail,
    ],
    nextActions: [
      'Fix the failure shown above and re-run the gate command yourself to confirm it passes.',
      'Only then call UpdateGoal(complete).',
    ],
  };
}

/**
 * Workspace fingerprint: `git status` (paths+states) + `git diff HEAD`
 * (tracked content) + stat hash of untracked files. Porcelain alone is not
 * enough — editing an already-dirty tracked file leaves it unchanged.
 * Null when cwd is not inside a git worktree or the repo has no HEAD yet.
 */
export async function gitWorkspaceHash(cwd: string): Promise<string | null> {
  const status = await gitOutput(cwd, ['status', '--porcelain=v1', '-z', '-uall', '--no-renames']);
  if (status === null) return null;
  const diff = await gitOutput(cwd, ['diff', '--no-ext-diff', '--binary', 'HEAD']);
  if (diff === null) return null;
  const untracked = await hashUntrackedEntries(cwd, status);
  if (untracked === null) return null;
  return createHash('sha256').update(status).update('\0').update(diff).update('\0').update(untracked).digest('hex');
}

function gitOutput(cwd: string, args: readonly string[]): Promise<string | null> {
  return new Promise((resolvePromise) => {
    const child = spawn('git', ['--no-optional-locks', ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.on('error', () => resolvePromise(null));
    child.on('close', (code) => {
      resolvePromise(code === 0 ? stdout : null);
    });
  });
}

/**
 * Stat-based hash of untracked entries from `status -z -uall` output.
 * ponytail: content changes that preserve size+mtime (e.g. `touch -r`) go
 * undetected — upgrade to content hashing (Prime's approach) if that ever
 * matters; stat-only keeps giant untracked trees (node_modules) cheap.
 */
async function hashUntrackedEntries(cwd: string, status: string): Promise<string | null> {
  const aggregate = createHash('sha256');
  const paths = status
    .split('\0')
    .filter((entry) => entry.startsWith('?? '))
    .map((entry) => entry.slice(3))
    .sort();
  for (const path of paths) {
    aggregate.update(path);
    aggregate.update('\0');
    try {
      const full = resolve(cwd, path);
      const stat = await lstat(full);
      if (stat.isSymbolicLink()) {
        aggregate.update(`symlink:${await readlink(full)}`);
      } else {
        aggregate.update(`${String(stat.mode)}:${String(stat.size)}:${String(stat.mtimeMs)}`);
      }
    } catch {
      // Vanished between status and stat — treat as unhashable, always run.
      return null;
    }
    aggregate.update('\0');
  }
  return aggregate.digest('hex');
}

function spawnGateCommand(command: string, cwd: string, timeoutMs: number): Promise<GateRunResult> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      env: { ...process.env, CI: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const append = (chunk: Buffer): void => {
      output = (output + chunk.toString('utf8')).slice(-GOAL_GATE_OUTPUT_TAIL_CHARS);
    };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolvePromise({ ok: false, detail: `gate timed out after ${String(timeoutMs)}ms` });
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolvePromise({ ok: false, detail: `gate spawn error: ${error.message}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolvePromise({ ok: true, detail: 'exit 0' });
      } else {
        resolvePromise({ ok: false, detail: `exit ${String(code)}:\n${output.trimEnd()}` });
      }
    });
  });
}
