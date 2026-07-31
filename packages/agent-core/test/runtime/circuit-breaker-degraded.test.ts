import { describe, expect, it, vi } from 'vitest';

import {
  buildCircuitBreakerDegradedEvent,
  circuitBreakerScopeToDegradedScope,
  CIRCUIT_BREAKER_DEGRADED_HINT,
} from '../../src/runtime/circuit-breaker-degraded';
import { simulateNeverHaltDegradedChaos } from '../../src/runtime/never-halt-chaos';
import { CircuitBreaker, CircuitBreakerRegistry } from '../../src/runtime/circuit-breaker';

describe('circuitBreakerScopeToDegradedScope', () => {
  it('maps search and llm prefixes', () => {
    expect(circuitBreakerScopeToDegradedScope('search:brave')).toBe('search');
    expect(circuitBreakerScopeToDegradedScope('llm:primary')).toBe('llm');
    expect(circuitBreakerScopeToDegradedScope('mcp:foo')).toBe('other');
  });
});

describe('buildCircuitBreakerDegradedEvent', () => {
  it('includes lastTripReason and never-halt hint', () => {
    expect(buildCircuitBreakerDegradedEvent('search:brave', 'brave 429', 42_000)).toEqual({
      type: 'runtime.degraded',
      scope: 'search',
      reason: 'brave 429',
      hint: CIRCUIT_BREAKER_DEGRADED_HINT,
      atMs: 42_000,
    });
  });

  it('falls back to scope id when reason missing', () => {
    expect(buildCircuitBreakerDegradedEvent('llm:k2').reason).toBe('circuit_breaker_open:llm:k2');
  });
});

describe('CircuitBreaker open transition emit', () => {
  it('recordFailure returns opened=true only on closed→open', () => {
    const onOpened = vi.fn();
    const breaker = new CircuitBreaker({
      failureThreshold: 2,
      onOpened,
    });

    expect(breaker.recordFailure()).toBe(false);
    expect(onOpened).not.toHaveBeenCalled();
    expect(breaker.recordFailure('provider 429')).toBe(true);
    expect(onOpened).toHaveBeenCalledOnce();
    expect(onOpened).toHaveBeenCalledWith('provider 429');

    expect(breaker.recordFailure('still failing')).toBe(false);
    expect(onOpened).toHaveBeenCalledOnce();
  });

  it('registry onScopeOpened fires once per scope open with scope id', () => {
    const onScopeOpened = vi.fn();
    const registry = new CircuitBreakerRegistry({
      failureThreshold: 1,
      onScopeOpened,
    });

    registry.get('search:brave').recordFailure('brave 429');
    registry.get('llm:primary').recordFailure('429 rate limit');

    expect(onScopeOpened).toHaveBeenCalledTimes(2);
    expect(onScopeOpened).toHaveBeenNthCalledWith(1, 'search:brave', 'brave 429');
    expect(onScopeOpened).toHaveBeenNthCalledWith(2, 'llm:primary', '429 rate limit');

    registry.get('search:brave').recordFailure('ignored');
    expect(onScopeOpened).toHaveBeenCalledTimes(2);
  });

  it('re-opens from half_open after cooldown', () => {
    let now = 0;
    const onOpened = vi.fn();
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      cooldownMs: 100,
      now: () => now,
      onOpened,
    });

    breaker.recordFailure('first trip');
    expect(onOpened).toHaveBeenCalledOnce();

    now += 100;
    expect(breaker.getState()).toBe('half_open');
    breaker.recordFailure('second trip');
    expect(onOpened).toHaveBeenCalledTimes(2);
    expect(onOpened).toHaveBeenLastCalledWith('second trip');
  });

  it('chaos: breaker open maps to runtime.degraded and goal loop soft-survives', () => {
    const onScopeOpened = vi.fn();
    const registry = new CircuitBreakerRegistry({
      failureThreshold: 1,
      onScopeOpened,
    });
    registry.get('search:brave').recordFailure('brave 429');
    expect(onScopeOpened).toHaveBeenCalledWith('search:brave', 'brave 429');

    const event = buildCircuitBreakerDegradedEvent('search:brave', 'brave 429', 42_000);
    expect(event.scope).toBe('search');

    const chaos = simulateNeverHaltDegradedChaos(42_000);
    expect(chaos.goalTickCompleted).toBe(true);
    expect(chaos.degradedEvents.some((e) => e.scope === 'search')).toBe(true);
  });
});
