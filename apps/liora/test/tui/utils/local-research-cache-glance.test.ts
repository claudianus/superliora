import { describe, expect, it } from 'vitest';

import {
  formatLocalResearchCacheHitGlance,
  formatLocalResearchCacheOpsHealthLine,
  resolveLocalResearchCacheTelemetry,
} from '../../../src/tui/utils/search/local-research-cache-glance';

describe('local research cache hit glance', () => {
  it('formats hit rate and lookup counts from usage.localResearchCache', () => {
    expect(
      formatLocalResearchCacheHitGlance({
        localResearchCache: { hitRate: 0.75, hits: 3, misses: 1 },
      }),
    ).toBe('hit 75% · 3/4 lookups');
  });

  it('derives hit rate from hits and misses when hitRate is absent', () => {
    expect(
      formatLocalResearchCacheHitGlance({
        localResearchCache: { hits: 2, misses: 2 },
      }),
    ).toBe('hit 50% · 2/4 lookups');
  });

  it('returns null before telemetry is present on usage', () => {
    expect(formatLocalResearchCacheHitGlance(undefined)).toBeNull();
    expect(formatLocalResearchCacheHitGlance({})).toBeNull();
  });

  it('resolves telemetry from usage slice', () => {
    expect(
      resolveLocalResearchCacheTelemetry({
        localResearchCache: { hitRate: 1, hits: 5, misses: 0 },
      }),
    ).toEqual({ hitRate: 1, hits: 5, misses: 0 });
  });

  it('formats Ops Runtime Health line from usage.localResearchCache', () => {
    expect(
      formatLocalResearchCacheOpsHealthLine({
        localResearchCache: { hitRate: 0.8, hits: 4, misses: 1 },
      }),
    ).toBe('LocalResearchCache: hit 80% · 4/5 lookups');
    expect(formatLocalResearchCacheOpsHealthLine(undefined)).toBeNull();
    expect(formatLocalResearchCacheOpsHealthLine({})).toBeNull();
  });
});
