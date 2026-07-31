import { describe, expect, it } from 'vitest';

import { CircuitBreakerRegistry } from '../../src/runtime/circuit-breaker';
import { mapCircuitBreakerRegistrySnapshot } from '../../src/runtime/circuit-breaker-status';

describe('mapCircuitBreakerRegistrySnapshot', () => {
  it('returns undefined when no scopes have been touched', () => {
    const registry = new CircuitBreakerRegistry();
    expect(mapCircuitBreakerRegistrySnapshot(registry.snapshot())).toBeUndefined();
  });

  it('maps counts, scopes, and lastTripReason for TUI breaker-summary', () => {
    let now = 0;
    const registry = new CircuitBreakerRegistry({
      failureThreshold: 1,
      cooldownMs: 60_000,
      now: () => now,
    });

    registry.get('brave').recordFailure('brave 429');
    registry.get('tavily').recordFailure('tavily 5xx');
    now += 60_000;

    const mapped = mapCircuitBreakerRegistrySnapshot(registry.snapshot());
    expect(mapped).toEqual({
      closed: 0,
      open: 0,
      halfOpen: 2,
      lastTripReason: 'brave 429',
      scopes: [
        { id: 'brave', state: 'half_open', failures: 1, lastTripReason: 'brave 429' },
        { id: 'tavily', state: 'half_open', failures: 1, lastTripReason: 'tavily 5xx' },
      ],
    });
  });
});
