import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchZaiUsage } from '../src/provider-usage/provider-usage-fetch-zai';
import { fetchProviderUsage } from '../src/provider-usage/index';
import { providerDisplayName } from '../src/provider-usage/provider-usage-display';

const QUOTA_PAYLOAD = {
  code: 200,
  success: true,
  data: {
    level: 'pro',
    limits: [
      {
        type: 'TOKENS_LIMIT',
        unit: 3,
        number: 5,
        usage: 800_000_000,
        currentValue: 127_694_464,
        remaining: 672_305_536,
        percentage: 15,
        nextResetTime: 1_770_648_402_389,
      },
      {
        type: 'TOKENS_LIMIT',
        unit: 6,
        number: 7,
        usage: 4_000_000_000,
        currentValue: 1_000_000_000,
        remaining: 3_000_000_000,
        percentage: 25,
        nextResetTime: 1_771_000_000_000,
      },
      {
        type: 'TIME_LIMIT',
        unit: 5,
        number: 1,
        usage: 4000,
        currentValue: 1828,
        remaining: 2172,
        percentage: 45,
        usageDetails: [{ modelCode: 'search-prime', usage: 1433 }],
      },
    ],
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchZaiUsage', () => {
  it('maps quota windows into usage rows with the weekly window as summary', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(QUOTA_PAYLOAD), { status: 200 })),
    );

    const snapshot = await fetchZaiUsage('zai-coding-plan', 'zai-key');

    expect(snapshot.providerKey).toBe('zai-coding-plan');
    expect(snapshot.displayName).toBe('Z.AI (GLM Coding Plan)');
    expect(snapshot.available).toBe(true);
    expect(snapshot.error).toBeUndefined();
    expect(snapshot.summary).toMatchObject({
      label: 'Weekly limit',
      used: 1_000_000_000,
      limit: 4_000_000_000,
    });
    expect(snapshot.limits.map((row) => row.label)).toEqual([
      '5-hour limit',
      'Monthly tool calls (search/reader/zread)',
    ]);
    expect(snapshot.limits[0]!.resetHint).toBeDefined();
  });

  it('requests the quota endpoint with bearer auth', async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify(QUOTA_PAYLOAD), { status: 200 }));
    vi.stubGlobal('fetch', spy);

    await fetchZaiUsage('zai', 'zai-key');

    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.z.ai/api/monitor/usage/quota/limit');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer zai-key' });
  });

  it('reports a friendly error on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })));

    const snapshot = await fetchZaiUsage('zai-coding-plan', 'bad-key');

    expect(snapshot.summary).toBeNull();
    expect(snapshot.error).toMatch(/invalid api key/i);
  });

  it('reports unavailable-shaped snapshot when the plan is inactive (403)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no plan', { status: 403 })));

    const snapshot = await fetchZaiUsage('zai-coding-plan', 'zai-key');
    expect(snapshot.error).toMatch(/coding plan/i);
  });
});

describe('fetchProviderUsage routing', () => {
  it('routes zai provider keys to the Z.AI fetcher', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(QUOTA_PAYLOAD), { status: 200 })),
    );

    const snapshot = await fetchProviderUsage('zai-coding-plan', 'zai-key');
    expect(snapshot.displayName).toBe('Z.AI (GLM Coding Plan)');

    const alt = await fetchProviderUsage('zai', 'zai-key');
    expect(alt.displayName).toBe('Z.AI');
  });
});

describe('providerDisplayName', () => {
  it('knows the Z.AI entries', () => {
    expect(providerDisplayName('zai-coding-plan')).toBe('Z.AI (GLM Coding Plan)');
    expect(providerDisplayName('zai')).toBe('Z.AI');
  });
});
