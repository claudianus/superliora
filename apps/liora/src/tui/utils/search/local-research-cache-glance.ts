/**
 * W13 LocalResearchCache hit glance — reads UsageStatus.localResearchCache when wired.
 */

export interface LocalResearchCacheTelemetry {
  readonly hitRate?: number;
  readonly hits?: number;
  readonly misses?: number;
}

export interface UsageLocalResearchCacheLike {
  readonly localResearchCache?: LocalResearchCacheTelemetry;
}

export const LOCAL_RESEARCH_CACHE_HIT_STUB_TIP =
  'LocalResearchCache hit: session lookup hit% (after WebSearch / DeepResearch in session)';

function resolveHitRate(telemetry: LocalResearchCacheTelemetry): number | undefined {
  if (telemetry.hitRate !== undefined && Number.isFinite(telemetry.hitRate)) {
    return telemetry.hitRate;
  }
  const hits = telemetry.hits;
  const misses = telemetry.misses;
  if (
    hits !== undefined &&
    misses !== undefined &&
    Number.isFinite(hits) &&
    Number.isFinite(misses)
  ) {
    const total = hits + misses;
    if (total <= 0) return undefined;
    return hits / total;
  }
  return undefined;
}

/** Resolve counters from session usage when present. */
export function resolveLocalResearchCacheTelemetry(
  usage: UsageLocalResearchCacheLike | undefined | null,
): LocalResearchCacheTelemetry | undefined {
  const telemetry = usage?.localResearchCache;
  if (telemetry === undefined) return undefined;
  if (
    resolveHitRate(telemetry) === undefined &&
    telemetry.hits === undefined &&
    telemetry.misses === undefined
  ) {
    return undefined;
  }
  return telemetry;
}

/** Settings line when hit telemetry exists; null before any cache lookup in session. */
export function formatLocalResearchCacheHitGlance(
  usage: UsageLocalResearchCacheLike | undefined | null,
): string | null {
  const telemetry = resolveLocalResearchCacheTelemetry(usage);
  if (telemetry === undefined) return null;
  const rate = resolveHitRate(telemetry);
  const hits = telemetry.hits;
  const misses = telemetry.misses;
  const parts: string[] = [];
  if (rate !== undefined) {
    parts.push(`hit ${String(Math.round(rate * 100))}%`);
  }
  if (
    hits !== undefined &&
    misses !== undefined &&
    Number.isFinite(hits) &&
    Number.isFinite(misses)
  ) {
    parts.push(`${String(hits)}/${String(hits + misses)} lookups`);
  } else if (hits !== undefined && Number.isFinite(hits)) {
    parts.push(`${String(hits)} hits`);
  }
  if (parts.length === 0) return null;
  return parts.join(' · ');
}

/** Ops Runtime Health line when hit telemetry exists; null before any cache lookup in session. */
export function formatLocalResearchCacheOpsHealthLine(
  usage: UsageLocalResearchCacheLike | undefined | null,
): string | null {
  const glance = formatLocalResearchCacheHitGlance(usage);
  return glance !== null ? `LocalResearchCache: ${glance}` : null;
}
