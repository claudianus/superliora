/**
 * Lightweight circuit breaker for Never-Halt provider / search channels.
 * Closed → Open (after failureThreshold) → HalfOpen (after cooldown) → Closed.
 */

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerSnapshot {
  readonly state: CircuitState;
  readonly failures: number;
  readonly openRemainingMs: number;
  readonly lastTripReason?: string;
}

export interface CircuitBreakerScopeStatus {
  readonly id: string;
  readonly state: CircuitState;
  readonly failures: number;
  readonly lastTripReason?: string;
}

export interface CircuitBreakerRegistrySnapshot {
  readonly counts: {
    readonly closed: number;
    readonly open: number;
    readonly halfOpen: number;
    readonly total: number;
  };
  readonly scopes: ReadonlyArray<CircuitBreakerScopeStatus>;
}

export interface CircuitBreakerOptions {
  readonly failureThreshold?: number;
  readonly cooldownMs?: number;
  readonly now?: () => number;
  /** Fires once per closed/half_open → open transition (not while already open). */
  readonly onOpened?: (reason?: string) => void;
}

export interface CircuitBreakerRegistryOptions extends CircuitBreakerOptions {
  readonly onScopeOpened?: (scopeId: string, reason?: string) => void;
}

export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  private lastTripReason: string | undefined;
  private state: CircuitState = 'closed';
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private readonly onOpened: ((reason?: string) => void) | undefined;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 3;
    this.cooldownMs = options.cooldownMs ?? 60_000;
    this.now = options.now ?? Date.now;
    this.onOpened = options.onOpened;
  }

  getState(): CircuitState {
    this.refresh();
    return this.state;
  }

  /** Whether a call may proceed. */
  allow(): boolean {
    this.refresh();
    return this.state !== 'open';
  }

  recordSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
    this.openedAt = 0;
    this.lastTripReason = undefined;
  }

  /** Returns true when this call transitions the breaker to open. */
  recordFailure(reason?: string): boolean {
    const wasOpen = this.state === 'open';
    this.failures += 1;
    if (this.failures >= this.failureThreshold) {
      if (reason !== undefined && reason.trim().length > 0) {
        this.lastTripReason = reason.trim();
      }
      if (!wasOpen) {
        this.state = 'open';
        this.openedAt = this.now();
        this.onOpened?.(this.lastTripReason);
        return true;
      }
    }
    return false;
  }

  snapshot(): CircuitBreakerSnapshot {
    this.refresh();
    const remaining =
      this.state === 'open' ? Math.max(0, this.cooldownMs - (this.now() - this.openedAt)) : 0;
    return {
      state: this.state,
      failures: this.failures,
      openRemainingMs: remaining,
      ...(this.lastTripReason !== undefined ? { lastTripReason: this.lastTripReason } : {}),
    };
  }

  private refresh(): void {
    if (this.state !== 'open') return;
    if (this.now() - this.openedAt >= this.cooldownMs) {
      this.state = 'half_open';
    }
  }
}

/** Named registry for search slots / LLM providers. */
export class CircuitBreakerRegistry {
  private readonly breakers = new Map<string, CircuitBreaker>();
  private readonly breakerOptions: CircuitBreakerOptions;

  constructor(private readonly options: CircuitBreakerRegistryOptions = {}) {
    const { onScopeOpened: _onScopeOpened, ...breakerOptions } = options;
    this.breakerOptions = breakerOptions;
  }

  get(id: string): CircuitBreaker {
    let breaker = this.breakers.get(id);
    if (breaker === undefined) {
      breaker = new CircuitBreaker({
        ...this.breakerOptions,
        onOpened: (reason) => this.options.onScopeOpened?.(id, reason),
      });
      this.breakers.set(id, breaker);
    }
    return breaker;
  }

  status(): ReadonlyArray<CircuitBreakerScopeStatus> {
    return [...this.breakers.entries()].map(([id, breaker]) => {
      const snap = breaker.snapshot();
      return {
        id,
        state: snap.state,
        failures: snap.failures,
        ...(snap.lastTripReason !== undefined ? { lastTripReason: snap.lastTripReason } : {}),
      };
    });
  }

  snapshot(): CircuitBreakerRegistrySnapshot {
    const scopes = this.status();
    let closed = 0;
    let open = 0;
    let halfOpen = 0;
    for (const scope of scopes) {
      if (scope.state === 'closed') closed += 1;
      else if (scope.state === 'open') open += 1;
      else halfOpen += 1;
    }
    return {
      counts: { closed, open, halfOpen, total: scopes.length },
      scopes,
    };
  }
}
