/**
 * Covers: ResearchSearchEngine multi-provider routing + adapters.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  assessSearchChannelHealth,
  buildSearchNeverEmptyNextStep,
  detectSearchProviderEnvKeys,
  formatSearchNeverEmptySoftFailLines,
  ResearchSearchEngine,
  resolveResearchApiKey,
} from '../../../src/tools/providers/research-search';
import {
  parseDuckDuckGoInstantAnswerResponse,
} from '../../../src/tools/providers/research-search-adapters';
import { ALLOW_DISABLE_FREE_FALLBACK_ENV } from '../../../src/tools/providers/research-search-free-fallback';
import { inferSearchChannelsFromStatus } from '../../../src/tools/providers/research-search-health';
import {
  getSearchNeverEmptyTelemetry,
  resetSearchNeverEmptyTelemetry,
} from '../../../src/tools/providers/search-never-empty-telemetry';


function requestUrl(input: string | URL | { readonly url: string }): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function emptyDdgInstantAnswerResponse(): Response {
  return new Response(JSON.stringify({}), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('detectSearchProviderEnvKeys', () => {
  it('detects known search API env vars', () => {
    const detected = detectSearchProviderEnvKeys({
      BRAVE_API_KEY: 'brave-key',
      TAVILY_API_KEY: 'tvly-key',
      EXA_API_KEY: 'exa-key',
      SERPER_API_KEY: 'serper-key',
      BING_SEARCH_API_KEY: 'bing-key',
      GOOGLE_CSE_API_KEY: 'google-key',
      GOOGLE_CSE_ID: 'cx-id',
      UNRELATED: 'x',
    } as NodeJS.ProcessEnv);

    expect(detected.map((d) => d.kind).toSorted()).toEqual([
      'bing',
      'brave',
      'exa',
      'google_cse',
      'serper',
      'tavily',
    ]);
  });

  it('skips google_cse when the search engine id is missing', () => {
    const detected = detectSearchProviderEnvKeys({
      GOOGLE_CSE_API_KEY: 'google-key',
    } as NodeJS.ProcessEnv);
    expect(detected.some((entry) => entry.kind === 'google_cse')).toBe(false);
  });

  it('detects google_cse from GOOGLE_API_KEY and GOOGLE_CSE_CX', () => {
    const detected = detectSearchProviderEnvKeys({
      GOOGLE_API_KEY: 'google-key',
      GOOGLE_CSE_CX: 'cx-from-cx-env',
    } as NodeJS.ProcessEnv);
    expect(detected).toEqual([
      {
        kind: 'google_cse',
        apiKeyEnv: 'GOOGLE_API_KEY',
        cxEnv: 'GOOGLE_CSE_CX',
        label: 'google_cse',
      },
    ]);
  });

  it('detects bing from AZURE_BING_SEARCH_KEY', () => {
    const detected = detectSearchProviderEnvKeys({
      AZURE_BING_SEARCH_KEY: 'azure-bing-key',
    } as NodeJS.ProcessEnv);
    expect(detected).toEqual([
      {
        kind: 'bing',
        apiKeyEnv: 'AZURE_BING_SEARCH_KEY',
        label: 'bing',
      },
    ]);
  });

  it('detects SearXNG from SUPERLIORA_SEARXNG_URL', () => {
    const detected = detectSearchProviderEnvKeys({
      SUPERLIORA_SEARXNG_URL: 'http://127.0.0.1:8080',
    } as NodeJS.ProcessEnv);
    expect(detected).toEqual([
      {
        kind: 'searxng',
        baseUrl: 'http://127.0.0.1:8080',
        label: 'searxng',
      },
    ]);
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
  beforeEach(() => {
    process.env[ALLOW_DISABLE_FREE_FALLBACK_ENV] = '1';
  });

  afterEach(() => {
    delete process.env[ALLOW_DISABLE_FREE_FALLBACK_ENV];
  });

  it('falls back to free local search when no paid keys are configured', async () => {
    const html = [
      '<html><body>',
      '<div class="result">',
      '<a class="result__a" href="https://example.com/docs">Example Docs</a>',
      '<a class="result__snippet">Official docs snippet</a>',
      '</div>',
      '</body></html>',
    ].join('');
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = requestUrl(input);
      if (url.includes('api.duckduckgo.com')) {
        return emptyDdgInstantAnswerResponse();
      }
      return new Response(html, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    });

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
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = requestUrl(input);
      if (url.includes('api.search.brave.com')) {
        return new Response(JSON.stringify({ web: { results: [] } }), {
          status: 429,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('api.duckduckgo.com')) {
        return emptyDdgInstantAnswerResponse();
      }
      return new Response(
        [
          '<html><body>',
          '<div class="result">',
          '<a class="result__a" href="https://example.com/fallback">Fallback</a>',
          '<a class="result__snippet">Free fallback</a>',
          '</div>',
          '</body></html>',
        ].join(''),
        { status: 200, headers: { 'content-type': 'text/html' } },
      );
    });

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
      if (url.includes('api.duckduckgo.com')) {
        return emptyDdgInstantAnswerResponse();
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

  it('parses Google CSE JSON results', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = requestUrl(input);
      expect(url).toContain('customsearch/v1');
      expect(url).toContain('key=google-test');
      expect(url).toContain('cx=my-cx');
      expect(url).toContain('q=messi');
      return new Response(
        JSON.stringify({
          items: [
            {
              title: 'Google CSE Hit',
              link: 'https://example.com/google',
              snippet: 'A useful snippet',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const engine = new ResearchSearchEngine({
      fetchImpl,
      search: {
        strategy: 'fallback',
        freeFallback: false,
        providers: [{ kind: 'google_cse', apiKey: 'google-test', cx: 'my-cx' }],
      },
    });

    const results = await engine.search('messi', { limit: 3 });
    expect(results).toEqual([
      expect.objectContaining({
        title: 'Google CSE Hit',
        url: 'https://example.com/google',
        snippet: 'A useful snippet',
      }),
    ]);
  });

  it('parses Bing JSON results', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = requestUrl(input);
      expect(url).toContain('api.bing.microsoft.com/v7.0/search');
      expect(init?.headers).toMatchObject({
        'Ocp-Apim-Subscription-Key': 'bing-test',
      });
      return new Response(
        JSON.stringify({
          webPages: {
            value: [
              {
                name: 'Bing Hit',
                url: 'https://example.com/bing',
                snippet: 'Bing snippet',
                dateLastCrawled: '2026-01-01T00:00:00Z',
              },
            ],
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const engine = new ResearchSearchEngine({
      fetchImpl,
      search: {
        strategy: 'fallback',
        freeFallback: false,
        providers: [{ kind: 'bing', apiKey: 'bing-test' }],
      },
    });

    const results = await engine.search('query', { limit: 2 });
    expect(results).toEqual([
      expect.objectContaining({
        title: 'Bing Hit',
        url: 'https://example.com/bing',
        snippet: 'Bing snippet',
        date: '2026-01-01T00:00:00Z',
      }),
    ]);
  });

  it('fallback uses bing before free fallback when configured', async () => {
    let bingCalls = 0;
    let freeCalls = 0;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = requestUrl(input);
      if (url.includes('api.bing.microsoft.com')) {
        bingCalls += 1;
        return new Response(
          JSON.stringify({
            webPages: {
              value: [
                { name: 'Paid Bing', url: 'https://example.com/bing-paid', snippet: 'bing query hit' },
              ],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('api.duckduckgo.com')) {
        return emptyDdgInstantAnswerResponse();
      }
      if (url.includes('duckduckgo.com/html')) {
        freeCalls += 1;
        return new Response(
          [
            '<html><body>',
            '<div class="result">',
            '<a class="result__a" href="https://free.example/c">Free</a>',
            '<a class="result__snippet">free</a>',
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
        strategy: 'fallback',
        freeFallback: true,
        providers: [{ kind: 'bing', apiKey: 'bing-test' }],
      },
      local: {
        searchUrl: 'https://duckduckgo.com/html/',
        directSources: { github: false, arxiv: false, npm: false, pypi: false, crates: false },
      },
    });

    const results = await engine.search('bing query', { limit: 1 });
    expect(bingCalls).toBe(1);
    expect(freeCalls).toBe(0);
    expect(results[0]?.url).toContain('example.com/bing-paid');
    expect(engine.status().providers.some((p) => p.kind === 'bing' && p.ready)).toBe(true);
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

  it('parses DuckDuckGo Instant Answer JSON results', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = requestUrl(input);
      expect(url).toContain('api.duckduckgo.com');
      expect(url).toContain('format=json');
      expect(url).toContain('q=typescript');
      expect(init?.headers).toMatchObject({
        Accept: 'application/json',
        'User-Agent': expect.stringContaining('SuperLiora'),
      });
      return new Response(
        JSON.stringify({
          Heading: 'TypeScript',
          AbstractText: 'TypeScript is a typed superset of JavaScript.',
          AbstractURL: 'https://example.com/typescript',
          RelatedTopics: [
            { Text: 'JavaScript language', FirstURL: 'https://example.com/js' },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const engine = new ResearchSearchEngine({
      fetchImpl,
      search: {
        strategy: 'fallback',
        freeFallback: true,
        providers: [{ kind: 'duckduckgo_ia' }],
      },
    });

    const results = await engine.search('typescript', { limit: 2 });
    expect(results).toEqual([
      expect.objectContaining({
        title: 'TypeScript',
        url: 'https://example.com/typescript',
        snippet: 'TypeScript is a typed superset of JavaScript.',
      }),
      expect.objectContaining({
        title: 'JavaScript language',
        url: 'https://example.com/js',
      }),
    ]);
  });

  it('tries DDG IA JSON before DDG HTML when free cascade escalates', async () => {
    const callOrder: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = requestUrl(input);
      if (url.includes('api.duckduckgo.com')) {
        callOrder.push('ia');
        return emptyDdgInstantAnswerResponse();
      }
      if (url.includes('duckduckgo.com/html')) {
        callOrder.push('html');
        return new Response(
          [
            '<html><body>',
            '<div class="result">',
            '<a class="result__a" href="https://example.com/html-hit">HTML Hit</a>',
            '<a class="result__snippet">from html scraper</a>',
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
      search: { strategy: 'auto', freeFallback: true, minResultsToStop: 1 },
      local: {
        searchUrl: 'https://duckduckgo.com/html/',
        directSources: { github: false, arxiv: false, npm: false, pypi: false, crates: false },
      },
    });

    const results = await engine.search('empty ia query', { limit: 1 });
    expect(callOrder.indexOf('ia')).toBeGreaterThanOrEqual(0);
    expect(callOrder.indexOf('html')).toBeGreaterThan(callOrder.indexOf('ia'));
    expect(results[0]?.url).toContain('example.com/html-hit');
    expect(engine.status().providers.some((p) => p.kind === 'duckduckgo_ia')).toBe(true);
  });

});

describe('parseDuckDuckGoInstantAnswerResponse', () => {
  it('maps abstract, related topics, nested topics, and results', () => {
    const results = parseDuckDuckGoInstantAnswerResponse(
      {
        Heading: 'Example Topic',
        AbstractText: 'Main abstract text.',
        AbstractURL: 'https://example.com/topic',
        RelatedTopics: [
          { Text: 'Flat related', FirstURL: 'https://example.com/related' },
          {
            Name: 'Nested group',
            Topics: [{ Text: 'Nested related', FirstURL: 'https://example.com/nested' }],
          },
        ],
        Results: [{ Text: 'Direct result', FirstURL: 'https://example.com/result' }],
      },
      5,
    );

    expect(results.map((r) => r.url)).toEqual([
      'https://example.com/topic',
      'https://example.com/related',
      'https://example.com/nested',
      'https://example.com/result',
    ]);
    expect(results[0]).toMatchObject({
      title: 'Example Topic',
      snippet: 'Main abstract text.',
    });
  });

  it('skips entries without usable URLs', () => {
    const results = parseDuckDuckGoInstantAnswerResponse(
      {
        AbstractText: 'No link',
        AbstractURL: '',
        RelatedTopics: [{ Text: 'Bad', FirstURL: 'not-a-url' }],
      },
      3,
    );
    expect(results).toEqual([]);
  });
});

describe('assessSearchChannelHealth', () => {
  it('is healthy when a paid slot is ready', () => {
    const health = assessSearchChannelHealth({
      strategy: 'auto',
      freeFallback: true,
      browser: { configured: false, ready: false },
      chromeExtension: { configured: false, enabled: false, ready: false },
      providers: [
        {
          id: 'brave-0',
          kind: 'brave',
          label: 'Brave',
          ready: true,
          source: 'env',
        },
        {
          id: 'ddg-0',
          kind: 'duckduckgo',
          label: 'DuckDuckGo',
          ready: true,
          source: 'local',
        },
      ],
    });
    expect(health).toEqual({ degraded: false, hard: false });
  });

  it('soft-degrades when all paid slots are cooling but free fallback is ready', () => {
    const health = assessSearchChannelHealth({
      strategy: 'auto',
      freeFallback: true,
      browser: { configured: false, ready: false },
      chromeExtension: { configured: false, enabled: false, ready: false },
      providers: [
        {
          id: 'brave-0',
          kind: 'brave',
          label: 'Brave',
          ready: false,
          source: 'env',
          cooldownUntil: Date.now() + 60_000,
        },
        {
          id: 'ddg-0',
          kind: 'duckduckgo',
          label: 'DuckDuckGo',
          ready: true,
          source: 'local',
        },
      ],
    });
    expect(health.degraded).toBe(true);
    expect(health.hard).toBe(false);
    expect(health.reason).toBe('paid_channels_cooling');
  });

  it('hard-degrades when paid slots cool and free fallback is disabled', () => {
    const health = assessSearchChannelHealth({
      strategy: 'fallback',
      freeFallback: false,
      browser: { configured: false, ready: false },
      chromeExtension: { configured: false, enabled: false, ready: false },
      providers: [
        {
          id: 'tavily-0',
          kind: 'tavily',
          label: 'Tavily',
          ready: false,
          source: 'config',
          cooldownUntil: Date.now() + 60_000,
        },
      ],
    });
    expect(health.degraded).toBe(true);
    expect(health.hard).toBe(true);
    expect(health.reason).toBe('paid_channels_cooling_no_fallback');
  });

  it('soft-degrades when only late channels (Ch5) remain ready', () => {
    const health = assessSearchChannelHealth({
      strategy: 'fallback',
      freeFallback: false,
      browser: { configured: false, ready: false },
      chromeExtension: { configured: true, enabled: true, ready: true },
      providers: [
        {
          id: 'tavily-0',
          kind: 'tavily',
          label: 'Tavily',
          ready: false,
          source: 'config',
          cooldownUntil: Date.now() + 60_000,
        },
      ],
    });
    expect(health.degraded).toBe(true);
    expect(health.hard).toBe(false);
    expect(health.reason).toBe('paid_channels_cooling_late_channels');
    expect(health.hint).toContain('Chrome extension bridge');
  });
});

describe('buildSearchNeverEmptyNextStep', () => {
  it('always mentions Ch4/Ch5 on the never-empty path', () => {
    const next = buildSearchNeverEmptyNextStep();
    expect(next).toContain('Ch4');
    expect(next).toContain('Ch5');
  });

  it('still mentions Ch4/Ch5 when late channels were already tried', () => {
    const next = buildSearchNeverEmptyNextStep({ channelsTried: ['ch4', 'ch5'] });
    expect(next).toContain('Ch4');
    expect(next).toContain('Ch5');
    expect(next).toContain('retry browser automation');
  });

  it('prefers Ch5 when only Ch4 was tried', () => {
    const next = buildSearchNeverEmptyNextStep({ channelsTried: ['ch4'] });
    expect(next).toContain('Chrome extension bridge (Ch5)');
    expect(next).toContain('retry browser automation (Ch4)');
  });

  it('mentions free fallback when paid channels are cooling', () => {
    const next = buildSearchNeverEmptyNextStep({
      health: {
        degraded: true,
        hard: false,
        reason: 'paid_channels_cooling',
      },
    });
    expect(next).toContain('free fallback');
    expect(next).toContain('Ch4');
    expect(next).toContain('Ch5');
  });

  it('mentions SearXNG meta when health reason is meta-only', () => {
    const next = buildSearchNeverEmptyNextStep({
      health: {
        degraded: true,
        hard: false,
        reason: 'meta_channel_only',
      },
    });
    expect(next).toContain('Ch2 SearXNG');
    expect(next).toContain('Ch4');
    expect(next).toContain('Ch5');
  });

  it('omits WebSearch retry when all channels are hard-failed', () => {
    const next = buildSearchNeverEmptyNextStep({
      health: {
        degraded: true,
        hard: true,
        reason: 'all_channels_cooling',
      },
    });
    expect(next).not.toContain('retry WebSearch');
    expect(next).toContain('FetchURL');
    expect(next).toContain('Ch4');
    expect(next).toContain('Ch5');
  });
});

describe('formatSearchNeverEmptySoftFailLines', () => {
  it('records telemetry and emits hint when degraded', () => {
    resetSearchNeverEmptyTelemetry();
    const lines = formatSearchNeverEmptySoftFailLines({
      degraded: true,
      health: {
        degraded: true,
        hard: false,
        hint: 'Paid slots cooling.',
      },
      channelsTried: ['ch1', 'ch3'],
    });
    expect(lines).toEqual([
      'degraded: true',
      'hint: Paid slots cooling.',
      'channelsTried: ch1 | ch3',
      expect.stringMatching(/^next: /),
    ]);
    expect(getSearchNeverEmptyTelemetry().softDegradeCount).toBe(1);
  });

  it('skips channelsTried when includeChannelsTried is false', () => {
    resetSearchNeverEmptyTelemetry();
    const lines = formatSearchNeverEmptySoftFailLines({
      degraded: true,
      channelsTried: ['ch3'],
      includeChannelsTried: false,
    });
    expect(lines.some((line) => line.startsWith('channelsTried:'))).toBe(false);
    expect(lines).toContain('degraded: true');
    expect(lines.some((line) => line.startsWith('next:'))).toBe(true);
  });
});

describe('inferSearchChannelsFromStatus', () => {
  it('includes ch2 when searxng provider is ready', () => {
    const channels = inferSearchChannelsFromStatus({
      strategy: 'auto',
      freeFallback: true,
      browser: { configured: false, ready: false },
      chromeExtension: { configured: false, enabled: false, ready: false },
      providers: [
        {
          id: 'searxng-0',
          kind: 'searxng',
          label: 'searxng',
          ready: true,
          source: 'env',
        },
        {
          id: 'duckduckgo-1',
          kind: 'duckduckgo',
          label: 'duckduckgo',
          ready: true,
          source: 'local',
        },
      ],
    });
    expect(channels).toEqual(['ch2', 'ch3']);
  });

  it('includes ch5 when chrome extension escalate was attempted', () => {
    const channels = inferSearchChannelsFromStatus({
      strategy: 'fallback',
      freeFallback: false,
      browser: { configured: true, ready: true, escalateAttempted: true },
      chromeExtension: {
        configured: true,
        enabled: true,
        ready: false,
        escalateAttempted: true,
      },
      providers: [
        {
          id: 'brave-0',
          kind: 'brave',
          label: 'Brave',
          ready: true,
          source: 'env',
        },
      ],
    });
    expect(channels).toEqual(['ch1', 'ch4', 'ch5']);
  });
});
