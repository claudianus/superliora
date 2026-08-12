/** Shared Mission Control formatters (panel + densemode). */

/** Live thinking/answer strip stays "hot" this long after the last delta. */
export const MISSION_LIVE_HOT_MS = 2_500;

/**
 * Paint-time elapsed so clocks keep moving without a registry version bump
 * on every progress heartbeat. Terminal workers keep the frozen snapshot value.
 */
export function liveWorkerElapsedMs(
  worker: {
    readonly elapsedMs: number;
    readonly spawnedAtMs: number;
    readonly terminalAtMs?: number;
    readonly progressAtMs?: number;
    readonly progressElapsedMs?: number;
  },
  nowMs: number,
): number {
  if (worker.terminalAtMs !== undefined) {
    return worker.elapsedMs;
  }
  if (
    worker.progressElapsedMs !== undefined &&
    worker.progressAtMs !== undefined
  ) {
    return worker.progressElapsedMs + Math.max(0, nowMs - worker.progressAtMs);
  }
  return Math.max(0, nowMs - worker.spawnedAtMs);
}

/** @deprecated Prefer {@link formatMissionAgeMs} for MOVES / TAPE rows. */
export function formatMissionClockMs(atMs: number): string {
  const date = new Date(atMs);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Compact relative age for MOVES/TAPE rows: `now`, `3s ago`, `2m ago`, `1h ago`.
 */
export function formatMissionAgeMs(atMs: number, nowMs: number): string {
  const ageMs = Math.max(0, nowMs - atMs);
  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 1) return 'now';
  if (seconds < 60) return `${String(seconds)}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  const days = Math.floor(hours / 24);
  return `${String(days)}d ago`;
}

/** Dense token chip (`12482` → `12.5k`). */
export function formatMissionTokens(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

/** Live rate chip (`840` → `840/s`, `12400` → `12.4k/s`). */
export function formatMissionTokenRate(perSec: number): string {
  if (!Number.isFinite(perSec) || perSec < 1) return '';
  if (perSec < 1000) return `${String(Math.round(perSec))}/s`;
  if (perSec < 1_000_000) return `${(perSec / 1000).toFixed(1)}k/s`;
  return `${(perSec / 1_000_000).toFixed(1)}M/s`;
}
