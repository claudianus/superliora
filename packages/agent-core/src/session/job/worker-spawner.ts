/**
 * V2-2 spawn isolation (contract §3, checklist V2-2).
 *
 * Worker spawns run behind a serialized queue so the interactive lane never
 * awaits spawn preparation:
 *
 * - queue: concurrent enqueue calls never spawn in parallel — one spawn
 *   handshake runs at a time, in FIFO order;
 * - spawning state: a key (job id) is either queued or spawning; duplicate
 *   enqueues are rejected so resume/schedule races cannot double-spawn;
 * - failure isolation: a throwing or hanging spawn never rejects into the
 *   caller stack and never stalls the queue — budget-exceeding spawns are
 *   aborted, recorded via `onTimeout`, and detached;
 * - budget: a spawn handshake that exceeds the budget aborts and the queue
 *   moves on (the 120s spawn-chain incident cannot repeat).
 */

/** Locked spawn budget (checklist V2-2): blocked + reason after 30s. */
export const JOB_WORKER_SPAWN_BUDGET_MS = 30_000;

export type WorkerSpawnPhase =
  | 'spawning'
  | 'spawned'
  | 'spawn_failed'
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
}

export interface WorkerSpawnerOptions {
  /** Override the spawn budget (tests). Defaults to JOB_WORKER_SPAWN_BUDGET_MS. */
  readonly budgetMs?: number;
}

export class WorkerSpawner {
  private readonly queue: WorkerSpawnTask[] = [];
  private readonly queuedKeys = new Set<string>();
  private readonly budgetMs: number;
  private spawningKey: string | undefined;
  private drainScheduled = false;
  private drainInFlight: Promise<void> | undefined;

  constructor(options: WorkerSpawnerOptions = {}) {
    this.budgetMs = options.budgetMs ?? JOB_WORKER_SPAWN_BUDGET_MS;
  }

  /**
   * Queue a spawn. Returns synchronously — the caller never awaits spawn
   * preparation. Duplicate keys (queued or currently spawning) are rejected.
   */
  enqueue(task: WorkerSpawnTask): { readonly queued: boolean; readonly duplicate: boolean } {
    if (this.queuedKeys.has(task.key) || this.spawningKey === task.key) {
      return { queued: false, duplicate: true };
    }
    this.queue.push(task);
    this.queuedKeys.add(task.key);
    this.startDrain();
    return { queued: true, duplicate: false };
  }

  /** Key currently mid-spawn, when any. */
  get currentSpawningKey(): string | undefined {
    return this.spawningKey;
  }

  isSpawning(key: string): boolean {
    return this.spawningKey === key;
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
      if (inFlight === undefined) return;
      await inFlight;
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
      while (this.queue.length > 0) {
        const task = this.queue.shift();
        if (task === undefined) break;
        this.queuedKeys.delete(task.key);
        await this.runOne(task);
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
    this.spawningKey = task.key;
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
      const winner = await Promise.race([runSettled, budget.then(() => undefined)]);
      if (timedOut || winner === undefined) {
        // Budget expired: record, detach the (aborted) handshake, move on —
        // a hung spawn must not stall the rest of the queue.
        this.emitPhase(task, 'spawn_budget_exceeded');
        try {
          task.onTimeout?.();
        } catch {
          // isolation: observer errors never break the queue
        }
        void runSettled.catch(() => {});
        return;
      }
      this.emitPhase(task, winner ? 'spawned' : 'spawn_failed');
    } catch {
      // isolation: no spawn failure may break the caller stack or the queue
      this.emitPhase(task, 'spawn_failed');
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      this.spawningKey = undefined;
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
