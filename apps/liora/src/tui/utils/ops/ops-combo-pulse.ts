import type { AppState } from '#/tui/types';
import type { FooterBadge } from '#/tui/components/chrome/footer/footer-badges';
import { CACHE_HIT_TARGET } from '#/tui/utils/cache/cache-hit-meter';
import { isRuntimeDegradedActive } from '#/tui/utils/never-halt/runtime-degraded';

/** Max span between goal-xp and fleet flourish timestamps for a combo. */
export const OPS_COMBO_WINDOW_MS = 10_000;

/** Footer `combo×N` micro-badge lifetime once all three ops signals align. */
export const OPS_COMBO_PULSE_TTL_MS = 2_000;

export type OpsComboPulseSignal = { readonly atMs: number };

export type ShouldOpsComboPulseInput = {
  readonly goalXp: OpsComboPulseSignal | null | undefined;
  readonly cacheOk: boolean;
  readonly fleetOk: OpsComboPulseSignal | null | undefined;
  readonly now: number;
};

export type OpsComboSnapshot = { readonly atMs: number; readonly score: number };

/** True when goal-xp, cache target, and fleet flourish timestamps align within the window. */
export function shouldOpsComboPulse(input: ShouldOpsComboPulseInput): OpsComboSnapshot | null {
  const { goalXp, cacheOk, fleetOk, now } = input;
  if (!cacheOk) return null;
  if (goalXp === null || goalXp === undefined) return null;
  if (fleetOk === null || fleetOk === undefined) return null;
  if (now - goalXp.atMs > OPS_COMBO_WINDOW_MS) return null;
  if (now - fleetOk.atMs > OPS_COMBO_WINDOW_MS) return null;
  if (Math.abs(goalXp.atMs - fleetOk.atMs) > OPS_COMBO_WINDOW_MS) return null;
  return { atMs: Math.max(goalXp.atMs, fleetOk.atMs), score: 3 };
}

function cacheMeterMeetsTarget(cacheMeter: AppState['cacheMeter']): boolean {
  if (cacheMeter === undefined || cacheMeter === null) return false;
  return Number.isFinite(cacheMeter.rate) && cacheMeter.rate >= CACHE_HIT_TARGET;
}

/** Derive combo snapshot from live AppState fields — no dedicated event path. */
export function computeOpsComboPulse(
  state: Pick<AppState, 'goalXpPulse' | 'cacheMeter' | 'fleetFlourish' | 'runtimeDegraded'>,
  nowMs: number = Date.now(),
): OpsComboSnapshot | null {
  if (isRuntimeDegradedActive(state.runtimeDegraded, nowMs)) return null;
  const combo = shouldOpsComboPulse({
    goalXp: state.goalXpPulse,
    cacheOk: cacheMeterMeetsTarget(state.cacheMeter),
    fleetOk: state.fleetFlourish,
    now: nowMs,
  });
  if (combo === null) return null;
  if (nowMs - combo.atMs >= OPS_COMBO_PULSE_TTL_MS) return null;
  return combo;
}

/** Dopamine Ops footer glance — brief `combo×N` badge after triple alignment. */
export function formatOpsComboFooterBadge(
  combo: OpsComboSnapshot | null | undefined,
  nowMs: number = Date.now(),
): FooterBadge | null {
  if (combo === null || combo === undefined) return null;
  if (nowMs - combo.atMs >= OPS_COMBO_PULSE_TTL_MS) return null;
  return { text: `combo×${String(combo.score)}`, severity: 'info' };
}
