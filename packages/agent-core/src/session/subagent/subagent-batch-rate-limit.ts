import * as retry from 'retry';

import {
  monoNowMs,
  RATE_LIMIT_CAPACITY_RECOVERY_INTERVAL_MS,
  RATE_LIMIT_CAPACITY_SHRINK_INTERVAL_MS,
  RATE_LIMIT_RETRY_BASE_MS,
  RATE_LIMIT_RETRY_FACTOR,
  RATE_LIMIT_SUSPENDED_REASON,
} from './subagent-batch-constants';
import type {
  ActiveAttempt,
  SubagentBatchLauncher,
  TaskState,
} from './subagent-batch-types';

export type RateLimitScheduleDeps<T> = {
  readonly pending: Array<TaskState<T>>;
  readonly active: Set<ActiveAttempt<T>>;
  readonly finished: boolean;
  startAttempt: (state: TaskState<T>) => void;
  schedule: () => void;
};

export class SubagentBatchRateLimit<T> {
  rateLimitMode = false;
  rateLimitCapacity = 1;
  lastRateLimitAt: number | undefined;
  /** Monotonic companion to `lastRateLimitAt` for the 3-minute quiet window. */
  lastRateLimitMonoMs: number | undefined;
  lastCapacityShrinkAt: number | undefined;
  /** Monotonic companion for the 2-second shrink throttle. */
  lastCapacityShrinkMonoMs: number | undefined;
  lastCapacityRecoveryAt: number | undefined;
  /** Monotonic companion to `lastCapacityRecoveryAt` for the quiet window. */
  lastCapacityRecoveryMonoMs: number | undefined;
  globalRetryIntervalMs = RATE_LIMIT_RETRY_BASE_MS;
  nextRateLimitLaunchAt = 0;
  private rateLimitLaunchTimer: ReturnType<typeof setTimeout> | undefined;

  clearTimer(): void {
    if (this.rateLimitLaunchTimer !== undefined) clearTimeout(this.rateLimitLaunchTimer);
    this.rateLimitLaunchTimer = undefined;
  }

  scheduleLaunch(deps: RateLimitScheduleDeps<T>): void {
    this.clearTimer();
    if (deps.pending.length === 0) return;

    const now = Date.now();
    this.recoverCapacity(now);
    if (deps.active.size >= this.rateLimitCapacity) {
      this.scheduleWakeup(this.nextCapacityRecoveryAt(deps), now, deps.schedule);
      return;
    }

    const nextAllowedAt = Math.max(this.nextRateLimitLaunchAt, this.nextPendingReadyAt(deps.pending));
    const nextWakeupAt = Math.min(nextAllowedAt, this.nextCapacityRecoveryAt(deps));
    if (nextWakeupAt > now) {
      this.scheduleWakeup(nextWakeupAt, now, deps.schedule);
      return;
    }

    const pendingIndex = deps.pending.findIndex((state) => state.retryReadyAt <= now);
    if (pendingIndex === -1) return;

    const [state] = deps.pending.splice(pendingIndex, 1);
    deps.startAttempt(state!);
    this.nextRateLimitLaunchAt = now + this.globalRetryIntervalMs;
    this.scheduleNextWakeup(now, deps);
  }

  requeueRateLimited(
    attempt: ActiveAttempt<T>,
    agentId: string,
    launcher: SubagentBatchLauncher,
    pending: Array<TaskState<T>>,
    clearNormalTimer: () => void,
    startedSuccessCount: number,
  ): void {
    const state = attempt.state;
    state.agentId = agentId;
    state.retryAgentId = agentId;
    launcher.suspended?.({
      task: state.task,
      agentId,
      reason: RATE_LIMIT_SUSPENDED_REASON,
    });

    const now = Date.now();
    this.lastRateLimitAt = now;
    this.lastRateLimitMonoMs = monoNowMs();
    state.retryCount += 1;
    const retryDelay = retry.createTimeout(Math.max(0, state.retryCount - 1), {
      minTimeout: RATE_LIMIT_RETRY_BASE_MS,
      maxTimeout: Number.POSITIVE_INFINITY,
      factor: RATE_LIMIT_RETRY_FACTOR,
      randomize: false,
    });
    state.retryReadyAt = now + retryDelay;
    pending.unshift(state);
    this.enterMode(now, clearNormalTimer, startedSuccessCount);

    if (!attempt.ready) {
      this.globalRetryIntervalMs = Math.max(this.globalRetryIntervalMs * 2, retryDelay);
      this.nextRateLimitLaunchAt = Math.max(
        this.nextRateLimitLaunchAt,
        now + this.globalRetryIntervalMs,
      );
    } else {
      this.nextRateLimitLaunchAt = Math.max(
        this.nextRateLimitLaunchAt,
        now + RATE_LIMIT_RETRY_BASE_MS,
      );
    }
  }

