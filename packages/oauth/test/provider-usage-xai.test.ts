import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  XAI_GROK_API_BASE_URL,
  XAI_GROK_BUILD_BASE_URL,
  XAI_GROK_BUILD_CLIENT_VERSION_DEFAULT,
} from '../src/profiles/xai';
import { fetchXaiGrokUsage } from '../src/provider-usage/provider-usage-fetch-xai';

afterEach(() => {
  vi.unstubAllGlobals();
});

function modelsResponse(headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ data: [] }), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('fetchXaiGrokUsage', () => {
  it('sends full Build surface headers on the default Build proxy', async () => {
    const spy = vi.fn(async () => modelsResponse());
    vi.stubGlobal('fetch', spy);

    await fetchXaiGrokUsage('xai-grok', 'test-token');

    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(1);
    const modelsCall = spy.mock.calls.find((call) =>
      String((call as unknown as [string])[0]).endsWith('/models'),
    );
    expect(modelsCall).toBeDefined();
    const [url, init] = modelsCall as unknown as [string, RequestInit];
    expect(url).toBe(`${XAI_GROK_BUILD_BASE_URL}/models`);
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer test-token',
      'X-XAI-Token-Auth': 'xai-grok-cli',
      'x-grok-client-version': XAI_GROK_BUILD_CLIENT_VERSION_DEFAULT,
      'x-grok-client-surface': 'grok-build',
      'x-grok-client-identifier': 'grok-shell',
    });
  });

  it('omits Build surface headers on the public API base', async () => {
    const spy = vi.fn(async () => modelsResponse());
    vi.stubGlobal('fetch', spy);

    await fetchXaiGrokUsage('xai-grok', 'test-token', XAI_GROK_API_BASE_URL);

    const modelsCall = spy.mock.calls.find((call) =>
      String((call as unknown as [string])[0]).endsWith('/models'),
    );
    expect(modelsCall).toBeDefined();
    const [url, init] = modelsCall as unknown as [string, RequestInit];
    expect(url).toBe(`${XAI_GROK_API_BASE_URL}/models`);
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer test-token');
    expect(headers['X-XAI-Token-Auth']).toBeUndefined();
    expect(headers['x-grok-client-version']).toBeUndefined();
  });
});
