import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchProviderUsage } from '../src/provider-usage/index';
import { fetchQwenTokenPlanUsage } from '../src/provider-usage/provider-usage-fetch-qwen';

afterEach(() => {
  vi.unstubAllGlobals();
});

function modelsResponse(headers: Record<string, string>): Response {
  return new Response(JSON.stringify({ data: [] }), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('fetchQwenTokenPlanUsage', () => {
  it('maps rate-limit headers into usage rows', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        modelsResponse({
          'x-ratelimit-limit-requests': '60',
          'x-ratelimit-remaining-requests': '40',
          'x-ratelimit-reset-requests': '30s',
          'x-dashscope-ratelimit-tokens-limit': '100000',
          'x-dashscope-ratelimit-tokens-remaining': '75000',
        }),
      ),
    );

    const snapshot = await fetchQwenTokenPlanUsage('qwen-token-plan', 'sk-sp-test');

    expect(snapshot.providerKey).toBe('qwen-token-plan');
    expect(snapshot.displayName).toBe('Alibaba Token Plan');
    expect(snapshot.available).toBe(true);
    expect(snapshot.error).toBeUndefined();
    expect(snapshot.summary).toMatchObject({
      label: 'Requests',
      used: 20,
      limit: 60,
    });
    expect(snapshot.limits.map((row) => row.label)).toEqual(['Token Plan tokens']);
    expect(snapshot.limits[0]).toMatchObject({ used: 25_000, limit: 100_000 });
  });

  it('requests GET /models with bearer auth on the Token Plan base', async () => {
    const spy = vi.fn(async () => modelsResponse({}));
    vi.stubGlobal('fetch', spy);

    await fetchQwenTokenPlanUsage('alibaba-token-plan', 'sk-sp-test');

    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/models',
    );
    expect(init.headers).toMatchObject({ Authorization: 'Bearer sk-sp-test' });
  });

  it('uses a regional chat base URL when provided', async () => {
    const spy = vi.fn(async () => modelsResponse({}));
    vi.stubGlobal('fetch', spy);

    await fetchQwenTokenPlanUsage(
      'alibaba-token-plan-cn',
      'sk-sp-test',
      'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/',
    );

    const [url] = spy.mock.calls[0] as unknown as [string];
    expect(url).toBe(
      'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/models',
    );
  });

  it('reports a friendly error on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })));

    const snapshot = await fetchQwenTokenPlanUsage('qwen-token-plan', 'bad-key');
    expect(snapshot.summary).toBeNull();
    expect(snapshot.error).toMatch(/invalid api key/i);
  });

  it('routes alibaba-token-plan ids through fetchProviderUsage', async () => {
    const spy = vi.fn(async () =>
      modelsResponse({
        'x-ratelimit-limit-requests': '10',
        'x-ratelimit-remaining-requests': '9',
      }),
    );
    vi.stubGlobal('fetch', spy);

    const snapshot = await fetchProviderUsage('alibaba-token-plan', 'sk-sp-test');
    expect(snapshot.displayName).toBe('Alibaba Token Plan');
    expect(snapshot.summary?.label).toBe('Requests');
  });
});
