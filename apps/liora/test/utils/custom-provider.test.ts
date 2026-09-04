import { describe, expect, it, vi } from 'vitest';

import {
  applyCustomEndpointProvider,
  inferCustomEndpointFromUrl,
  parseCustomHeaders,
  verifyCustomEndpointConnection,
} from '#/utils/custom-provider';
import type { LioraConfig } from '@superliora/sdk';

function emptyConfig(): LioraConfig {
  return {
    providers: {},
    models: {},
  } as LioraConfig;
}

describe('inferCustomEndpointFromUrl', () => {
  it('infers openai_responses from /v1/responses and strips the route', () => {
    expect(inferCustomEndpointFromUrl('http://127.0.0.1:10100/v1/responses')).toEqual({
      baseUrl: 'http://127.0.0.1:10100/v1',
      providerType: 'openai_responses',
    });
  });

  it('infers openai from /v1/chat/completions', () => {
    expect(
      inferCustomEndpointFromUrl('https://api.example.test/v1/chat/completions/'),
    ).toEqual({
      baseUrl: 'https://api.example.test/v1',
      providerType: 'openai',
    });
  });

  it('infers anthropic from /v1/messages and strips /v1 for the SDK base', () => {
    expect(inferCustomEndpointFromUrl('http://127.0.0.1:10100/v1/messages')).toEqual({
      baseUrl: 'http://127.0.0.1:10100',
      providerType: 'anthropic',
    });
  });

  it('leaves plain /v1 bases unchanged without a type', () => {
    expect(inferCustomEndpointFromUrl('http://127.0.0.1:10100/v1/')).toEqual({
      baseUrl: 'http://127.0.0.1:10100/v1',
    });
  });

  it('infers openai_responses for a Codex backend host', () => {
    expect(inferCustomEndpointFromUrl('https://chatgpt.com/backend-api/codex')).toEqual({
      baseUrl: 'https://chatgpt.com/backend-api/codex',
      providerType: 'openai_responses',
    });
  });
});

describe('applyCustomEndpointProvider', () => {
  it('uses inferred wire type when providerType is omitted', () => {
    const config = emptyConfig();
    applyCustomEndpointProvider(config, {
      providerId: 'ocx',
      baseUrl: 'http://127.0.0.1:10100/v1/responses',
      modelId: 'cursor/grok-4.5',
      setDefault: true,
    });
    expect(config.providers['ocx']?.type).toBe('openai_responses');
    expect(config.providers['ocx']?.baseUrl).toBe('http://127.0.0.1:10100/v1');
    expect(config.defaultModel).toBe('ocx/cursor/grok-4.5');
  });

  it('keeps an explicit providerType over URL inference', () => {
    const config = emptyConfig();
    applyCustomEndpointProvider(config, {
      providerId: 'ocx',
      baseUrl: 'http://127.0.0.1:10100/v1/responses',
      modelId: 'cursor/grok-4.5',
      providerType: 'openai',
    });
    expect(config.providers['ocx']?.type).toBe('openai');
    expect(config.providers['ocx']?.baseUrl).toBe('http://127.0.0.1:10100/v1');
  });

  it('caps a Grok custom-endpoint window at the xAI 200k price band', () => {
    const config = emptyConfig();
    applyCustomEndpointProvider(config, {
      providerId: 'xai-grok',
      baseUrl: 'https://api.x.ai/v1',
      modelId: 'grok-4.6',
      maxContextSize: 500_000,
    });
    expect(config.models?.['xai-grok/grok-4.6']?.maxContextSize).toBe(200_000);
  });

  it('writes probed supportEfforts onto the model alias', () => {
    const config = emptyConfig();
    applyCustomEndpointProvider(config, {
      providerId: 'zen',
      baseUrl: 'https://opencode.ai/zen/v1',
      modelId: 'x-preview-f-free',
      thinking: true,
      supportEfforts: ['low', 'high', 'max'],
    });
    expect(config.models?.['zen/x-preview-f-free']?.supportEfforts).toEqual(['low', 'high', 'max']);
  });

  it('preserves hand-maintained customHeaders and apiKeys when re-adding', () => {
    const config = emptyConfig();
    config.providers['t'] = {
      type: 'openai',
      baseUrl: 'https://x.test/v1',
      apiKey: 'old-key',
      apiKeys: ['old-key', 'spare-key'],
      customHeaders: { 'x-tenant': 'acme' },
    } as LioraConfig['providers'][string];
    applyCustomEndpointProvider(config, {
      providerId: 't',
      baseUrl: 'https://x.test/v1',
      modelId: 'm2',
      apiKey: 'new-key',
    });
    expect(config.providers['t']).toMatchObject({
      apiKey: 'new-key',
      apiKeys: ['old-key', 'spare-key'],
      customHeaders: { 'x-tenant': 'acme' },
    });
    expect(config.models?.['t/m2']).toBeDefined();
  });

  it('starts fresh pools for a brand-new provider id', () => {
    const config = emptyConfig();
    applyCustomEndpointProvider(config, {
      providerId: 'n',
      baseUrl: 'https://n.test/v1',
      modelId: 'm',
    });
    expect(config.providers['n']).toMatchObject({ apiKey: 'no-key-required', apiKeys: [] });
  });
});

