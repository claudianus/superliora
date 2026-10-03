/**
 * Bounded, cancellable worker spawn handshakes.
 *
 * Worker spawns run behind a bounded-concurrency queue so the interactive
 * lane never awaits spawn preparation:
 *
 * - queue: concurrent enqueue calls spawn at most `maxConcurrent` handshakes
 *   at a time, in FIFO order (batched schedules no longer pay n×budget);
 * - spawning state: a key (job id) is either queued or spawning; duplicate
 *   enqueues are rejected so resume/schedule races cannot double-spawn;
 * - budget expiry requests cancellation and frees a preparation slot, but the
 *   actual handshake remains owned/deduplicated until its native run settles;
 * - settle joins those aborted runs too. An abort is not physical release.
 */

import { CONDUCTOR_DEFAULT_MAX_CONCURRENT_JOBS } from '../../tools/builtin/job/job-runtime';

/** Timeout for preparing a worker host, not for its model execution. */
export const JOB_WORKER_SPAWN_BUDGET_MS = 30_000;


/**
 * Parallel spawn handshakes. Keys are deduped per job and each handshake owns
 * its own worktree/agent, so distinct jobs spawn safely in parallel. Tracks
 * the job concurrency default: a spawn cap below it promotes jobs to `running`
 * faster than workers can attach.
 */
const JOB_WORKER_SPAWN_MAX_CONCURRENT = CONDUCTOR_DEFAULT_MAX_CONCURRENT_JOBS;

export type WorkerSpawnPhase =
  | 'spawning'
  | 'spawned'
  | 'spawn_failed'
  | 'spawn_cancelled'
  | 'spawn_budget_exceeded';

export interface WorkerSpawnTask {
  /** Dedupe key — normally the job id. One queued/spawning task per key. */
  readonly key: string;
  /** The spawn handshake. Must settle eventually once `signal` aborts. */
  readonly run: (ctx: { readonly signal: AbortSignal }) => Promise<unknown>;
  /** Transition observer (`spawning` state visibility, checklist V2-2). */
  readonly onPhase?: (phase: WorkerSpawnPhase) => void;
  /** Called once when the spawn budget expires (record blocked + reason). */
  readonly onTimeout?: () => void;
  readonly onCancel?: () => void;
}

export interface WorkerSpawnerOptions {
  /** Override the spawn budget (tests). Defaults to JOB_WORKER_SPAWN_BUDGET_MS. */
  readonly budgetMs?: number;
  /** Override the spawn concurrency (tests). Defaults to JOB_WORKER_SPAWN_MAX_CONCURRENT. */
  readonly maxConcurrent?: number;
}

export class WorkerSpawner {
  private readonly queue: WorkerSpawnTask[] = [];
  private readonly queuedKeys = new Set<string>();
  private readonly budgetMs: number;
  private maxConcurrent: number;
  private readonly spawningKeys = new Set<string>();
  private readonly pendingRuns = new Map<string, Promise<boolean>>();
  private drainScheduled = false;
  private drainInFlight: Promise<void> | undefined;

  constructor(options: WorkerSpawnerOptions = {}) {
    this.budgetMs = options.budgetMs ?? JOB_WORKER_SPAWN_BUDGET_MS;
    this.maxConcurrent = Math.max(1, options.maxConcurrent ?? JOB_WORKER_SPAWN_MAX_CONCURRENT);
  }

  /**
   * Live cap update for this store's queue. The drain reads `maxConcurrent`
   * each iteration so queued handshakes pick up explicit pool changes without
   * interrupting already admitted native runs.
   */
  setMaxConcurrent(maxConcurrent: number): void {
    if (Number.isFinite(maxConcurrent)) {
      this.maxConcurrent = Math.max(1, Math.floor(maxConcurrent));
    }
  }

  /**
   * Queue a spawn. Returns synchronously — the caller never awaits spawn
   * preparation. Duplicate keys (queued or currently spawning) are rejected.
   */
  enqueue(task: WorkerSpawnTask): { readonly queued: boolean; readonly duplicate: boolean } {
    if (this.queuedKeys.has(task.key) || this.spawningKeys.has(task.key)) {
      return { queued: false, duplicate: true };
    }
    this.queue.push(task);
    this.queuedKeys.add(task.key);
    this.startDrain();
    return { queued: true, duplicate: false };
  }

