import { describe, expect, it } from 'vitest';

import { buildSessionStatus } from '#/rpc/rpc-helpers';

const baseFacets = {
  config: {
    modelAlias: 'mock-model',
    thinkingLevel: 'off',
    roleModels: undefined,
    provider: undefined,
    modelCapabilities: { max_context_tokens: 1_000_000 },
  },
  context: { tokenCount: 100, contextOS: undefined, microCompaction: undefined, autoDream: undefined },
  permission: { mode: 'manual' as const },
  plan: null,
  swarmMode: false,
  premiumQualityMode: false,
  usage: undefined,
  providerRouteStatus: null,
  circuitBreakers: undefined,
  cacheFrozen: undefined,
  parallelTools: undefined,
  oauth: undefined,
};

describe('buildSessionStatus cacheFrozen', () => {
  it('omits cacheFrozen when the facet is undefined', () => {
    const status = buildSessionStatus(baseFacets);
    expect(status).not.toHaveProperty('cacheFrozen');
  });

  it('maps cacheFrozen=true and cacheFrozen=false when wired', () => {
    expect(buildSessionStatus({ ...baseFacets, cacheFrozen: true }).cacheFrozen).toBe(true);
    expect(buildSessionStatus({ ...baseFacets, cacheFrozen: false }).cacheFrozen).toBe(false);
  });
});

describe('buildSessionStatus cache meter', () => {
  it('maps cacheHitRate and cacheWarmStreak from usage when present', () => {
    const status = buildSessionStatus({
      ...baseFacets,
      usage: {
        total: {
          inputOther: 10,
          output: 5,
          inputCacheRead: 990,
          inputCacheCreation: 0,
        },
        cacheHitRate: 0.99,
        cacheWarmStreak: 4,
      },
    });
    expect(status.cacheHitRate).toBe(0.99);
    expect(status.cacheWarmStreak).toBe(4);
  });

  it('omits cacheWarmStreak when usage has no streak', () => {
    const status = buildSessionStatus({
      ...baseFacets,
      usage: {
        total: {
          inputOther: 100,
          output: 0,
          inputCacheRead: 0,
          inputCacheCreation: 0,
        },
        cacheHitRate: 0,
      },
    });
    expect(status.cacheHitRate).toBe(0);
    expect(status.cacheWarmStreak).toBeUndefined();
  });
});

describe('buildSessionStatus parallel tools', () => {
  it('omits parallel tool fields when idle with no turn peak', () => {
    const status = buildSessionStatus({
      ...baseFacets,
      parallelTools: { parallelToolsInFlight: 0 },
    });
    expect(status).not.toHaveProperty('parallelToolsInFlight');
    expect(status).not.toHaveProperty('maxParallelTools');
  });

  it('maps in-flight and turn peak when wired', () => {
    const status = buildSessionStatus({
      ...baseFacets,
      parallelTools: { parallelToolsInFlight: 2, maxParallelTools: 3 },
    });
    expect(status.parallelToolsInFlight).toBe(2);
    expect(status.maxParallelTools).toBe(3);
  });
});

describe('buildSessionStatus oauth', () => {
  it('omits oauth when the facet is undefined', () => {
    expect(buildSessionStatus(baseFacets)).not.toHaveProperty('oauth');
  });

  it('maps oauth pool snapshot when wired', () => {
    const status = buildSessionStatus({
      ...baseFacets,
      oauth: { poolSize: 3, nextRefreshAtMs: 1_700_000_180_000 },
    });
    expect(status.oauth).toEqual({ poolSize: 3, nextRefreshAtMs: 1_700_000_180_000 });
  });
});
