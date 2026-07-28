/**
 * Covers: ResearchSearchEngine multi-provider routing + adapters.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  detectSearchProviderEnvKeys,
  ResearchSearchEngine,
  resolveResearchApiKey,
} from '../../../src/tools/providers/research-search';


function requestUrl(input: string | URL | { readonly url: string }): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

describe('detectSearchProviderEnvKeys', () => {
  it('detects known search API env vars', () => {
    const detected = detectSearchProviderEnvKeys({
      BRAVE_API_KEY: 'brave-key',
      TAVILY_API_KEY: 'tvly-key',
      EXA_API_KEY: 'exa-key',
      SERPER_API_KEY: 'serper-key',
      UNRELATED: 'x',
    } as NodeJS.ProcessEnv);

    expect(detected.map((d) => d.kind).sort()).toEqual(['brave', 'exa', 'serper', 'tavily']);
  });
});

describe('resolveResearchApiKey', () => {
  it('resolves {env:NAME} refs and raw keys', () => {
    expect(
      resolveResearchApiKey({
        apiKey: '{env:BRAVE_API_KEY}',
        env: { BRAVE_API_KEY: 'from-env' } as NodeJS.ProcessEnv,
      }),
    ).toBe('from-env');
    expect(resolveResearchApiKey({ apiKey: 'literal' })).toBe('literal');
    expect(
      resolveResearchApiKey({
        apiKeyEnv: 'TAVILY_API_KEY',
        env: { TAVILY_API_KEY: 'tvly' } as NodeJS.ProcessEnv,
      }),
    ).toBe('tvly');
  });
});

describe('ResearchSearchEngine', () => {
  it('falls back to free local search when no paid keys are configured', async () => {
    const html = [
      '<html><body>',
      '<div class="result">',
      '<a class="result__a" href="https://example.com/docs">Example Docs</a>',
      '<a class="result__snippet">Official docs snippet</a>',
      '</div>',
      '</body></html>',
    ].join('');
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(html, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    );

    const engine = new ResearchSearchEngine({
      fetchImpl,
      search: { strategy: 'auto', freeFallback: true },
      local: {
        searchUrl: 'https://duckduckgo.com/html/',
        directSources: { github: false, arxiv: false, npm: false, pypi: false, crates: false },
      },
    });

    const results = await engine.search('example docs', { limit: 2 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.url).toContain('example.com');
    expect(engine.status().providers.some((p) => p.kind === 'duckduckgo')).toBe(true);
  });

  it('calls Brave when a key is configured and cools down on 429', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ web: { results: [] } }), {
          status: 429,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValue(
        new Response(
          [
            '<html><body>',
            '<div class="result">',
            '<a class="result__a" href="https://example.com/fallback">Fallback</a>',
            '<a class="result__snippet">Free fallback</a>',
            '</div>',
            '</body></html>',
          ].join(''),
          { status: 200, headers: { 'content-type': 'text/html' } },
        ),
      );

    const engine = new ResearchSearchEngine({
      fetchImpl,
      search: {
        strategy: 'fallback',
        freeFallback: true,
        cooldownMs: 60_000,
        providers: [{ kind: 'brave', apiKey: 'brave-test-key' }],
      },
      local: {
        searchUrl: 'https://duckduckgo.com/html/',
        directSources: { github: false, arxiv: false, npm: false, pypi: false, crates: false },
      },
    });

    const results = await engine.search('query', { limit: 1 });
    expect(results[0]?.url).toContain('example.com/fallback');
    const brave = engine.status().providers.find((p) => p.kind === 'brave');
    expect(brave?.ready).toBe(false);
    expect(brave?.cooldownUntil).toBeTypeOf('number');
  });

  it('parses Tavily JSON results', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              title: 'Tavily Hit',
              url: 'https://example.com/tavily',
              content: 'A useful snippet',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const engine = new ResearchSearchEngine({
      fetchImpl,
      search: {
        strategy: 'fallback',
        freeFallback: false,
        providers: [{ kind: 'tavily', apiKey: 'tvly-test' }],
      },
    });

    const results = await engine.search('messi', { limit: 3 });
    expect(results).toEqual([
      expect.objectContaining({
        title: 'Tavily Hit',
        url: 'https://example.com/tavily',
      }),
    ]);
    expect(results[0]?.snippet).toBe('A useful snippet');
  });

  it('fans out in parallel and dedupes URLs', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = requestUrl(input);
      if (url.includes('api.search.brave.com')) {
        return new Response(
          JSON.stringify({
            web: {
              results: [
                { title: 'Brave A', url: 'https://example.com/shared', description: 'from brave' },
                { title: 'Brave B', url: 'https://example.com/brave-only', description: 'brave only' },
              ],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('api.tavily.com')) {
        return new Response(
          JSON.stringify({
            results: [
              { title: 'Tavily A', url: 'https://example.com/shared', content: 'from tavily' },
              { title: 'Tavily C', url: 'https://example.com/tavily-only', content: 'tavily only' },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 404 });
    });

    const engine = new ResearchSearchEngine({
      fetchImpl,
      search: {
        strategy: 'parallel',
        freeFallback: false,
        providers: [
          { kind: 'brave', apiKey: 'b' },
          { kind: 'tavily', apiKey: 't' },
        ],
      },
    });

    const results = await engine.search('shared topic', { limit: 10 });
    const urls = results.map((r) => r.url);
    expect(urls).toContain('https://example.com/shared');
    expect(urls).toContain('https://example.com/brave-only');
    expect(urls).toContain('https://example.com/tavily-only');
    expect(urls.filter((u) => u === 'https://example.com/shared')).toHaveLength(1);
  });

  it('auto calls two paid providers and fuses them even when the first returns three hits', async () => {
    let braveCalls = 0;
    let tavilyCalls = 0;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = requestUrl(input);
      if (url.includes('api.search.brave.com')) {
        braveCalls += 1;
        return new Response(
          JSON.stringify({
            web: {
              results: [
                {
                  title: 'Adaptive fusion shared',
                  url: 'https://example.com/shared?utm_source=brave',
                  description: 'adaptive fusion',
                },
                { title: 'Brave 2', url: 'https://brave.example/b', description: 'adaptive result' },
                { title: 'Brave 3', url: 'https://docs.example/c', description: 'fusion result' },
              ],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('api.tavily.com')) {
        tavilyCalls += 1;
        return new Response(
          JSON.stringify({
            results: [
              {
                title: 'Shared from Tavily',
                url: 'https://example.com/shared#section',
                content: 'adaptive fusion consensus',
              },
              {
                title: 'Tavily only',
                url: 'https://tavily.example/t',
                content: 'adaptive fusion',
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 404 });
    });

    const engine = new ResearchSearchEngine({
      fetchImpl,
      search: {
        strategy: 'auto',
        freeFallback: false,
        providers: [
          { kind: 'brave', apiKey: 'b' },
          { kind: 'tavily', apiKey: 't' },
        ],
      },
    });

    const results = await engine.search('adaptive fusion', { limit: 3 });
    expect(braveCalls).toBe(1);
    expect(tavilyCalls).toBe(1);
    expect(results[0]?.url).toBe('https://example.com/shared');
    expect(results.map((result) => result.url)).toContain('https://tavily.example/t');
    expect(results.every((result) => !result.snippet.startsWith('['))).toBe(true);
  });

  it('auto preserves partial results when one provider rejects', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = requestUrl(input);
      if (url.includes('api.search.brave.com')) {
        return new Response('{}', { status: 500 });
      }
      if (url.includes('api.tavily.com')) {
        return new Response(
          JSON.stringify({
            results: [
              {
                title: 'Adaptive one',
                url: 'https://one.example/a',
                content: 'adaptive fusion',
              },
              {
                title: 'Fusion two',
                url: 'https://two.example/b',
                content: 'adaptive fusion',
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 404 });
    });

    const engine = new ResearchSearchEngine({
      fetchImpl,
      search: {
        strategy: 'auto',
        freeFallback: false,
        providers: [
          { kind: 'brave', apiKey: 'b' },
          { kind: 'tavily', apiKey: 't' },
        ],
      },
    });

    const results = await engine.search('adaptive fusion', { limit: 3 });
    expect(results.map((result) => result.url)).toEqual([
      'https://one.example/a',
      'https://two.example/b',
    ]);
  });

  it('auto escalates to free fallback when fused paid results are thin', async () => {
    let freeCalls = 0;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = requestUrl(input);
      if (url.includes('api.search.brave.com')) {
        return new Response(
          JSON.stringify({
            web: {
              results: [
                {
                  title: 'Adaptive paid one',
                  url: 'https://paid.example/a',
                  description: 'adaptive fusion',
                },
              ],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('api.tavily.com')) {
        return new Response(
          JSON.stringify({
            results: [
              {
                title: 'Fusion paid two',
                url: 'https://paid.example/b',
                content: 'adaptive fusion',
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('duckduckgo.com/html')) {
        freeCalls += 1;
        return new Response(
          [
            '<html><body>',
            '<div class="result">',
            '<a class="result__a" href="https://free.example/c">Adaptive free result</a>',
            '<a class="result__snippet">adaptive fusion fallback</a>',
            '</div>',
            '</body></html>',
          ].join(''),
          { status: 200, headers: { 'content-type': 'text/html' } },
        );
      }
      return new Response('{}', { status: 404 });
    });

    const engine = new ResearchSearchEngine({
      fetchImpl,
      search: {
        strategy: 'auto',
        freeFallback: true,
        providers: [
          { kind: 'brave', apiKey: 'b' },
          { kind: 'tavily', apiKey: 't' },
        ],
      },
      local: {
        searchUrl: 'https://duckduckgo.com/html/',
        directSources: { github: false, arxiv: false, npm: false, pypi: false, crates: false },
      },
    });

    const results = await engine.search('adaptive fusion', { limit: 3 });
    expect(freeCalls).toBe(1);
    expect(results.map((result) => result.url)).toContain('https://free.example/c');
  });

  it('preserves explicit round-robin routing', async () => {
    let braveCalls = 0;
    let tavilyCalls = 0;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = requestUrl(input);
      if (url.includes('api.search.brave.com')) {
        braveCalls += 1;
        return new Response(
          JSON.stringify({
            web: {
              results: [
                { title: 'Brave explicit', url: 'https://brave.example/explicit', description: 'query' },
              ],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('api.tavily.com')) {
        tavilyCalls += 1;
        return new Response(
          JSON.stringify({
            results: [
              { title: 'Tavily explicit', url: 'https://tavily.example/explicit', content: 'query' },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 404 });
    });

    const engine = new ResearchSearchEngine({
      fetchImpl,
      search: {
        strategy: 'round_robin',
        freeFallback: false,
        providers: [
          { kind: 'brave', apiKey: 'b' },
          { kind: 'tavily', apiKey: 't' },
        ],
      },
    });

    const first = await engine.search('query', { limit: 1 });
    const second = await engine.search('query', { limit: 1 });
    expect(first[0]?.url).toBe('https://brave.example/explicit');
    expect(second[0]?.url).toBe('https://tavily.example/explicit');
    expect({ braveCalls, tavilyCalls }).toEqual({ braveCalls: 1, tavilyCalls: 1 });
  });

  it('does not request provider-native full content during metadata search', async () => {
    let body: unknown;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = requestUrl(input);
      if (url.includes('api.tavily.com')) {
        const rawBody = init?.body;
        body = JSON.parse(typeof rawBody === 'string' ? rawBody : '{}');
        return new Response(
          JSON.stringify({
            results: [{ title: 'T', url: 'https://example.com/t', content: 'snippet only' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 404 });
    });

    const engine = new ResearchSearchEngine({
      fetchImpl,
      search: {
        strategy: 'fallback',
        freeFallback: false,
        providers: [{ kind: 'tavily', apiKey: 't' }],
      },
    });

    await engine.search('query', { limit: 2, includeContent: true });
    expect(body).toMatchObject({ search_depth: 'basic', include_raw_content: false });
  });

});
