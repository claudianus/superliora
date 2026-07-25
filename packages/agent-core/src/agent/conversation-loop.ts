/**
 * In-conversation `/loop` harness — periodic synthetic turns, separate from cron.
 *
 * Cron: wall-clock scheduled jobs that fire when the agent is idle.
 * Loop: user-requested repeating prompt inside the current session with
 * min interval, max iterations, and expire deadline.
 */

export const MIN_LOOP_INTERVAL_MS = 60_000;
export const DEFAULT_LOOP_INTERVAL_MS = 60_000;
export const DEFAULT_LOOP_MAX_ITERATIONS = 20;

export type ConversationLoopStatus = 'active' | 'paused' | 'expired' | 'completed' | 'stopped';

export interface ConversationLoopConfig {
  readonly prompt: string;
  /** Interval between iterations; clamped to ≥ MIN_LOOP_INTERVAL_MS. */
  readonly intervalMs: number;
  readonly maxIterations: number;
  /** Absolute expire timestamp (ms since epoch); omit for no wall expire. */
  readonly expiresAt?: number | undefined;
}

export interface ConversationLoopState {
  readonly id: string;
  readonly config: ConversationLoopConfig;
  status: ConversationLoopStatus;
  iterations: number;
  readonly createdAt: number;
  lastFiredAt: number | null;
  stopReason?: string | undefined;
}

export interface ConversationLoopTickResult {
  readonly shouldFire: boolean;
  readonly state: ConversationLoopState;
  readonly reason?: string | undefined;
}

function clampInterval(intervalMs: number): number {
  if (!Number.isFinite(intervalMs) || intervalMs < MIN_LOOP_INTERVAL_MS) {
    return MIN_LOOP_INTERVAL_MS;
  }
  return Math.floor(intervalMs);
}

function clampMaxIterations(max: number): number {
  if (!Number.isFinite(max) || max < 1) return 1;
  return Math.min(Math.floor(max), 10_000);
}

/**
 * Pure controller for one conversation loop. Wall clock is injected for tests.
 */
export class ConversationLoopController {
  private state: ConversationLoopState;

  constructor(
    id: string,
    config: ConversationLoopConfig,
    private readonly now: () => number = () => Date.now(),
  ) {
    const createdAt = this.now();
    this.state = {
      id,
      config: {
        prompt: config.prompt,
        intervalMs: clampInterval(config.intervalMs),
        maxIterations: clampMaxIterations(config.maxIterations),
        expiresAt: config.expiresAt,
      },
      status: 'active',
      iterations: 0,
      createdAt,
      lastFiredAt: null,
    };
  }

  getState(): ConversationLoopState {
    return { ...this.state, config: { ...this.state.config } };
  }

  stop(reason = 'user_stop'): ConversationLoopState {
    this.state = {
      ...this.state,
      status: 'stopped',
      stopReason: reason,
    };
    return this.getState();
  }

  pause(): ConversationLoopState {
    if (this.state.status === 'active') {
      this.state = { ...this.state, status: 'paused' };
    }
    return this.getState();
  }

  resume(): ConversationLoopState {
    if (this.state.status === 'paused') {
      this.state = { ...this.state, status: 'active' };
    }
    return this.getState();
  }

  /**
   * Evaluate whether a loop iteration should fire now. When it fires,
   * increments iteration count and may transition to completed/expired.
   */
  tick(): ConversationLoopTickResult {
    const now = this.now();
    if (this.state.status !== 'active') {
      return { shouldFire: false, state: this.getState(), reason: this.state.status };
    }

    if (
      this.state.config.expiresAt !== undefined &&
      now >= this.state.config.expiresAt
    ) {
      this.state = { ...this.state, status: 'expired', stopReason: 'expired' };
      return { shouldFire: false, state: this.getState(), reason: 'expired' };
    }

    if (this.state.iterations >= this.state.config.maxIterations) {
      this.state = { ...this.state, status: 'completed', stopReason: 'max_iterations' };
      return { shouldFire: false, state: this.getState(), reason: 'max_iterations' };
    }

    if (this.state.lastFiredAt !== null) {
      const elapsed = now - this.state.lastFiredAt;
      if (elapsed < this.state.config.intervalMs) {
        return { shouldFire: false, state: this.getState(), reason: 'interval' };
      }
    }

    this.state = {
      ...this.state,
      iterations: this.state.iterations + 1,
      lastFiredAt: now,
    };

    if (this.state.iterations >= this.state.config.maxIterations) {
      // Mark completed after this fire is consumed by the host.
      const fired = this.getState();
      this.state = { ...this.state, status: 'completed', stopReason: 'max_iterations' };
      return { shouldFire: true, state: fired, reason: 'fire' };
    }

    return { shouldFire: true, state: this.getState(), reason: 'fire' };
  }
}

export function createConversationLoop(
  id: string,
  options: {
    prompt: string;
    intervalMs?: number;
    maxIterations?: number;
    expiresAt?: number;
    now?: () => number;
  },
): ConversationLoopController {
  return new ConversationLoopController(
    id,
    {
      prompt: options.prompt,
      intervalMs: options.intervalMs ?? DEFAULT_LOOP_INTERVAL_MS,
      maxIterations: options.maxIterations ?? DEFAULT_LOOP_MAX_ITERATIONS,
      expiresAt: options.expiresAt,
    },
    options.now,
  );
}