  onAttemptReadyInRateLimitPhase(schedule: () => void): void {
    this.globalRetryIntervalMs = RATE_LIMIT_RETRY_BASE_MS;
    this.nextRateLimitLaunchAt = Date.now() + this.globalRetryIntervalMs;
    schedule();
  }

  enterMode(now: number, clearNormalTimer: () => void, startedSuccessCount = 0): void {
    if (!this.rateLimitMode) {
      this.rateLimitMode = true;
      clearNormalTimer();
      this.rateLimitCapacity = Math.max(1, startedSuccessCount);
      this.nextRateLimitLaunchAt = Math.max(
        this.nextRateLimitLaunchAt,
        now + RATE_LIMIT_RETRY_BASE_MS,
      );
      this.shrinkCapacity(now, true);
      return;
    }

    this.shrinkCapacity(now, false);
  }

  private shrinkCapacity(now: number, force: boolean): void {
    if (!force && this.lastCapacityShrinkMonoMs !== undefined) {
      // Use the monotonic clock so a wall-clock jump cannot bypass the
      // 2-second shrink throttle.
      const mono = monoNowMs();
      if (mono - this.lastCapacityShrinkMonoMs < RATE_LIMIT_CAPACITY_SHRINK_INTERVAL_MS) {
        return;
      }
      this.lastCapacityShrinkMonoMs = mono;
    } else {
      this.lastCapacityShrinkMonoMs = monoNowMs();
    }

    this.rateLimitCapacity = Math.max(1, this.rateLimitCapacity - 1);
    this.lastCapacityShrinkAt = now;
  }

  private recoverCapacity(now: number): void {
    if (this.lastRateLimitMonoMs === undefined) return;
    const mono = monoNowMs();
    const nextRecoveryMonoMs = this.nextCapacityRecoveryMonoMs();
    if (nextRecoveryMonoMs > mono) return;

    this.rateLimitCapacity += 1;
    this.lastCapacityRecoveryAt = now;
    this.lastCapacityRecoveryMonoMs = mono;
    this.nextRateLimitLaunchAt = Math.min(this.nextRateLimitLaunchAt, now);
  }

  private nextCapacityRecoveryAt<T>(deps: RateLimitScheduleDeps<T>): number {
    if (deps.pending.length === 0 || this.lastRateLimitAt === undefined) {
      return Number.POSITIVE_INFINITY;
    }

    const latestCapacityChangeAt = Math.max(
      this.lastRateLimitAt,
      this.lastCapacityRecoveryAt ?? 0,
    );
    return latestCapacityChangeAt + RATE_LIMIT_CAPACITY_RECOVERY_INTERVAL_MS;
  }

  /**
   * Monotonic counterpart of {@link nextCapacityRecoveryAt}. Returns
   * the next monotonic millisecond at which the 3-minute quiet window
   * elapses and capacity is allowed to recover by one slot.
   */
  private nextCapacityRecoveryMonoMs(): number {
    if (this.lastRateLimitMonoMs === undefined) {
      return Number.POSITIVE_INFINITY;
    }
    const latestCapacityChangeMonoMs = Math.max(
      this.lastRateLimitMonoMs,
      this.lastCapacityRecoveryMonoMs ?? 0,
    );
    return latestCapacityChangeMonoMs + RATE_LIMIT_CAPACITY_RECOVERY_INTERVAL_MS;
  }

  private scheduleWakeup(
    wakeupAt: number,
    now: number,
    schedule: () => void,
  ): void {
    if (!Number.isFinite(wakeupAt) || wakeupAt <= now) return;
    this.rateLimitLaunchTimer = setTimeout(() => {
      this.rateLimitLaunchTimer = undefined;
      schedule();
    }, wakeupAt - now);
  }

  private scheduleNextWakeup<T>(now: number, deps: RateLimitScheduleDeps<T>): void {
    if (deps.pending.length === 0) return;

    const nextWakeupAt =
      deps.active.size >= this.rateLimitCapacity
        ? this.nextCapacityRecoveryAt(deps)
        : Math.min(
            Math.max(this.nextRateLimitLaunchAt, this.nextPendingReadyAt(deps.pending)),
            this.nextCapacityRecoveryAt(deps),
          );

    this.scheduleWakeup(nextWakeupAt, now, deps.schedule);
  }

  private nextPendingReadyAt<T>(pending: readonly TaskState<T>[]): number {
    return pending.reduce((nextAt, state) => {
      return Math.min(nextAt, state.retryReadyAt);
    }, Number.POSITIVE_INFINITY);
  }
}
