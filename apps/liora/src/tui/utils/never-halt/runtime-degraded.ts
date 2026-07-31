/**
 * Never-Halt runtime.degraded TTL — footer badge + Ops glance share one clock.
 */

import type { AppState } from '#/tui/types';

export const RUNTIME_DEGRADED_BADGE_TTL_MS = 120_000;

export type RuntimeDegradedState = NonNullable<AppState['runtimeDegraded']>;

/** True while degraded snapshot is within the footer/Ops TTL window. */
export function isRuntimeDegradedActive(
  degraded: AppState['runtimeDegraded'],
  nowMs: number = Date.now(),
): degraded is RuntimeDegradedState {
  if (degraded === undefined || degraded === null) return false;
  return nowMs - degraded.atMs <= RUNTIME_DEGRADED_BADGE_TTL_MS;
}

/** Active degraded snapshot, or null when absent or expired. */
export function activeRuntimeDegraded(
  degraded: AppState['runtimeDegraded'],
  nowMs: number = Date.now(),
): RuntimeDegradedState | null {
  return isRuntimeDegradedActive(degraded, nowMs) ? degraded : null;
}

/** Patch to clear expired runtimeDegraded from AppState; null when no update needed. */
export function staleRuntimeDegradedClearPatch(
  degraded: AppState['runtimeDegraded'],
  nowMs: number = Date.now(),
): Pick<AppState, 'runtimeDegraded'> | null {
  if (degraded === undefined || degraded === null) return null;
  if (isRuntimeDegradedActive(degraded, nowMs)) return null;
  return { runtimeDegraded: null };
}
