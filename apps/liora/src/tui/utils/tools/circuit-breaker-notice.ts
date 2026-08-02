/**
 * Loop25a — surface engine tool circuit-breaker open blocks in the TUI.
 * Loop29a — surface half-open/open → closed recovery after a successful probe.
 *
 * agent-core returns isError tool results with CIRCUIT_BREAKER_OPEN when a tool
 * is short-circuited after repeated failures, and appends CIRCUIT_BREAKER_RECOVERED
 * on a successful probe. Without notices the operator only sees a red/green card.
 */

export const CIRCUIT_BREAKER_OPEN_CODE = 'CIRCUIT_BREAKER_OPEN';
export const CIRCUIT_BREAKER_RECOVERED_CODE = 'CIRCUIT_BREAKER_RECOVERED';

export type CircuitBreakerOpenNotice = {
  readonly title: string;
  readonly detail: string;
  readonly status: string;
  readonly coalesceKey: 'circuit-breaker-open';
};

export type CircuitBreakerRecoveredNotice = {
  readonly title: string;
  readonly detail: string;
  readonly status: string;
  readonly coalesceKey: 'circuit-breaker-recovered';
};

export type CircuitBreakerNotice = CircuitBreakerOpenNotice | CircuitBreakerRecoveredNotice;

function outputText(output: unknown): string | undefined {
  if (typeof output === 'string') return output;
  if (output !== null && typeof output === 'object') {
    try {
      return JSON.stringify(output);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function isCircuitBreakerOpenOutput(output: unknown): boolean {
  const text = outputText(output);
  if (text === undefined) return false;
  return (
    text.includes(CIRCUIT_BREAKER_OPEN_CODE) ||
    text.includes('Circuit breaker open')
  );
}

export function isCircuitBreakerRecoveredOutput(output: unknown): boolean {
  const text = outputText(output);
  if (text === undefined) return false;
  return text.includes(CIRCUIT_BREAKER_RECOVERED_CODE);
}

export function formatCircuitBreakerOpenNotice(toolName?: string): CircuitBreakerOpenNotice {
  const tool = toolName !== undefined && toolName.length > 0 ? toolName : 'tool';
  return {
    title: 'Circuit breaker open',
    detail: `${tool} is short-circuited after repeated failures (code=${CIRCUIT_BREAKER_OPEN_CODE}). Use another tool or wait for cooldown — do not retry the same call.`,
    status: `Tool blocked: circuit breaker open on ${tool}`,
    coalesceKey: 'circuit-breaker-open',
  };
}

export function formatCircuitBreakerRecoveredNotice(
  toolName?: string,
): CircuitBreakerRecoveredNotice {
  const tool = toolName !== undefined && toolName.length > 0 ? toolName : 'tool';
  return {
    title: 'Circuit breaker recovered',
    detail: `${tool} probe succeeded after cooldown (code=${CIRCUIT_BREAKER_RECOVERED_CODE}). Circuit closed — the tool is available again.`,
    status: `Tool recovered: circuit closed on ${tool}`,
    coalesceKey: 'circuit-breaker-recovered',
  };
}
