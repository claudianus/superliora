import type { CircuitBreakerStatus } from '@superliora/protocol';

import type { CircuitBreakerRegistrySnapshot } from './circuit-breaker';

/** Map registry snapshot to SDK / protocol SessionStatus.circuitBreakers shape. */
export function mapCircuitBreakerRegistrySnapshot(
  snapshot: CircuitBreakerRegistrySnapshot,
): CircuitBreakerStatus | undefined {
  if (snapshot.counts.total === 0) return undefined;

  const scopes = snapshot.scopes.map((scope) => ({
    id: scope.id,
    state: scope.state,
    failures: scope.failures,
    ...(scope.lastTripReason !== undefined ? { lastTripReason: scope.lastTripReason } : {}),
  }));

  const lastTripReason =
    snapshot.scopes.find((scope) => scope.state === 'open' && scope.lastTripReason !== undefined)
      ?.lastTripReason ??
    snapshot.scopes.find((scope) => scope.lastTripReason !== undefined)?.lastTripReason;

  return {
    closed: snapshot.counts.closed,
    open: snapshot.counts.open,
    halfOpen: snapshot.counts.halfOpen,
    scopes,
    ...(lastTripReason !== undefined ? { lastTripReason } : {}),
  };
}
