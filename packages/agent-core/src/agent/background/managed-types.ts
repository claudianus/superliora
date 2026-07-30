import { randomBytes } from 'node:crypto';

import type { ControlledPromise } from '@antfu/utils';

import type { ResettableTimeoutPromise } from '../../utils/promise';
import type { BackgroundTask, BackgroundTaskSettlement, BackgroundTaskStatus } from './task';

export interface BackgroundTaskOutputSnapshot {
  readonly outputPath?: string;
  readonly outputSizeBytes: number;
  readonly previewBytes: number;
  readonly truncated: boolean;
  readonly fullOutputAvailable: boolean;
  readonly preview: string;
}

export function emptyOutputSnapshot(): BackgroundTaskOutputSnapshot {
  return {
    outputSizeBytes: 0,
    previewBytes: 0,
    truncated: false,
    fullOutputAvailable: false,
    preview: '',
  };
}

export interface RegisterBackgroundTaskOptions {
  /**
   * When false, the task is tracked by the manager but a foreground tool call
   * is still waiting for it. It can later be detached through RPC.
   */
  readonly detached?: boolean;
  /** Deadline owned by BackgroundManager. `0` and `undefined` do not arm a timer. */
  readonly timeoutMs?: number;
  /**
   * When set, detaching a foreground task resets its deadline to this value
   * (counted from the detach moment). Lets a command started with a short
   * foreground timeout run longer once it is moved to the background.
   */
  readonly detachTimeoutMs?: number;
  /** Foreground caller signal. Ignored for tasks created already detached. */
  readonly signal?: AbortSignal;
}

export type ForegroundTaskReleaseReason = 'detached' | 'terminal';

interface StopRequest {
  readonly reason?: string;
  readonly abortReason?: unknown;
}

export type TerminalOutcome =
  | { readonly kind: 'worker'; readonly settlement: BackgroundTaskSettlement }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'stop'; readonly request: StopRequest };

export interface ManagedTask {
  readonly taskId: string;
  readonly task: BackgroundTask;
  readonly outputChunks: string[];
  /** Total UTF-8 bytes observed, including chunks dropped from the live ring buffer. */
  outputSizeBytes: number;
  status: BackgroundTaskStatus;
  /** Normalized registration options. Current mutable state stays on ManagedTask. */
  readonly options: RegisterBackgroundTaskOptions;
  readonly startedAt: number;
  endedAt: number | null;
  /** Foreground tool call release signal, present only for non-detached starts. */
  foregroundRelease?: ControlledPromise<ForegroundTaskReleaseReason>;
  /** Resettable deadline timer; reset on detach to apply `detachTimeoutMs`. */
  timeoutHandle?: ResettableTimeoutPromise<TerminalOutcome>;
  /** User/tool stop request. */
  readonly stop: ControlledPromise<StopRequest>;
  /** Resolved once manager has finalized the task. */
  readonly terminal: ControlledPromise<void>;
  /** Human-readable reason for the terminal status, when available. */
  stopReason?: string | undefined;
  /** Suppress automatic terminal notifications/reminders for this task. */
  terminalNotificationSuppressed?: boolean | undefined;
  /** Cancellation signal owned by the manager and observed by the concrete task. */
  readonly abortController: AbortController;
  persistWriteQueue: Promise<void>;
  outputWriteQueue: Promise<void>;
  /**
   * Full output buffered in memory while a foreground task has not yet
   * persisted to disk. Flushed to `output.log` (in order, ahead of the live
   * stream) when the task detaches or spills, then released.
   */
  pendingOutput: string[];
  pendingOutputBytes: number;
  /**
   * Whether `output.log` writes have begun. True from the start for tasks
   * registered already-detached; flipped on detach or memory-bound spill for
   * foreground tasks. Until then output stays in `pendingOutput`.
   */
  outputPersistStarted: boolean;
}

/**
 * Maximum bytes of combined output kept in the in-memory ring buffer per
 * task. When exceeded, the oldest chunks are dropped.
 *
 * The ring buffer is a lightweight tail intended for the `/tasks` UI and
 * terminal notifications only — it deliberately discards old output to
 * cap memory. It is NOT the authoritative full output: the complete,
 * never-truncated log lives on disk at `<sessionDir>/tasks/<id>/output.log`.
 * Callers that need task output should use `getOutputSnapshot()`, which
 * reads the persisted log when available.
 */
export const MAX_OUTPUT_BYTES = 1024 * 1024; // 1 MiB

export const SIGTERM_GRACE_MS = 5_000;
export const USER_INTERRUPT_REASON = 'Interrupted by user';

const _ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/**
 * Generate `{prefix}-{8 base36 chars}`.
 *
 * `randomBytes(8) % 36` has a modest modulo bias (256 % 36 = 4) but
 * over an 8-char suffix yields ~36^8 ≈ 2.8e12 distinct ids which is
 * more than enough uniqueness for per-session task ids.
 */
export function generateTaskId(kind: string): string {
  const bytes = randomBytes(8);
  let suffix = '';
  for (let i = 0; i < 8; i++) {
    suffix += _ALPHABET[bytes[i]! % 36];
  }
  return `${kind}-${suffix}`;
}

export function abortRejecter(signal: AbortSignal): Promise<never> {
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new Error('Aborted'));
  }
  return new Promise<never>((_, reject) => {
    signal.addEventListener(
      'abort',
      () => reject(signal.reason ?? new Error('Aborted')),
      { once: true },
    );
  });
}
