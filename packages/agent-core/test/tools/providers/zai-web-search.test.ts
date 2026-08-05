import { describe, expect, it } from 'vitest';

import { isRateLimitError } from '../../../src/tools/providers/research-search-adapters';
import {
  parseZaiSearchResult,
  ZaiWebSearchProvider,
} from '../../../src/tools/providers/zai-web-search';

interface MockCall {
  readonly url: string;
  readonly init?: RequestInit;
}

function sseBody(payload: unknown): string {
  return `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
}

function searchResultPayload(hits: unknown): unknown {
  return {
    jsonrpc: '2.0',
    id: 2,
    result: { content: [{ type: 'text', text: JSON.stringify(hits) }] },
  };
}

function makeFetch(handlers: {
  initialize?: (call: MockCall) => Response;
  notify?: (call: MockCall) => Response;
  call?: (call: MockCall) => Response;
}): { fetchImpl: typeof fetch; calls: MockCall[] } {
  const calls: MockCall[] = [];
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    const call: MockCall = { url: String(url), ...(init !== undefined ? { init } : {}) };
    calls.push(call);
    const body = JSON.parse(String(init?.body)) as { method?: string };
    if (body.method === 'initialize') {
      return (
        handlers.initialize?.(call) ??
        new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json', 'mcp-session-id': 'sess-1' },
        })
      );
    }
    if (body.method === 'notifications/initialized') {
      return handlers.notify?.(call) ?? new Response(null, { status: 202 });
    }
    return handlers.call?.(call) ?? new Response('{}', { status: 500 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe('ZaiWebSearchProvider', () => {
  it('runs the MCP handshake then returns normalized hits', async () => {
    const { fetchImpl, calls } = makeFetch({
      call: () =>
        new Response(
          sseBody(
            searchResultPayload({
              results: [
                {
                  title: 'GLM Coding Plan',
                  link: 'https://z.ai/subscribe',
                  content: 'Coding plan overview',
                  publish_date: '2026-01-01',
                },
                { title: 'Docs', url: 'https://docs.z.ai/devpack', snippet: 'DevPack docs' },
              ],
            }),
          ),
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        ),
    });
    const provider = new ZaiWebSearchProvider({ apiKey: 'zai-key', fetchImpl });

    const results = await provider.search('glm coding plan', { limit: 5 });

    expect(calls).toHaveLength(3);
    expect(calls[0]!.init?.headers).toMatchObject({ Authorization: 'Bearer zai-key' });
    expect(calls[2]!.init?.headers).toMatchObject({ 'mcp-session-id': 'sess-1' });
    expect(JSON.parse(String(calls[2]!.init?.body)).params.name).toBe('web_search_prime');
    expect(JSON.parse(String(calls[2]!.init?.body)).params.arguments.search_query).toBe(
      'glm coding plan',
    );
    expect(results).toEqual([
      {
        title: 'GLM Coding Plan',
        url: 'https://z.ai/subscribe',
        snippet: 'Coding plan overview',
        date: '2026-01-01',
      },
      { title: 'Docs', url: 'https://docs.z.ai/devpack', snippet: 'DevPack docs' },
    ]);
  });

  it('reuses the initialized session across searches', async () => {
    const { fetchImpl, calls } = makeFetch({
      call: () =>
        new Response(sseBody(searchResultPayload({ results: [] })), {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
    });
    const provider = new ZaiWebSearchProvider({ apiKey: 'zai-key', fetchImpl });

    await provider.search('one');
    await provider.search('two');

    expect(calls).toHaveLength(4); // initialize + notify + 2 calls
  });

  it('re-initializes once when the session expired (404 on tools/call)', async () => {
    let callAttempts = 0;
    const { fetchImpl, calls } = makeFetch({
      call: () => {
        callAttempts += 1;
        if (callAttempts === 1) return new Response('gone', { status: 404 });
        return new Response(
          sseBody(
            searchResultPayload({
              results: [{ title: 'T', link: 'https://z.ai', content: 'c' }],
            }),
          ),
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        );
      },
    });
    const provider = new ZaiWebSearchProvider({ apiKey: 'zai-key', fetchImpl });

    const results = await provider.search('retry');

    expect(results).toHaveLength(1);
    // init, notify, call(404), init, notify, call(ok)
    expect(calls).toHaveLength(6);
  });

  it('throws a rate-limit error on HTTP 429 so the engine cools the slot down', async () => {
    const { fetchImpl } = makeFetch({
      call: () => new Response('slow down', { status: 429 }),
    });
    const provider = new ZaiWebSearchProvider({ apiKey: 'zai-key', fetchImpl });

    await expect(provider.search('quota')).rejects.toSatisfy(isRateLimitError);
  });

  it('returns empty results when the payload carries no hits', async () => {
    const { fetchImpl } = makeFetch({
      call: () =>
        new Response(sseBody(searchResultPayload({ not: 'hits' })), {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
    });
    const provider = new ZaiWebSearchProvider({ apiKey: 'zai-key', fetchImpl });

    await expect(provider.search('nothing useful')).resolves.toEqual([]);
  });

  it('returns empty for blank queries without any HTTP call', async () => {
    const { fetchImpl, calls } = makeFetch({});
    const provider = new ZaiWebSearchProvider({ apiKey: 'zai-key', fetchImpl });

    await expect(provider.search('   ')).resolves.toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe('parseZaiSearchResult', () => {
  it('parses nested result arrays and truncates long bodies', () => {
    const long = 'x'.repeat(1000);
    const result = parseZaiSearchResult({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            data: { results: [{ title: 'A', url: 'https://a.dev', content: long }] },
          }),
        },
      ],
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.url).toBe('https://a.dev');
    expect(result[0]!.snippet.length).toBeLessThan(700);
  });

  it('ignores non-text parts and unparseable JSON', () => {
    const result = parseZaiSearchResult({
      content: [
        { type: 'image', data: '…' },
        { type: 'text', text: 'plain prose, not JSON' },
      ],
    });
    expect(result).toEqual([]);
  });
});
