import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchAnthropicUsage, parseAnthropicOAuthUsage } from '../src/provider-usage/provider-usage-fetch-anthropic';
import { clearProviderUsageCache } from '../src/provider-usage/provider-usage-cache';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
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
  it('defaults to count_tokens + headers when oauth usage is disabled', async () => {
    vi.stubEnv('SUPERLIORA_EXPERIMENTAL_ANTHROPIC_OAUTH', '0');
    const spy = vi.fn(
      async () =>
        new Response('{}', {
          status: 200,
          headers: {
            'anthropic-ratelimit-requests-limit': '50',
            'anthropic-ratelimit-requests-remaining': '10',
          },
        }),
    );
    vi.stubGlobal('fetch', spy);
    const snapshot = await fetchAnthropicUsage('anthropic-oauth', 'oauth-token');
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages/count_tokens');
    expect(init.method).toBe('POST');
    expect(snapshot.summary).toMatchObject({ label: 'Requests/min', used: 40, limit: 50 });
    expect(snapshot.source).toBe('response-headers');
  });

  it('uses /api/oauth/usage rows when the anthropic_oauth flag is on', async () => {
    vi.stubEnv('SUPERLIORA_EXPERIMENTAL_ANTHROPIC_OAUTH', '1');
    const spy = vi.fn(async () => new Response(JSON.stringify(FIXTURE), { status: 200 }));
    vi.stubGlobal('fetch', spy);
    const snapshot = await fetchAnthropicUsage('anthropic-oauth', 'oauth-token');
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/api/oauth/usage');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer oauth-token',
      'User-Agent': 'claude-code/',
    });
    expect(snapshot.source).toBe('oauth-api');
    expect(snapshot.summary).toMatchObject({ used: 58, limit: 100 });
  });

  it('falls back to count_tokens when oauth usage returns 401', async () => {
    vi.stubEnv('SUPERLIORA_EXPERIMENTAL_ANTHROPIC_OAUTH', '1');
    const spy = vi.fn(async (url: string) => {
      if (String(url).includes('/api/oauth/usage')) {
        return new Response('unauthorized', { status: 401 });
      }
      return new Response('{}', {
        status: 200,
        headers: {
          'anthropic-ratelimit-requests-limit': '50',
          'anthropic-ratelimit-requests-remaining': '40',
        },
      });
    });
    vi.stubGlobal('fetch', spy);
    const snapshot = await fetchAnthropicUsage('anthropic-oauth', 'sk-ant-api');
    expect(snapshot.source).toBe('response-headers');
    expect(snapshot.summary).toMatchObject({ used: 10, limit: 50 });
    expect(snapshot.remainingDisplay ?? '').not.toMatch(/^0%|^100%/);
  });
});
