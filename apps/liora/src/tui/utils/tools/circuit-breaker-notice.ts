/**
 * Loop25a — surface engine tool circuit-breaker open blocks in the TUI.
 * Loop29a — surface half-open/open → closed recovery after a successful probe.
 *
 * agent-core returns isError tool results with CIRCUIT_BREAKER_OPEN when a tool
 * is short-circuited after repeated failures, and appends CIRCUIT_BREAKER_RECOVERED
 * on a successful probe. Without notices the operator only sees a red/green card.
 */

import { ttui } from '#/tui/utils/tui-i18n';

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
    title: ttui('tui.notice.circuitOpen.title'),
    detail: ttui('tui.notice.circuitOpen.detail', { tool, code: CIRCUIT_BREAKER_OPEN_CODE }),
    status: ttui('tui.notice.circuitOpen.status', { tool }),
    coalesceKey: 'circuit-breaker-open',
  };
}

export function formatCircuitBreakerRecoveredNotice(
  toolName?: string,
): CircuitBreakerRecoveredNotice {
  const tool = toolName !== undefined && toolName.length > 0 ? toolName : 'tool';
  return {
    title: ttui('tui.notice.circuitRecovered.title'),
    detail: ttui('tui.notice.circuitRecovered.detail', {
      tool,
      code: CIRCUIT_BREAKER_RECOVERED_CODE,
    }),
    status: ttui('tui.notice.circuitRecovered.status', { tool }),
    coalesceKey: 'circuit-breaker-recovered',
  };
}
