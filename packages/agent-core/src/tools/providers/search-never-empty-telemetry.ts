/**
 * Never-empty runtime counters — hard-fail vs soft-degrade (process-wide).
 * Recorded on WebSearch / DeepResearch degrade paths; surfaced via ResearchSearchEngine.status()
 * and UsageStatus.searchNeverEmpty for Settings / Ops.
 */

export interface SearchNeverEmptyTelemetry {
  readonly hardFailCount: number;
  readonly softDegradeCount: number;
}

let hardFailCount = 0;
let softDegradeCount = 0;

/** Soft-degrade: never-empty wrapper returned ok with degraded output (loop survives). */
export function recordSearchNeverEmptySoftDegrade(count = 1): void {
  if (count <= 0) return;
  softDegradeCount += count;
}

/** Hard-fail: turn-killing search outcome (target 0). */
export function recordSearchNeverEmptyHardFail(count = 1): void {
  if (count <= 0) return;
  hardFailCount += count;
}

export function getSearchNeverEmptyTelemetry(): SearchNeverEmptyTelemetry {
  return { hardFailCount, softDegradeCount };
}

/** Settings / Ops one-liner, e.g. `hard-fail 0 · soft-degrade 3`. */
export function formatSearchNeverEmptyTelemetryLine(
  telemetry: SearchNeverEmptyTelemetry = getSearchNeverEmptyTelemetry(),
): string {
  return `hard-fail ${String(telemetry.hardFailCount)} · soft-degrade ${String(telemetry.softDegradeCount)}`;
}

/** Test isolation — not for production resets. */
export function resetSearchNeverEmptyTelemetry(): void {
  hardFailCount = 0;
  softDegradeCount = 0;
}