describe('parseCustomHeaders', () => {
  it('parses Name: value pairs split on the first colon', () => {
    expect(parseCustomHeaders('X-Tenant: acme\nX-Tag: a=b:c')).toEqual({
      'X-Tenant': 'acme',
      'X-Tag': 'a=b:c',
    });
  });

  it('returns undefined for empty input', () => {
    expect(parseCustomHeaders(undefined)).toBeUndefined();
    expect(parseCustomHeaders('  \n ')).toBeUndefined();
  });

  it('throws a field-ready message on malformed lines', () => {
    expect(() => parseCustomHeaders('no-colon-here')).toThrow(/Name: value/);
    expect(() => parseCustomHeaders('Name:')).toThrow(/Name: value/);
  });
});

describe('verifyCustomEndpointConnection', () => {
  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status });
  }
  it('reports listed + hint when /models contains the model', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ data: [{ id: 'o1-mini', reasoning: true }] }),
    );
    const result = await verifyCustomEndpointConnection(
      'https://x.test/v1',
      'k',
      'o1-mini',
      fetchMock as unknown as typeof fetch,
    );
    expect(result).toMatchObject({ ok: true, modelListed: true });
    expect(fetchMock).toHaveBeenCalledOnce();
    const init = (fetchMock.mock.calls as unknown[][])[0]?.[1] as {
      headers: Record<string, string>;
    };
    expect(init.headers['Authorization']).toBe('Bearer k');
  });

  it('reports listed=false without a hint when the model is absent', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [{ id: 'other' }] }));
    const result = await verifyCustomEndpointConnection(
      'https://x.test/v1',
      'k',
      'missing-model',
      fetchMock as unknown as typeof fetch,
    );
    expect(result).toEqual({
      ok: true,
      modelListed: false,
      availableModels: [{ id: 'other', thinking: false }],
    });
  });

  it('blocks on 401 with a key-specific message', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 401));
    expect(
      await verifyCustomEndpointConnection(
        'https://x.test/v1',
        'bad',
        'm',
        fetchMock as unknown as typeof fetch,
      ),
    ).toMatchObject({ ok: false, reason: 'unauthorized', status: 401 });
    expect(
      await verifyCustomEndpointConnection(
        'https://x.test/v1',
        undefined,
        'm',
        fetchMock as unknown as typeof fetch,
      ),
    ).toMatchObject({ ok: false, reason: 'unauthorized' });
  });

  it('treats 404 as reachable-but-unverifiable (non-OpenAI wires)', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 404));
    expect(
      await verifyCustomEndpointConnection(
        'https://x.test',
        'k',
        'm',
        fetchMock as unknown as typeof fetch,
      ),
    ).toEqual({ ok: true, modelListed: false });
  });

  it('reports unreachable on transport failure', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    expect(
      await verifyCustomEndpointConnection(
        'https://down.test/v1',
        'k',
        'm',
        fetchMock as unknown as typeof fetch,
      ),
    ).toMatchObject({ ok: false, reason: 'unreachable' });
  });

  it('resolves {env:NAME} key references for the probe', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [{ id: 'm' }] }));
    process.env['CUSTOM_PROVIDER_TEST_KEY'] = 'env-secret';
    try {
      const result = await verifyCustomEndpointConnection(
        'https://x.test/v1',
        '{env:CUSTOM_PROVIDER_TEST_KEY}',
        'm',
        fetchMock as unknown as typeof fetch,
      );
      expect(result).toMatchObject({ ok: true, modelListed: true });
      const init = (fetchMock.mock.calls as unknown[][])[0]?.[1] as {
        headers: Record<string, string>;
      };
      expect(init.headers['Authorization']).toBe('Bearer env-secret');
    } finally {
      delete process.env['CUSTOM_PROVIDER_TEST_KEY'];
    }
  });

  it('reports env-missing when the referenced variable is unset', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [] }));
    delete process.env['CUSTOM_PROVIDER_TEST_KEY_ABSENT'];
    const result = await verifyCustomEndpointConnection(
      'https://x.test/v1',
      '{env:CUSTOM_PROVIDER_TEST_KEY_ABSENT}',
      'm',
      fetchMock as unknown as typeof fetch,
    );
    expect(result).toMatchObject({ ok: false, reason: 'env-missing' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lists advertised models when the typed id is absent', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ data: [{ id: 'a' }, { id: 'b' }, { id: 'c', reasoning: true }] }),
    );
    const result = await verifyCustomEndpointConnection(
      'https://x.test/v1',
      'k',
      'typo-model',
      fetchMock as unknown as typeof fetch,
    );
    expect(result).toEqual({
      ok: true,
      modelListed: false,
      availableModels: [
        { id: 'a', thinking: false },
        { id: 'b', thinking: false },
        { id: 'c', thinking: true },
      ],
    });
  });

  it('forwards custom headers to the verification probe', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [{ id: 'm' }] }));
    await verifyCustomEndpointConnection('https://x.test/v1', 'k', 'm', fetchMock as unknown as typeof fetch, {
      headers: { 'X-Tenant': 'acme' },
    });
    const init = (fetchMock.mock.calls as unknown[][])[0]?.[1] as {
      headers: Record<string, string>;
    };
    expect(init.headers['X-Tenant']).toBe('acme');
    expect(init.headers['Authorization']).toBe('Bearer k');
  });
});
