import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchAnthropicUsage, parseAnthropicOAuthUsage } from '../src/provider-usage/provider-usage-fetch-anthropic';
import { clearProviderUsageCache } from '../src/provider-usage/provider-usage-cache';

afterEach(() => {
  vi.unstubAllGlobals();
  clearProviderUsageCache();
});

const FIXTURE = {
  five_hour: { utilization: 58, resets_at: '2099-01-01T03:00:00Z' },
  seven_day: { utilization: 12, resets_at: '2099-01-07T00:00:00Z' },
  seven_day_opus: null,
  seven_day_sonnet: { utilization: 5 },
  extra_usage: null,
};

describe('parseAnthropicOAuthUsage', () => {
  it('maps utilization buckets and omits null windows', () => {
    const rows = parseAnthropicOAuthUsage(FIXTURE);
    expect(rows.map((row) => row.label)).toEqual(['5-hour limit', 'Weekly limit', 'Weekly Sonnet']);
    expect(rows[0]).toMatchObject({ used: 58, limit: 100 });
    expect(rows[0]!.resetHint).toBeDefined();
    expect(rows.some((row) => row.label.includes('Opus'))).toBe(false);
  });

  it('does not invent remaining when utilization is missing', () => {
    expect(parseAnthropicOAuthUsage({ five_hour: { resets_at: '2099-01-01T00:00:00Z' } })).toEqual([]);
  });
});

describe('fetchAnthropicUsage', () => {
  it('calls the oauth usage endpoint with the required UA', async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify(FIXTURE), { status: 200 }));
    vi.stubGlobal('fetch', spy);

    const snapshot = await fetchAnthropicUsage('anthropic-oauth', 'oauth-token');

    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/api/oauth/usage');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer oauth-token',
      'anthropic-beta': 'oauth-2025-04-20',
      'User-Agent': 'claude-code/',
    });
    expect(snapshot.available).toBe(true);
    expect(snapshot.status).toBe('ok');
    expect(snapshot.remainingDisplay).toContain('Claude');
    expect(snapshot.remainingDisplay).toContain('42%');
    expect(snapshot.source).toBe('oauth-api');
  });

  it('marks API-key 401 as auth-required without a fake bar', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })));
    const snapshot = await fetchAnthropicUsage('anthropic-oauth', 'sk-ant-api');
    expect(snapshot.status).toBe('auth-required');
    expect(snapshot.available).toBe(false);
    expect(snapshot.remainingDisplay).toBe('');
  });

  it('marks 429 as rate-limited', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('slow down', { status: 429 })));
    const snapshot = await fetchAnthropicUsage('anthropic-oauth', 'oauth-token');
    expect(snapshot.status).toBe('rate-limited');
    expect(snapshot.remainingDisplay).toBe('');
  });
});
