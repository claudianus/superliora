/**
 * W13 never-empty telemetry glance — reads UsageStatus.searchNeverEmpty from getStatus.
 */

import {
  formatSearchNeverEmptyTelemetryLine as formatSearchNeverEmptyTelemetryLineCore,
  type SearchNeverEmptyTelemetry,
} from '@superliora/sdk';

export type { SearchNeverEmptyTelemetry };

export const SEARCH_NEVER_EMPTY_TELEMETRY_STUB_TIP =
  'Never-empty counters: hard-fail · soft-degrade (after WebSearch / DeepResearch in session)';

/** Re-export SSOT formatter from SDK (agent-core telemetry module). */
export function formatSearchNeverEmptyTelemetryLine(
  telemetry: SearchNeverEmptyTelemetry,
): string {
  return formatSearchNeverEmptyTelemetryLineCore(telemetry);
}

export interface UsageSearchNeverEmptyLike {
  readonly searchNeverEmpty?: SearchNeverEmptyTelemetry;
}

/** Resolve counters from session usage when present. */
export function resolveSearchNeverEmptyTelemetry(
  usage: UsageSearchNeverEmptyLike | undefined | null,
): SearchNeverEmptyTelemetry | undefined {
  const telemetry = usage?.searchNeverEmpty;
  if (telemetry === undefined) return undefined;
  if (
    !Number.isFinite(telemetry.hardFailCount) ||
    !Number.isFinite(telemetry.softDegradeCount)
  ) {
    return undefined;
  }
  return telemetry;
}

/** Settings line when counters exist; null before any search degrade in session. */
export function formatSearchNeverEmptyTelemetryGlance(
  usage: UsageSearchNeverEmptyLike | undefined | null,
): string | null {
  const telemetry = resolveSearchNeverEmptyTelemetry(usage);
  if (telemetry === undefined) return null;
  return formatSearchNeverEmptyTelemetryLine(telemetry);
}

/** Ops Runtime Health line when counters exist; null before any search degrade in session. */
export function formatSearchNeverEmptyOpsHealthLine(
  usage: UsageSearchNeverEmptyLike | undefined | null,
): string | null {
  const glance = formatSearchNeverEmptyTelemetryGlance(usage);
  return glance !== null ? `Never-empty: ${glance}` : null;
}
