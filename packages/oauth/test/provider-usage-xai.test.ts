import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearProviderUsageCache } from '../src/provider-usage/provider-usage-cache';
import {
  fetchXaiGrokUsage,
  parseXaiGrokBillingCredits,
  xaiGrokUserIdFromAccessToken,
} from '../src/provider-usage/provider-usage-fetch-xai';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  clearProviderUsageCache();
});

describe('xaiGrokUserIdFromAccessToken', () => {
  it('decodes the sub claim from an OAuth JWT', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: 'user-123', email: 'j@x.ai' })).toString(
      'base64url',
    );
    const token = `${header}.${payload}.signature`;
    expect(xaiGrokUserIdFromAccessToken(token)).toBe('user-123');
  });

  it('returns undefined for non-JWT tokens', () => {
    expect(xaiGrokUserIdFromAccessToken('not-a-jwt')).toBeUndefined();
    expect(xaiGrokUserIdFromAccessToken('a..b')).toBeUndefined();
  });
});

describe('parseXaiGrokBillingCredits', () => {
  it('parses the weekly credits envelope', () => {
    const reading = parseXaiGrokBillingCredits({
      config: {
        creditUsagePercent: 23.5,
        currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', end: Date.now() + 2 * 24 * 3600_000 },
      },
    });
    expect(reading).toMatchObject({ usedPercent: 23.5, label: 'Weekly credits' });
    expect(reading!.resetAtMs).not.toBeNull();
  });

  it('treats a missing percent on a weekly period as 0 used (proto3 default)', () => {
    const reading = parseXaiGrokBillingCredits({
      config: { currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', end: 0 } },
    });
    expect(reading).toMatchObject({ usedPercent: 0, resetAtMs: null });
  });

  it('clamps out-of-range percentages', () => {
    const reading = parseXaiGrokBillingCredits({
      config: {
        creditUsagePercent: 150,
        currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY' },
      },
    });
    expect(reading).toMatchObject({ usedPercent: 100 });
  });

  it('falls back to the legacy monthly dollar envelope', () => {
    const reading = parseXaiGrokBillingCredits({
      config: {
        monthlyLimit: { val: 30_00 },
        used: { val: 12_00 },
        billingPeriodEnd: Date.now() + 3600_000,
      },
    });
    expect(reading).toMatchObject({ usedPercent: 40, label: 'Monthly credits' });
    expect(reading!.resetAtMs).not.toBeNull();
  });

  it('rejects payloads without a readable config', () => {
    expect(parseXaiGrokBillingCredits(null)).toBeNull();
    expect(parseXaiGrokBillingCredits({})).toBeNull();
    expect(parseXaiGrokBillingCredits({ config: {} })).toBeNull();
    expect(
      parseXaiGrokBillingCredits({ config: { currentPeriod: { type: 'USAGE_PERIOD_TYPE_MONTHLY' } } }),
    ).toBeNull();
  });
});

describe('fetchXaiGrokUsage', () => {
  it('prefers the Build weekly credits window on the build route', async () => {
    const spy = vi.fn(async () =>
      new Response(
        JSON.stringify({
          config: {
            creditUsagePercent: 12,
            currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', end: Date.now() + 3 * 24 * 3600_000 },
          },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', spy);
    const snapshot = await fetchXaiGrokUsage('xai-grok', 'oauth-token');
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/v1/billing?format=credits');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer oauth-token',
      'X-XAI-Token-Auth': 'xai-grok-cli',
      'x-authenticateresponse': 'authenticate-response',
    });
    expect(snapshot.summary).toMatchObject({ label: 'Weekly credits', used: 12, limit: 100 });
    expect(snapshot.source).toBe('oauth-api');
    expect(snapshot.kind).toBe('subscription');
  });

  it('falls back to /models header rate limits when billing is unavailable', async () => {
    const spy = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 404 }))
      .mockResolvedValueOnce(
        new Response('{}', {
          status: 200,
          headers: {
            'x-ratelimit-limit-requests': '100',
            'x-ratelimit-remaining-requests': '40',
          },
        }),
      );
    vi.stubGlobal('fetch', spy);
    const snapshot = await fetchXaiGrokUsage('xai-grok', 'oauth-token');
    const calls = spy.mock.calls.map((call) => (call[0] as string));
    expect(calls[0]).toContain('/billing?format=credits');
    expect(calls[1]).toContain('/models');
    expect(snapshot.summary).toMatchObject({ label: 'Requests', used: 60, limit: 100 });
    expect(snapshot.source).toBe('response-headers');
  });

  it('keeps the header probe for the public API route', async () => {
    const spy = vi.fn(async () =>
      new Response('{}', {
        status: 200,
        headers: {
          'x-ratelimit-limit-tokens': '50000',
          'x-ratelimit-remaining-tokens': '12000',
        },
      }),
    );
    vi.stubGlobal('fetch', spy);
    const snapshot = await fetchXaiGrokUsage('xai-grok', 'token', 'https://api.x.ai/v1');
    const [url] = spy.mock.calls[0] as unknown as [string];
    expect(url).toBe('https://api.x.ai/v1/models');
    expect(snapshot.summary).toMatchObject({ label: 'Tokens/min', used: 38000, limit: 50000 });
  });
});
