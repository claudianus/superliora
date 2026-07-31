/**
 * W13 LocalResearchCache session counters — hit/miss on disk cache lookups.
 * Recorded by LocalWebSearchProvider; surfaced via UsageStatus.localResearchCache.
 */

export interface LocalResearchCacheTelemetry {
  readonly hits: number;
  readonly misses: number;
  readonly hitRate?: number;
}

let hits = 0;
let misses = 0;

export function recordLocalResearchCacheHit(count = 1): void {
  if (count <= 0) return;
  hits += count;
}

export function recordLocalResearchCacheMiss(count = 1): void {
  if (count <= 0) return;
  misses += count;
}

export function getLocalResearchCacheTelemetry(): LocalResearchCacheTelemetry {
  const total = hits + misses;
  return {
    hits,
    misses,
    ...(total > 0 ? { hitRate: hits / total } : {}),
  };
}

/** Test isolation — not for production resets. */
export function resetLocalResearchCacheTelemetry(): void {
  hits = 0;
  misses = 0;
}
