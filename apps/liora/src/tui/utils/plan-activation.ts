import type { Session } from '@superliora/sdk';

/**
 * Where planning landed after `setPlanMode(true)`.
 *
 * `inline` — plan mode is active on this lane and owns the plan file.
 * `delegated` — Conductor handed the task to a Plan Desk job (worker owns it).
 * `unknown` — the status read failed; the UI must not claim either outcome.
 */
export type PlanActivation = 'inline' | 'delegated' | 'unknown';

/**
 * Read back which of the two `setPlanMode(true)` outcomes happened. A failed
 * read stays `unknown` rather than collapsing to `delegated`, so a transient
 * RPC error cannot hide a plan mode that is actually on.
 */
export async function resolvePlanActivation(
  session: Pick<Session, 'getStatus'>,
): Promise<PlanActivation> {
  const status = await session.getStatus().catch(() => undefined);
  if (status === undefined) return 'unknown';
  return status.planMode ? 'inline' : 'delegated';
}
