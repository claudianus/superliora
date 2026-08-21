import { afterEach, describe, expect, it } from 'vitest';

import {
  clearProviderUsageCache,
  usageCacheKey,
  withProviderUsageCache,
} from '../src/provider-usage/provider-usage-cache';
import type { ProviderUsageSnapshot } from '../src/provider-usage/provider-usage-types';

afterEach(() => {
  clearProviderUsageCache();
});

function snap(label: string): ProviderUsageSnapshot {
  return {
    providerKey: 'openrouter',
    displayName: 'OpenRouter',
    available: true,
    summary: { label, used: 1, limit: 10 },
    limits: [],
    fetchedAtMs: Date.now(),
  };
}

describe('withProviderUsageCache', () => {
  it('returns the cached snapshot inside the TTL', async () => {
    const key = usageCacheKey('openrouter', 'tok');
    let calls = 0;
    const fetch = async () => {
      calls += 1;
      return snap(`call-${String(calls)}`);
    };
    const first = await withProviderUsageCache(key, 90_000, false, fetch, 1_000);
    const second = await withProviderUsageCache(key, 90_000, false, fetch, 2_000);
    expect(first.summary?.label).toBe('call-1');
    expect(second.summary?.label).toBe('call-1');
    expect(calls).toBe(1);
  });

  it('dedupes in-flight fetches', async () => {
    const key = usageCacheKey('openrouter', 'tok');
    let started = 0;
    let release!: (value: ProviderUsageSnapshot) => void;
    const pending = new Promise<ProviderUsageSnapshot>((resolve) => {
      release = resolve;
    });
    const fetch = async () => {
      started += 1;
      return pending;
    };
    const a = withProviderUsageCache(key, 90_000, false, fetch, 1_000);
    const b = withProviderUsageCache(key, 90_000, false, fetch, 1_000);
    release(snap('shared'));
    const [left, right] = await Promise.all([a, b]);
    expect(started).toBe(1);
    expect(left.summary?.label).toBe('shared');
    expect(right.summary?.label).toBe('shared');
  });

  it('serves stale data while a refresh is in flight', async () => {
    const key = usageCacheKey('openrouter', 'tok');
    await withProviderUsageCache(key, 1_000, false, async () => snap('stale'), 1_000);
    let release!: (value: ProviderUsageSnapshot) => void;
    const pending = new Promise<ProviderUsageSnapshot>((resolve) => {
      release = resolve;
    });
    const stale = await withProviderUsageCache(key, 1_000, false, async () => pending, 5_000);
    expect(stale.summary?.label).toBe('stale');
    release(snap('fresh'));
    const fresh = await withProviderUsageCache(key, 1_000, true, async () => snap('forced'), 6_000);
    expect(fresh.summary?.label).toBe('forced');
  });
});
