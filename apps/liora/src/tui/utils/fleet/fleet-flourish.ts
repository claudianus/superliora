import type { AppState } from '#/tui/types';
import type { FooterBadge } from '#/tui/components/chrome/footer/footer-badges';
import { labelFleetDone } from '#/tui/components/chrome/footer/footer-labels';
import type { FooterLabels } from '#/tui/config';

/** Footer fleet-done micro-badge lifetime after a worker finishes. */
export const FLEET_FLOURISH_BADGE_TTL_MS = 2_000;

export type FleetWorkerSnapshot = {
  readonly id: string;
  readonly status: string;
};

const TERMINAL_STATUSES = new Set(['completed', 'done', 'idle']);

/** True when any worker leaves `running` for a terminal done/idle status. */
export function shouldFleetFlourishPulse(
  prev: readonly FleetWorkerSnapshot[] | null | undefined,
  next: readonly FleetWorkerSnapshot[] | null | undefined,
): boolean {
  if (next === null || next === undefined || next.length === 0) return false;
  if (prev === null || prev === undefined || prev.length === 0) return false;
  const prevById = new Map(prev.map((w) => [w.id, w.status]));
  for (const worker of next) {
    const prior = prevById.get(worker.id);
    if (prior !== 'running') continue;
    if (TERMINAL_STATUSES.has(worker.status)) return true;
  }
  return false;
}

/** Dopamine Ops footer glance — brief badge after fleet worker completion. */
export function formatFleetFlourishFooterBadge(
  flourish: AppState['fleetFlourish'],
  nowMs: number = Date.now(),
  labels: FooterLabels = 'plain',
): FooterBadge | null {
  if (flourish === undefined || flourish === null) return null;
  if (nowMs - flourish.atMs >= FLEET_FLOURISH_BADGE_TTL_MS) return null;
  return { text: labelFleetDone(labels), severity: 'info' };
}
