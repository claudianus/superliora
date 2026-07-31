/**
 * Free-only search fallback — live never-empty telemetry grading (Settings + Ops).
 */

import type { SearchNeverEmptyTelemetry } from '@superliora/sdk';

import {
  SEARCH_FREE_ONLY_ATTEMPT_TARGET,
  SEARCH_FREE_ONLY_SUCCESS_TARGET,
} from './search-free-only-kpi-grade';

import {
  resolveSearchNeverEmptyTelemetry,
  type UsageSearchNeverEmptyLike,
} from './search-never-empty-telemetry';

export interface SearchFreeOnlyKpiMeterResult {
  readonly line: string;
  readonly meetsSuccessTarget: boolean;
  readonly meetsKpi: boolean;
}

/** Grade live never-empty counters against free-only KPI targets (SSOT constants). */
export function gradeSearchFreeOnlyKpiFromNeverEmpty(
  telemetry: SearchNeverEmptyTelemetry,
): SearchFreeOnlyKpiMeterResult | null {
  const attemptCount = telemetry.softDegradeCount + telemetry.hardFailCount;
  if (attemptCount <= 0) return null;

  const successRate = telemetry.softDegradeCount / attemptCount;
  const pct = Math.round(successRate * 100);
  const targetPct = Math.round(SEARCH_FREE_ONLY_SUCCESS_TARGET * 100);
  const meetsSuccessTarget = successRate >= SEARCH_FREE_ONLY_SUCCESS_TARGET;
  const meetsKpi =
    telemetry.hardFailCount === 0 &&
    meetsSuccessTarget &&
    attemptCount >= SEARCH_FREE_ONLY_ATTEMPT_TARGET;

  const targetSuffix = `target ≥${String(targetPct)}%`;
  const line =
    telemetry.hardFailCount > 0
      ? `soft ${String(pct)}% · hard-fail ${String(telemetry.hardFailCount)} · requires hard-fail 0`
      : meetsSuccessTarget
        ? `soft ${String(pct)}% · hard-fail 0 · ${targetSuffix}`
        : `soft ${String(pct)}% · hard-fail 0 · below ${targetSuffix}`;

  return { line, meetsSuccessTarget, meetsKpi };
}

/** Settings session line when WebSearch/DeepResearch degrade counters exist; null before first degrade. */
export function formatSearchFreeOnlyKpiSessionGlance(
  usage: UsageSearchNeverEmptyLike | undefined | null,
): string | null {
  const telemetry = resolveSearchNeverEmptyTelemetry(usage);
  if (telemetry === undefined) return null;
  const meter = gradeSearchFreeOnlyKpiFromNeverEmpty(telemetry);
  return meter?.line ?? null;
}
