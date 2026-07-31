import { describe, expect, it } from 'vitest';

import {
  getLocalResearchCacheTelemetry,
  recordLocalResearchCacheHit,
  recordLocalResearchCacheMiss,
  resetLocalResearchCacheTelemetry,
} from '../../../src/tools/providers/local-research-cache-telemetry';

describe('local-research-cache-telemetry', () => {
  it('starts at zero with no hitRate', () => {
    resetLocalResearchCacheTelemetry();
    expect(getLocalResearchCacheTelemetry()).toEqual({ hits: 0, misses: 0 });
  });

  it('tracks hits and misses and derives hitRate', () => {
    resetLocalResearchCacheTelemetry();
    recordLocalResearchCacheMiss();
    recordLocalResearchCacheHit(3);
    expect(getLocalResearchCacheTelemetry()).toEqual({
      hits: 3,
      misses: 1,
      hitRate: 0.75,
    });
  });
});
