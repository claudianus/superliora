import type { RuntimeDegradedEvent, RuntimeDegradedScope } from '@superliora/protocol';

const CIRCUIT_BREAKER_DEGRADED_HINT =
  'Circuit breaker opened; /ops shows live provider status.';

/** Classify the actual native breaker scope for clients. */
export function circuitBreakerScopeToDegradedScope(scopeId: string): RuntimeDegradedScope {
  if (scopeId.startsWith('llm:')) return 'llm';
  return 'other';
}

export function buildCircuitBreakerDegradedEvent(
  scopeId: string,
  lastTripReason?: string,
  atMs: number = Date.now(),
): RuntimeDegradedEvent {
  const reason =
    lastTripReason !== undefined && lastTripReason.trim().length > 0
      ? lastTripReason.trim()
      : `circuit_breaker_open:${scopeId}`;
  return {
    type: 'runtime.degraded',
    scope: circuitBreakerScopeToDegradedScope(scopeId),
    reason,
    hint: CIRCUIT_BREAKER_DEGRADED_HINT,
    atMs,
  };
}
