import type { AppState } from '#/tui/types';

import {
  formatNeverHaltBreakerLines,
  formatOpsBreakerLine,
  type CircuitBreakerStatusLike,
  type RuntimeDegradedLike,
} from './breaker-summary';

export interface BreakerSources {
  readonly appStateBreakers?: AppState['circuitBreakers'];
  readonly statusBreakers?: CircuitBreakerStatusLike;
  readonly degraded?: RuntimeDegradedLike | null;
}

/** Registry snapshot synced from agent.status.updated / getStatus. */
export function resolveBreakerFromAppState(
  breakers: AppState['circuitBreakers'],
): CircuitBreakerStatusLike | undefined {
  if (breakers === undefined || breakers === null) return undefined;
  return breakers;
}

/** Prefer live getStatus; fall back to AppState between refreshes. */
export function resolveBreakerStatus(sources: BreakerSources): CircuitBreakerStatusLike | undefined {
  if (sources.statusBreakers !== undefined) return sources.statusBreakers;
  return resolveBreakerFromAppState(sources.appStateBreakers);
}

export function resolveOpsBreakerLine(sources: BreakerSources): string {
  return formatOpsBreakerLine(resolveBreakerStatus(sources), sources.degraded);
}

/** Ops Runtime Health SSOT — AppState.circuitBreakers only (not live getStatus bypass). */
export function resolveOpsBreakerLineFromAppState(
  appStateBreakers: AppState['circuitBreakers'],
  degraded?: RuntimeDegradedLike | null,
): string {
  return formatOpsBreakerLine(resolveBreakerFromAppState(appStateBreakers), degraded);
}

export function resolveNeverHaltBreakerLines(sources: BreakerSources): string[] {
  return formatNeverHaltBreakerLines(resolveBreakerStatus(sources), sources.degraded);
}