  /** Remove a not-yet-started handshake without claiming a worker was spawned. */
  cancelQueued(key: string): boolean {
    const index = this.queue.findIndex((task) => task.key === key);
    if (index < 0) return false;
    const [task] = this.queue.splice(index, 1);
    this.queuedKeys.delete(key);
    try { task?.onCancel?.(); } catch { /* Observer failures do not break cancellation. */ }
    if (task) this.emitPhase(task, 'spawn_cancelled');
    return true;
  }

  /** A key currently mid-spawn, when any (first in start order). */
  get currentSpawningKey(): string | undefined {
    return this.spawningKeys.values().next().value as string | undefined;
  }

  isSpawning(key: string): boolean {
    return this.spawningKeys.has(key);
  }

  isQueued(key: string): boolean {
    return this.queuedKeys.has(key);
  }

  get queuedCount(): number {
    return this.queue.length;
  }

  /** Resolves when the queue is empty and no spawn is in flight. */
  async settle(): Promise<void> {
    for (;;) {
      // Kick a deferred drain so settle works even before the first
      // microtask ran; then join whatever is in flight.
      if (this.queue.length > 0) this.beginDrain();
      const inFlight = this.drainInFlight;
      if (inFlight !== undefined) await inFlight;
      if (this.pendingRuns.size > 0) await Promise.allSettled(this.pendingRuns.values());
      if (this.queue.length === 0 && this.drainInFlight === undefined && this.pendingRuns.size === 0) return;
    }
  }

  private startDrain(): void {
    if (this.drainInFlight !== undefined || this.drainScheduled) return;
    // Deferred: enqueue must never start spawn work on the caller stack.
    this.drainScheduled = true;
    queueMicrotask(() => {
      this.drainScheduled = false;
      this.beginDrain();
    });
  }

  private beginDrain(): void {
    if (this.drainInFlight !== undefined) return;
    const drain = (async () => {
      // Keep up to maxConcurrent handshakes in flight; pull the next queued
      // task as soon as any one settles so batches no longer serialize.
      const inFlight = new Set<Promise<void>>();
      for (;;) {
        while (inFlight.size < this.maxConcurrent && this.queue.length > 0) {
          const task = this.queue.shift();
          if (task === undefined) break;
          this.queuedKeys.delete(task.key);
          const slot = this.runOne(task).finally(() => {
            inFlight.delete(slot);
          });
          inFlight.add(slot);
        }
        if (inFlight.size === 0) break;
        await Promise.race(inFlight);
      }
    })();
    this.drainInFlight = drain;
    void drain.finally(() => {
      if (this.drainInFlight === drain) this.drainInFlight = undefined;
      // Requests that landed while the loop was exiting re-arm the drain.
      if (this.queue.length > 0) this.beginDrain();
    });
  }

  private async runOne(task: WorkerSpawnTask): Promise<void> {
    this.spawningKeys.add(task.key);
    this.emitPhase(task, 'spawning');
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const budget = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort(new Error(`spawn budget exceeded (${this.budgetMs}ms)`));
        resolve();
      }, this.budgetMs);
      // Never keep the process alive just for a spawn budget.
      (timer as { unref?: () => void }).unref?.();
    });

    try {
      const runSettled = task
        .run({ signal: controller.signal })
        .then(
          () => true as const,
          () => false as const,
        );
      this.pendingRuns.set(task.key, runSettled);
      void runSettled.then(() => {
        this.pendingRuns.delete(task.key);
        this.spawningKeys.delete(task.key);
      });
      const winner = await Promise.race([runSettled, budget.then(() => undefined)]);
      if (timedOut || winner === undefined) {
        // Free a preparation slot, not the native ownership/deduplication key.
        this.emitPhase(task, 'spawn_budget_exceeded');
        try {
          task.onTimeout?.();
        } catch {
          // isolation: observer errors never break the queue
        }
        // settle() still joins runSettled; it is not detached from ownership.
        return;
      }
      this.emitPhase(task, winner ? 'spawned' : 'spawn_failed');
    } catch {
      // isolation: no spawn failure may break the caller stack or the queue
      this.emitPhase(task, 'spawn_failed');
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (!this.pendingRuns.has(task.key)) this.spawningKeys.delete(task.key);
    }
  }

  private emitPhase(task: WorkerSpawnTask, phase: WorkerSpawnPhase): void {
    try {
      task.onPhase?.(phase);
    } catch {
      // isolation: observer errors never break the queue
    }
  }
}
