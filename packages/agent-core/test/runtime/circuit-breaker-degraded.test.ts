import { describe, expect, it, vi } from 'vitest';

import {
  buildCircuitBreakerDegradedEvent,
  circuitBreakerScopeToDegradedScope,
} from '../../src/runtime/circuit-breaker-degraded';
import { CircuitBreaker, CircuitBreakerRegistry } from '../../src/runtime/circuit-breaker';

describe('circuitBreakerScopeToDegradedScope', () => {
  it('distinguishes provider scopes from other native scopes', () => {
    expect(circuitBreakerScopeToDegradedScope('llm:primary')).toBe('llm');
    expect(circuitBreakerScopeToDegradedScope('proxy:primary')).toBe('other');
    expect(circuitBreakerScopeToDegradedScope('not-llm:primary')).toBe('other');
  });
});

describe('buildCircuitBreakerDegradedEvent', () => {

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

});
