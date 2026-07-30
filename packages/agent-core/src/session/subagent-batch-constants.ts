export const INITIAL_LAUNCH_LIMIT = 5;
export const INITIAL_LAUNCH_INTERVAL_MS = 700;
export const RATE_LIMIT_RETRY_BASE_MS = 3000;
export const RATE_LIMIT_RETRY_FACTOR = 2;
export const RATE_LIMIT_CAPACITY_SHRINK_INTERVAL_MS = 2000;
export const RATE_LIMIT_CAPACITY_RECOVERY_INTERVAL_MS = 3 * 60 * 1000;
export const RATE_LIMIT_SUSPENDED_REASON = 'Provider rate limit; subagent requeued for retry.';

/** Extra in-place attempts granted for transient provider failures. */
export const TRANSIENT_RETRY_MAX_ATTEMPTS = 2;
/** Exponential backoff base for transient retries: 1000 ms, then 2000 ms. */
export const TRANSIENT_RETRY_BASE_DELAY_MS = 1000;

export const AGENT_SWARM_MAX_CONCURRENCY_ENV = 'SUPERLIORA_AGENT_SWARM_MAX_CONCURRENCY';

/** Default normal-phase concurrency when env is unset/empty/invalid. */
export const DEFAULT_SWARM_MAX_CONCURRENCY = 16;

/**
 * Strictly monotonic millisecond counter. Used for the rate-limit capacity
 * "quiet window" / shrink-throttle checks so a wall-clock jump (NTP, suspend
 * resume on some platforms, manual change) cannot spuriously trigger or
 * suppress recovery. `Date.now()` is kept for `setTimeout` deadlines, which
 * the OS scheduler aligns to wall time anyway.
 */
export const monoNowMs = (): number => Number(process.hrtime.bigint() / 1_000_000n);
