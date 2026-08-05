/**
 * Net resilience harness for keyless web endpoints (local search / fetch
 * fallbacks) and block-aware consumers.
 *
 * Per host:
 *   - token-bucket pacing: minimum interval between requests + random jitter
 *   - browser User-Agent rotation (round-robin, bumped on block)
 *   - block signals (429 / 403 / captcha / 202 empty) → consecutive-block
 *     counter → cooldown window; consumers fast-fail via {@link assertReady}
 *     and fall back to the next source instead of hammering a blocked host.
 *
 * Retry policy (exponential backoff with full jitter) lives with the
 * consumer via {@link backoffMs}; this module owns state, not the fetch
 * loop, so each caller keeps its own parsing/abort semantics. Paid-API
 * slots keep their existing circuit breakers — this registry backs only
 * the keyless local providers where cooldown *is* the breaker.
 */

export type NetBlockKind = 'rate_limited' | 'forbidden' | 'captcha' | 'server';

/** Honest desktop browser UAs, rotated per host. Order matters only for tests. */
export const DEFAULT_BROWSER_USER_AGENTS: readonly string[] = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
];

export interface NetHostPolicy {
  /** Minimum ms between requests to the same host. 0 disables pacing. */
  readonly minIntervalMs?: number;
  /** Extra random delay in [0, jitterMs] applied when pacing kicks in. */
  readonly jitterMs?: number;
  /** Consecutive blocks before the host enters cooldown. Default 2. */
  readonly blockThreshold?: number;
  /** Cooldown window once the threshold trips. Default 5 min. */
  readonly cooldownMs?: number;
}

export interface NetHostSnapshot {
  readonly coolingDown: boolean;
  readonly cooldownRemainingMs: number;
  readonly consecutiveBlocks: number;
}

export class NetHostCooldownError extends Error {
  override readonly name = 'NetHostCooldownError';

  constructor(
    readonly host: string,
    readonly remainingMs: number,
  ) {
    super(`Host "${host}" is cooling down for ${String(Math.ceil(remainingMs / 1000))}s after repeated blocks.`);
  }
}

/** Classify an HTTP status into a block kind; undefined = not a block signal. */
export function classifyHttpBlock(status: number): NetBlockKind | undefined {
  if (status === 429) return 'rate_limited';
  if (status === 403) return 'forbidden';
  // DDG answers suspected bots with 202 + empty body.
  if (status === 202) return 'captcha';
  if (status >= 500) return 'server';
  return undefined;
}

const CAPTCHA_MARKERS = /captcha|challenge-platform|are you a robot|unusual traffic/i;

/** Heuristic bot-wall detector for HTML bodies (captcha / interstitial). */
export function looksLikeCaptchaBody(body: string): boolean {
  return body.length > 0 && body.length < 200_000 && CAPTCHA_MARKERS.test(body);
}

/** Full-jitter exponential backoff: random in [0, baseMs * 2^attempt]. */
export function backoffMs(attempt: number, baseMs: number, random: () => number = Math.random): number {
  const cap = baseMs * 2 ** Math.max(0, attempt);
  return Math.floor(random() * cap);
}

interface HostState {
  lastRequestAt: number;
  uaCursor: number;
  consecutiveBlocks: number;
  cooldownUntil: number;
}

export interface NetResilienceOptions {
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: () => number;
}

const DEFAULT_BLOCK_THRESHOLD = 2;
const DEFAULT_COOLDOWN_MS = 5 * 60_000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class NetResilienceRegistry {
  // ponytail: entries are never evicted — one small HostState per contacted
  // hostname for process lifetime, bounded in practice by how many distinct
  // hosts the tools touch. Upgrade path: LRU cap or TTL sweep in stateFor().
  private readonly hosts = new Map<string, HostState>();
  private readonly now: () => number;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(options: NetResilienceOptions = {}) {
    this.now = options.now ?? Date.now;
    this.sleepFn = options.sleep ?? defaultSleep;
    this.random = options.random ?? Math.random;
  }

  /** Throw fast when the host is in cooldown so callers fall back immediately. */
  assertReady(host: string): void {
    const remaining = this.cooldownRemainingMs(host);
    if (remaining > 0) throw new NetHostCooldownError(host, remaining);
  }

  cooldownRemainingMs(host: string): number {
    const state = this.hosts.get(host);
    if (state === undefined) return 0;
    return Math.max(0, state.cooldownUntil - this.now());
  }

  snapshot(host: string): NetHostSnapshot {
    const state = this.hosts.get(host);
    return {
      coolingDown: this.cooldownRemainingMs(host) > 0,
      cooldownRemainingMs: this.cooldownRemainingMs(host),
      consecutiveBlocks: state?.consecutiveBlocks ?? 0,
    };
  }

  /**
   * Pace requests to a host: sleep the remainder of the minimum interval
   * since the last request plus jitter, then stamp the request time. A
   * first-ever request (or one after a quiet period) never sleeps.
   */
  async pace(host: string, policy: NetHostPolicy = {}): Promise<void> {
    const state = this.stateFor(host);
    const minInterval = policy.minIntervalMs ?? 0;
    const jitter = policy.jitterMs ?? 0;
    const now = this.now();
    const elapsed = now - state.lastRequestAt;
    if (state.lastRequestAt > 0 && elapsed < minInterval) {
      const delay = minInterval - elapsed + (jitter > 0 ? Math.floor(this.random() * jitter) : 0);
      if (delay > 0) await this.sleepFn(delay);
    }
    state.lastRequestAt = this.now();
  }

  /** Injectable sleep passthrough for consumer retry backoff. */
  sleep(ms: number): Promise<void> {
    return this.sleepFn(ms);
  }

  /** Round-robin UA per host; {@link noteBlock} bumps the cursor. */
  pickUserAgent(host: string, pool: readonly string[] = DEFAULT_BROWSER_USER_AGENTS): string {
    const state = this.stateFor(host);
    const ua = pool[state.uaCursor % pool.length];
    state.uaCursor += 1;
    return ua ?? pool[0] ?? '';
  }

  noteSuccess(host: string): void {
    const state = this.stateFor(host);
    state.consecutiveBlocks = 0;
  }

  /**
   * Record a block signal. Returns true when this call newly trips the
   * host into cooldown.
   */
  noteBlock(host: string, _kind: NetBlockKind, policy: NetHostPolicy = {}): boolean {
    const state = this.stateFor(host);
    state.consecutiveBlocks += 1;
    // Rotate identity so the next attempt presents differently.
    state.uaCursor += 1;
    const threshold = policy.blockThreshold ?? DEFAULT_BLOCK_THRESHOLD;
    if (state.consecutiveBlocks >= threshold && this.cooldownRemainingMs(host) === 0) {
      state.cooldownUntil = this.now() + (policy.cooldownMs ?? DEFAULT_COOLDOWN_MS);
      state.consecutiveBlocks = 0;
      return true;
    }
    return false;
  }

  /** Test / maintenance hook: forget one host or (no arg) everything. */
  reset(host?: string): void {
    if (host === undefined) {
      this.hosts.clear();
    } else {
      this.hosts.delete(host);
    }
  }

  private stateFor(host: string): HostState {
    let state = this.hosts.get(host);
    if (state === undefined) {
      state = { lastRequestAt: 0, uaCursor: 0, consecutiveBlocks: 0, cooldownUntil: 0 };
      this.hosts.set(host, state);
    }
    return state;
  }
}

/**
 * Process-wide registry shared by local providers so a host blocked during
 * search stays blocked for fetch (and across engine instances).
 */
export const sharedNetResilience = new NetResilienceRegistry();
