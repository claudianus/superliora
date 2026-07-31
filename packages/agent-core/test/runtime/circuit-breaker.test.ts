import { describe, expect, it } from 'vitest';

import { CircuitBreaker, CircuitBreakerRegistry } from '../../src/runtime/circuit-breaker';

describe('CircuitBreaker', () => {
  it('opens after threshold failures and recovers after cooldown', () => {
    let now = 1_000;
    const breaker = new CircuitBreaker({
      failureThreshold: 2,
      cooldownMs: 100,
      now: () => now,
    });

    expect(breaker.allow()).toBe(true);
    expect(breaker.recordFailure()).toBe(false);
    expect(breaker.getState()).toBe('closed');
    expect(breaker.recordFailure('provider 429')).toBe(true);
    expect(breaker.getState()).toBe('open');
    expect(breaker.allow()).toBe(false);
    expect(breaker.snapshot().lastTripReason).toBe('provider 429');

    now += 100;
    expect(breaker.getState()).toBe('half_open');
    expect(breaker.allow()).toBe(true);
    breaker.recordSuccess();
    expect(breaker.getState()).toBe('closed');
    expect(breaker.snapshot().lastTripReason).toBeUndefined();
  });
});

describe('CircuitBreakerRegistry', () => {
  it('snapshot aggregates open/half/closed counts and scopes', () => {
    let now = 0;
    const registry = new CircuitBreakerRegistry({
      failureThreshold: 1,
      cooldownMs: 60_000,
      now: () => now,
    });

    registry.get('brave').recordFailure('brave 429');
    registry.get('tavily').recordFailure('tavily 5xx');
    now += 60_000;
    registry.get('exa').recordFailure();
    registry.get('exa').recordSuccess();

    const snap = registry.snapshot();
    expect(snap.counts).toEqual({ closed: 1, open: 0, halfOpen: 2, total: 3 });
    expect(snap.scopes.map((s) => s.id).sort()).toEqual(['brave', 'exa', 'tavily']);
    expect(snap.scopes.find((s) => s.id === 'brave')?.lastTripReason).toBe('brave 429');
  });
});
