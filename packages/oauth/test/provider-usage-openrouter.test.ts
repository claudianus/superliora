import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearProviderUsageCache } from '../src/provider-usage/provider-usage-cache';
import {
  fetchOpenRouterUsage,
  parseOpenRouterKeyPayload,
} from '../src/provider-usage/provider-usage-fetch-openrouter';
import { fetchProviderUsage } from '../src/provider-usage/index';

afterEach(() => {
  vi.unstubAllGlobals();
  clearProviderUsageCache();
});

const KEY_PAYLOAD = {
  data: {
    label: 'default',
    usage: 1.23,
    usage_daily: 0.1,
    limit: 20,
    limit_remaining: 12.4,
    limit_reset: '2099-02-01T00:00:00Z',
  },
};

describe('parseOpenRouterKeyPayload', () => {
  it('maps remaining credits to a USD footer string', () => {
    const parsed = parseOpenRouterKeyPayload(KEY_PAYLOAD);
    expect(parsed.remainingDisplay).toBe('OR $12.40');
    expect(parsed.rows[0]).toMatchObject({ label: 'Credits', used: 7.6, limit: 20 });
  });

  it('omits a remaining percent when only usage is present', () => {
    const parsed = parseOpenRouterKeyPayload({ data: { usage: 3.2 } });
    expect(parsed.remainingDisplay).toBe('');
    expect(parsed.rows).toEqual([]);
  });
});

describe('fetchOpenRouterUsage', () => {
  it('reads GET /api/v1/key', async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify(KEY_PAYLOAD), { status: 200 }));
    vi.stubGlobal('fetch', spy);
    const snapshot = await fetchOpenRouterUsage('openrouter', 'sk-or-test');
    const [url] = spy.mock.calls[0] as unknown as [string];
    expect(url).toBe('https://openrouter.ai/api/v1/key');
    expect(snapshot.remainingDisplay).toBe('OR $12.40');
    expect(snapshot.kind).toBe('api-credits');
  });

  it('routes openrouter through fetchProviderUsage', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(KEY_PAYLOAD), { status: 200 })),
    );
    const snapshot = await fetchProviderUsage('openrouter', 'sk-or-test');
    expect(snapshot.providerKey).toBe('openrouter');
    expect(snapshot.remainingDisplay).toBe('OR $12.40');
  });
});
