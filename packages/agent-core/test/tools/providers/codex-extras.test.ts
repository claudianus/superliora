import { describe, expect, it } from 'vitest';

import {
  CODEX_DEFAULT_BASE_URL,
  CODEX_DEFAULT_EXTRAS_MODEL,
  CodexWebSearchProvider,
  generateCodexImage,
} from '../../../src/tools/providers/codex-extras';
import { isRateLimitError } from '../../../src/tools/providers/research-search-adapters';

function fakeJwt(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${payload}.sig`;
}

function sse(events: Array<{ event: string; data: unknown }>): string {
  return events
    .map(({ event, data }) => `event: ${event}\ndata: ${JSON.stringify(data)}\n`)
    .join('\n');
}

function completedResponse(output: unknown[]): string {
  return sse([
    { event: 'response.created', data: { response: { id: 'r1' } } },
    { event: 'response.completed', data: { response: { id: 'r1', output } } },
  ]);
}

const tokenProvider = { getAccessToken: async () => 'codex-token' };

describe('CodexWebSearchProvider', () => {
  it('maps url citations to search results', async () => {
    let seenBody = '';
    let seenHeaders: HeadersInit | undefined;
    let seenUrl = '';
    const fetchImpl = (async (url: unknown, init?: RequestInit) => {
      seenUrl = String(url);
      seenBody = String(init?.body);
      seenHeaders = init?.headers;
      return new Response(
        completedResponse([
          { type: 'web_search_call', action: { type: 'search', query: 'q' } },
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: 'Here are findings about the topic with citations.',
                annotations: [
                  {
                    type: 'url_citation',
                    url: 'https://example.dev/a',
                    title: 'Example A',
                    start_index: 0,
                    end_index: 20,
                  },
                  { type: 'url_citation', url: 'https://example.dev/b' },
                ],
              },
            ],
          },
        ]),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );
    }) as unknown as typeof fetch;

    const provider = new CodexWebSearchProvider({ tokenProvider, fetchImpl });
    const results = await provider.search('topic', { limit: 5 });

    expect(seenUrl).toBe(`${CODEX_DEFAULT_BASE_URL}/responses`);
    expect(seenHeaders).toMatchObject({
      Authorization: 'Bearer codex-token',
      'OpenAI-Beta': 'responses=experimental',
    });
    const body = JSON.parse(seenBody) as {
      model: string;
      tools: unknown[];
      stream: boolean;
      store: boolean;
    };
    expect(body.model).toBe(CODEX_DEFAULT_EXTRAS_MODEL);
    expect(body.tools).toEqual([{ type: 'web_search' }]);
    expect(body.stream).toBe(true);
    expect(body.store).toBe(false);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      title: 'Example A',
      url: 'https://example.dev/a',
    });
    expect(results[0]!.snippet.length).toBeGreaterThan(0);
    expect(results[1]!.title).toBe('example.dev');
  });

  it('sends the chatgpt-account-id header when the JWT carries the claim', async () => {
    const jwt = fakeJwt({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct-9' } });
    let seenHeaders: HeadersInit | undefined;
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      seenHeaders = init?.headers;
      return new Response(completedResponse([]), { status: 200 });
    }) as unknown as typeof fetch;

    const provider = new CodexWebSearchProvider({
      tokenProvider: { getAccessToken: async () => jwt },
      fetchImpl,
    });
    await provider.search('x');

    expect(seenHeaders).toMatchObject({ 'chatgpt-account-id': 'acct-9' });
  });

  it('dedupes repeated citation urls', async () => {
    const fetchImpl = (async () =>
      new Response(
        completedResponse([
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: 'dupes',
                annotations: [
                  { type: 'url_citation', url: 'https://dup.dev', title: 'One' },
                  { type: 'url_citation', url: 'https://dup.dev', title: 'Two' },
                ],
              },
            ],
          },
        ]),
        { status: 200 },
      )) as unknown as typeof fetch;

    const provider = new CodexWebSearchProvider({ tokenProvider, fetchImpl });
    const results = await provider.search('dupes');
    expect(results).toHaveLength(1);
  });

  it('throws a rate-limit error on HTTP 429', async () => {
    const fetchImpl = (async () =>
      new Response('throttled', { status: 429 })) as unknown as typeof fetch;
    const provider = new CodexWebSearchProvider({ tokenProvider, fetchImpl });

    await expect(provider.search('q')).rejects.toSatisfy(isRateLimitError);
  });

  it('throws when the stream fails without a completed response', async () => {
    const fetchImpl = (async () =>
      new Response(sse([{ event: 'response.failed', data: { response: {} } }]), {
        status: 200,
      })) as unknown as typeof fetch;
    const provider = new CodexWebSearchProvider({ tokenProvider, fetchImpl });

    await expect(provider.search('q')).rejects.toThrow(/failed|completed/);
  });
});

describe('generateCodexImage', () => {
  it('extracts the image_generation_call result as bytes', async () => {
    const pngB64 = Buffer.from('png-bytes').toString('base64');
    const fetchImpl = (async () =>
      new Response(
        completedResponse([{ type: 'image_generation_call', result: pngB64 }]),
        { status: 200 },
      )) as unknown as typeof fetch;

    const image = await generateCodexImage(
      { tokenProvider, fetchImpl },
      { prompt: 'a lighthouse', size: '1024x1024' },
    );

    expect(image.bytes.toString()).toBe('png-bytes');
    expect(image.mimeType).toBe('image/png');
    expect(image.model).toBe(CODEX_DEFAULT_EXTRAS_MODEL);
  });

  it('throws when no image payload is returned', async () => {
    const fetchImpl = (async () =>
      new Response(completedResponse([{ type: 'message', content: [] }]), {
        status: 200,
      })) as unknown as typeof fetch;

    await expect(
      generateCodexImage({ tokenProvider, fetchImpl }, { prompt: 'x' }),
    ).rejects.toThrow(/no image payload/);
  });
});
