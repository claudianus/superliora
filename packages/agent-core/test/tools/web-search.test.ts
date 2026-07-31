/**
 * Covers: WebSearchTool.
 *
 * Uses a fake WebSearchProvider to test tool behaviour in isolation.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  WebSearchInputSchema,
  WebSearchTool,
  type WebSearchProvider,
} from '../../src/tools/builtin/web/web-search';
import type { UrlFetcher } from '../../src/tools/builtin/web/fetch-url';
import { LocalWebSearchProvider } from '../../src/tools/providers/local-web-search';
import { MoonshotWebSearchProvider } from '../../src/tools/providers/moonshot-web-search';
import { ResearchSearchEngine } from '../../src/tools/providers/research-search';
import {
  getLocalResearchCacheTelemetry,
  resetLocalResearchCacheTelemetry,
} from '../../src/tools/providers/local-research-cache-telemetry';
import {
  getSearchNeverEmptyTelemetry,
  resetSearchNeverEmptyTelemetry,
} from '../../src/tools/providers/search-never-empty-telemetry';
import { toolContentString } from './fixtures/fake-kaos';
import { executeTool } from './fixtures/execute-tool';

const signal = new AbortController().signal;

function fakeProvider(
  results: Awaited<ReturnType<WebSearchProvider['search']>> = [],
): WebSearchProvider {
  return { search: vi.fn().mockResolvedValue(results) };
}

describe('WebSearchTool', () => {
  it('has name "WebSearch" and a non-empty description', () => {
    const tool = new WebSearchTool(fakeProvider());
    expect(tool.name).toBe('WebSearch');
    expect(tool.description.length).toBeGreaterThan(0);
  });

  it('parameters are generated from the current input schema', () => {
    const tool = new WebSearchTool(fakeProvider());
    expect(WebSearchInputSchema.safeParse({ query: 'test' }).success).toBe(true);
    expect(tool.parameters).toMatchObject({
      type: 'object',
      properties: {
        query: { type: 'string' },
      },
    });
  });

  it('limit description guides toward refining the query instead of raising limit', () => {
    const tool = new WebSearchTool(fakeProvider());
    const limit = (tool.parameters as { properties: Record<string, { description?: string }> })
      .properties['limit'];
    expect(limit?.description).toContain('default 3');
    expect(limit?.description).toContain('Prefer a sharper query');
  });

  it('include_content description warns about token cost at large limits', () => {
    const tool = new WebSearchTool(fakeProvider());
    const includeContent = (
      tool.parameters as { properties: Record<string, { description?: string }> }
    ).properties['include_content'];
    expect(includeContent?.description).toContain('consume a large amount of tokens');
    expect(includeContent?.description).toContain('avoid enabling this when `limit` is set');
    // Use the TS/JSON boolean literal, not Python's capitalized `True`.
    expect(includeContent?.description).toContain('set to true');
    expect(includeContent?.description).not.toContain('True');
  });

  it('returns formatted results from provider', async () => {
    const provider = fakeProvider([
      { title: 'Result 1', url: 'https://example.com/1', snippet: 'Snippet 1' },
      { title: 'Result 2', url: 'https://example.com/2', snippet: 'Snippet 2', date: '2024-01-01' },
    ]);
    const tool = new WebSearchTool(provider);
    const result = await executeTool(tool, {
      turnId: 't1',
      toolCallId: 'c1',
      args: { query: 'test query' },
      signal,
    });
    expect(result.isError).toBe(false);
    const content = toolContentString(result);
    expect(content).toContain('Result 1');
    expect(content).toContain('https://example.com/1');
    expect(content).toContain('Result 2');
    expect(content).toContain('2024-01-01');
  });

  it('renders the snippet under a "Snippet:" label consistent with the schema term', async () => {
    const provider = fakeProvider([
      { title: 'Result 1', url: 'https://example.com/1', snippet: 'Snippet 1' },
    ]);
    const tool = new WebSearchTool(provider);
    const result = await executeTool(tool, {
      turnId: 't1',
      toolCallId: 'c-snippet',
      args: { query: 'test query' },
      signal,
    });
    const content = toolContentString(result);
    expect(content).toContain('Snippet: Snippet 1');
    expect(content).not.toContain('Summary:');
  });

  it('describes the search behavior in the tool description', () => {
    const tool = new WebSearchTool(fakeProvider());
    const description = tool.description.toLowerCase();
    expect(description).toContain('snippet');
    expect(description).toContain('include_content');
  });

  it('does not promise page content unconditionally for every result', () => {
    // Page content is rendered only when the provider returns it (`include_content`
    // is merely forwarded to the provider). The description must not claim it is
    // appended for every result, or it repeats the overpromise this PR fixes.
    const tool = new WebSearchTool(fakeProvider());
    const description = tool.description.toLowerCase();
    expect(description).not.toContain('for each result');
  });

  it('instructs the model to use FetchURL for cite targets in its description', () => {
    const tool = new WebSearchTool(fakeProvider());
    const description = tool.description.toLowerCase();
    expect(description).toContain('cite');
    expect(description).toContain('fetchurl');
  });

  it('returns no results message when provider returns empty', async () => {
    resetSearchNeverEmptyTelemetry();
    const tool = new WebSearchTool(fakeProvider([]));
    const result = await executeTool(tool, {
      turnId: 't1',
      toolCallId: 'c2',
      args: { query: 'nothing' },
      signal,
    });
    expect(result.isError).toBe(false);
    expect(toolContentString(result)).toContain('No live search hits');
    expect(toolContentString(result)).toContain('degraded: true');
    expect(toolContentString(result)).toContain('Ch4');
    expect(toolContentString(result)).toContain('Ch5');
    expect(getSearchNeverEmptyTelemetry().softDegradeCount).toBe(1);
    expect(getSearchNeverEmptyTelemetry().hardFailCount).toBe(0);
  });

  it('soft-degrades when ResearchSearchEngine empty-cascades with freeFallback off', async () => {
    const browserSearch = vi.fn<() => Promise<never[]>>().mockResolvedValue([]);
    const chromeSearch = vi.fn<() => Promise<never[]>>().mockResolvedValue([]);
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ web: { results: [] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const engine = new ResearchSearchEngine({
      fetchImpl,
      browserChannel: { available: () => true, search: browserSearch },
      chromeExtensionChannel: { available: () => true, search: chromeSearch },
      search: {
        strategy: 'fallback',
        freeFallback: false,
        providers: [{ kind: 'brave', apiKey: 'brave-test-key' }],
      },
    });

    const tool = new WebSearchTool(engine);
    const result = await executeTool(tool, {
      turnId: 't1',
      toolCallId: 'c-empty-cascade',
      args: { query: 'empty cascade test' },
      signal,
    });

    expect(result.isError).toBe(false);
    const content = toolContentString(result);
    expect(content).toContain('degraded: true');
    expect(content).toContain('next:');
    expect(content).toContain('Ch4');
    expect(content).toContain('Ch5');
    expect(content).toContain('channelsTried:');
    expect(content).toContain('ch5');
    expect(browserSearch).toHaveBeenCalledTimes(1);
    expect(chromeSearch).toHaveBeenCalledTimes(1);
  });

  it('truncates oversized result content through the shared builder', async () => {
    const tool = new WebSearchTool(
      fakeProvider([
        {
          title: 'Large result',
          url: 'https://example.com/large',
          snippet: 'Large snippet',
          content: 'x'.repeat(60_000),
        },
      ]),
    );

    const result = await executeTool(tool, {
      turnId: 't1',
      toolCallId: 'c-large',
      args: { query: 'large', include_content: true },
      signal,
    });

    const content = toolContentString(result);
    expect(result.isError).toBe(false);
    expect(content).toContain('[...truncated]');
    expect(content).toContain('Output is truncated');
    expect(content.length).toBeLessThan(60_000);
    expect((result as { message?: string }).message).toContain('Output is truncated');
  });

  it('returns error when provider throws', async () => {
    const provider: WebSearchProvider = {
      search: vi.fn().mockRejectedValue(new Error('network error')),
    };
    const tool = new WebSearchTool(provider);
    const result = await executeTool(tool, {
      turnId: 't1',
      toolCallId: 'c3',
      args: { query: 'fail' },
      signal,
    });
    expect(result.isError).toBe(false);
    const content = toolContentString(result);
    expect(content).toContain('network error');
    expect(content).toContain('degraded: true');
    expect(content).toContain('next:');
    expect(content).toContain('Ch4');
    expect(content).toContain('Ch5');
  });

  it('classifies authentication failures', async () => {
    const provider: WebSearchProvider = {
      search: vi
        .fn()
        .mockRejectedValue(
          new Error('Moonshot search request failed: HTTP 401 (auth/unauthorized).'),
        ),
    };
    const tool = new WebSearchTool(provider);
    const result = await executeTool(tool, {
      turnId: 't1',
      toolCallId: 'c-auth',
      args: { query: 'fail' },
      signal,
    });
    expect(result.isError).toBe(false);
    const content = toolContentString(result);
    expect(content).toContain('degraded: true');
    // Assert the classification prefix, not text that already appears in the raw error.
    expect(content).toContain('Search failed (authentication):');
    // The original error text is preserved alongside the prefix.
    expect(content).toContain('HTTP 401');
    expect(content).toContain('next:');
    expect(content).toContain('Ch4');
    expect(content).toContain('Ch5');
  });

  it('classifies timeout failures', async () => {
    const err = new Error('request timed out');
    err.name = 'TimeoutError';
    const provider: WebSearchProvider = { search: vi.fn().mockRejectedValue(err) };
    const tool = new WebSearchTool(provider);
    const result = await executeTool(tool, {
      turnId: 't1',
      toolCallId: 'c-timeout',
      args: { query: 'fail' },
      signal,
    });
    expect(result.isError).toBe(false);
    const content = toolContentString(result);
    expect(content).toContain('degraded: true');
    // Assert the classification prefix, which does not overlap with the raw error text.
    expect(content).toContain('Search timed out:');
    // The original error text is preserved alongside the prefix.
    expect(content).toContain('request timed out');
  });

  it('classifies aborted requests', async () => {
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    const provider: WebSearchProvider = { search: vi.fn().mockRejectedValue(err) };
    const tool = new WebSearchTool(provider);
    const result = await executeTool(tool, {
      turnId: 't1',
      toolCallId: 'c-abort',
      args: { query: 'fail' },
      signal,
    });
    expect(result.isError).toBe(false);
    const content = toolContentString(result);
    expect(content).toContain('degraded: true');
    // Assert the classification prefix, not text that already appears in the raw error.
    expect(content).toContain('Search cancelled:');
    // The original error text is preserved alongside the prefix.
    expect(content).toContain('The operation was aborted');
  });

  it('emits degraded when provider status reports soft channel degrade with results', async () => {
    const provider: WebSearchProvider = {
      search: vi.fn().mockResolvedValue([
        { title: 'Hit', url: 'https://example.com/hit', snippet: 'from free fallback' },
      ]),
      status: () => ({
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
      }),
    };
    const tool = new WebSearchTool(provider);
    const result = await executeTool(tool, {
      turnId: 't1',
      toolCallId: 'c-soft-degrade',
      args: { query: 'test' },
      signal,
    });
    const content = toolContentString(result);
    expect(result.isError).toBe(false);
    expect(content).toContain('Hit');
    expect(content).toContain('degraded: true');
    expect(content).toContain('Paid search slots are cooling');
  });

  it('passes limit and includeContent to provider', async () => {
    const provider = fakeProvider([]);
    const tool = new WebSearchTool(provider);
    await executeTool(tool, {
      turnId: 't1',
      toolCallId: 'c4',
      args: { query: 'test', limit: 10, include_content: true },
      signal,
    });
    expect(provider.search).toHaveBeenCalledWith('test', {
      limit: 10,
      includeContent: true,
      toolCallId: 'c4',
    });
  });

  it('resolveExecution description truncates long queries', () => {
    const tool = new WebSearchTool(fakeProvider());
    const execution = tool.resolveExecution({ query: 'a'.repeat(60) });
    expect(execution.isError).toBeFalsy();
    if (execution.isError === true) throw new Error('expected runnable execution');
    const desc = execution.description;
    const text = desc ?? '';
    expect(text.length).toBeLessThanOrEqual(55);
    expect(text).toContain('…');
  });

  it('description names internet search as the tool surface', () => {
    const tool = new WebSearchTool(fakeProvider());
    expect(tool.description.toLowerCase()).toMatch(/internet|search the web/);
    expect(tool.description.toLowerCase()).toContain('search');
  });
});

describe('LocalWebSearchProvider', () => {
  it('parses public DuckDuckGo HTML results without a managed search service', async () => {
    const html = [
      '<html><body>',
      '<div class="result">',
      '<a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs">Example Docs</a>',
      '<a class="result__snippet">Official docs snippet</a>',
      '</div>',
      '<div class="result">',
      '<a class="result__a" href="https://example.test/blog">Example Blog</a>',
      '<a class="result__snippet">Blog snippet</a>',
      '</div>',
      '</body></html>',
    ].join('');
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(html, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }));
    const provider = new LocalWebSearchProvider({
      fetchImpl,
      searchUrl: 'https://duckduckgo.com/html/',
    });

    const results = await provider.search('kimi code latest docs', { limit: 1 });

    expect(fetchImpl).toHaveBeenCalled();
    const requestUrl = fetchImpl.mock.calls[0]?.[0] as URL;
    expect(requestUrl.hostname).toContain('duckduckgo.com');
    expect(requestUrl.searchParams.get('q')).toContain('kimi code latest docs');
    expect(results[0]).toMatchObject({
      title: 'Example Docs',
      url: 'https://example.com/docs',
    });
    expect(results[0]?.snippet).toContain('Official docs snippet');
  });

  it('rejects oversized local search responses before parsing', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('too large', {
      status: 200,
      headers: { 'content-length': '99' },
    }));
    const provider = new LocalWebSearchProvider({ fetchImpl, maxBytes: 10 });

    await expect(provider.search('query')).rejects.toThrow(/too large/i);
  });

  it('falls back to direct public sources when the HTML search endpoint fails', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = input as URL;
      if (url.hostname.includes('duckduckgo.com')) {
        return new Response('unavailable', { status: 503 });
      }
      if (url.hostname === 'api.github.com') {
        return new Response(JSON.stringify({
          items: [
            {
              full_name: 'example/research-tool',
              html_url: 'https://github.com/example/research-tool',
              description: 'Local research fallback',
              updated_at: '2026-01-02T00:00:00Z',
            },
          ],
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('{}', { status: 404 });
    });
    const provider = new LocalWebSearchProvider({
      fetchImpl,
      searchUrl: 'https://duckduckgo.com/html/',
      directSources: { github: true, arxiv: false, npm: false, pypi: false, crates: false },
    });

    const results = await provider.search('local research fallback', { limit: 3 });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toMatchObject({
      title: 'example/research-tool',
      url: 'https://github.com/example/research-tool',
    });
    expect(results[0]?.snippet).toContain('[github]');
  });

  it('fetches result content with the configured local concurrency cap', async () => {
    const html = [
      '<html><body>',
      ...[1, 2, 3, 4].map((n) => [
        '<div class="result">',
        `<a class="result__a" href="https://example.com/docs-${String(n)}">Doc ${String(n)}</a>`,
        `<a class="result__snippet">Snippet ${String(n)}</a>`,
        '</div>',
      ].join('')),
      '</body></html>',
    ].join('');
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = input as URL;
      if (url.hostname.includes('duckduckgo.com')) {
        return new Response(html, {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      }
      return new Response(JSON.stringify({ items: [], objects: [], crates: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    let active = 0;
    let maxActive = 0;
    const urlFetcher: UrlFetcher = {
      fetch: vi.fn(async (url) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return { content: `Fetched ${url}`, kind: 'extracted' as const };
      }),
    };
    const provider = new LocalWebSearchProvider({
      fetchImpl,
      urlFetcher,
      searchUrl: 'https://duckduckgo.com/html/',
      concurrency: 2,
      directSources: { github: false, arxiv: false, npm: false, pypi: false, crates: false },
    });

    const results = await provider.search('docs', { limit: 4, includeContent: true });

    expect(results).toHaveLength(4);
    expect(results.every((result) => result.content?.startsWith('Fetched https://example.com/docs-'))).toBe(true);
    expect(maxActive).toBeLessThanOrEqual(2);
  });
  it('runs direct tech sources in parallel for package-intent free search', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = input as URL;
      if (url.hostname === 'duckduckgo.com' || url.hostname === 'lite.duckduckgo.com') {
        return new Response(
          [
            '<html><body>',
            '<div class="result">',
            '<a class="result__a" href="https://example.com/blog">SEO Blog</a>',
            '<a class="result__snippet">generic blog post</a>',
            '</div>',
            '</body></html>',
          ].join(''),
          { status: 200, headers: { 'content-type': 'text/html' } },
        );
      }
      if (url.hostname === 'registry.npmjs.org') {
        return new Response(
          JSON.stringify({
            objects: [
              {
                package: {
                  name: 'zod',
                  version: '3.23.0',
                  description: 'TypeScript-first schema validation',
                  links: { npm: 'https://www.npmjs.com/package/zod' },
                  date: '2026-01-01T00:00:00.000Z',
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.hostname === 'api.github.com') {
        return new Response(
          JSON.stringify({
            items: [
              {
                full_name: 'colinhacks/zod',
                html_url: 'https://github.com/colinhacks/zod',
                description: 'TypeScript-first schema declaration',
                updated_at: '2026-01-02T00:00:00Z',
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 404 });
    });

    const provider = new LocalWebSearchProvider({
      fetchImpl,
      searchUrl: 'https://duckduckgo.com/html/',
      directSources: { github: true, npm: true, arxiv: false, pypi: false, crates: false },
    });

    const results = await provider.search('zod typescript npm schema', { limit: 5 });
    const urls = results.map((r) => r.url);
    expect(urls).toContain('https://www.npmjs.com/package/zod');
    expect(urls).toContain('https://github.com/colinhacks/zod');
    // Primary source ranking should beat generic blog for package intent.
    expect(urls[0]).not.toBe('https://example.com/blog');
  });

  it('skips expensive direct APIs for general non-tech free queries', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = input as URL;
      if (url.hostname.includes('duckduckgo.com')) {
        return new Response(
          [
            '<html><body>',
            '<div class="result">',
            '<a class="result__a" href="https://example.com/weather">Weather</a>',
            '<a class="result__snippet">today weather</a>',
            '</div>',
            '</body></html>',
          ].join(''),
          { status: 200, headers: { 'content-type': 'text/html' } },
        );
      }
      return new Response('should-not-call', { status: 500 });
    });

    const provider = new LocalWebSearchProvider({
      fetchImpl,
      searchUrl: 'https://duckduckgo.com/html/',
      directSources: { github: true, npm: true, arxiv: true, pypi: true, crates: true },
    });

    const results = await provider.search('what is the weather today', { limit: 3 });
    expect(results[0]?.url).toContain('example.com/weather');
    const hosts = fetchImpl.mock.calls.map((call) => (call[0] as URL).hostname);
    expect(hosts.some((h) => h === 'api.github.com')).toBe(false);
    expect(hosts.some((h) => h === 'registry.npmjs.org')).toBe(false);
  });

  it('records LocalResearchCache hit/miss telemetry on disk cache lookups', async () => {
    resetLocalResearchCacheTelemetry();
    const cacheDir = await mkdtemp(join(tmpdir(), 'liora-local-cache-'));
    const cachePath = join(cacheDir, 'search.sqlite');
    const html = [
      '<html><body>',
      '<div class="result">',
      '<a class="result__a" href="https://example.com/cache-test">Cache Test</a>',
      '<a class="result__snippet">cached snippet</a>',
      '</div>',
      '</body></html>',
    ].join('');
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(html, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }));
    const provider = new LocalWebSearchProvider({
      fetchImpl,
      searchUrl: 'https://duckduckgo.com/html/',
      cachePath,
      directSources: { github: false, arxiv: false, npm: false, pypi: false, crates: false },
    });

    try {
      await provider.search('cache telemetry query', { limit: 1 });
      await provider.search('cache telemetry query', { limit: 1 });
      expect(getLocalResearchCacheTelemetry()).toEqual({
        hits: 1,
        misses: 1,
        hitRate: 0.5,
      });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });
});

describe('MoonshotWebSearchProvider', () => {
  it('does not force-refresh request auth after a 401 response', async () => {
    const getAccessToken = vi.fn().mockResolvedValue('fresh-token');
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('unauthorized', { status: 401 }));
    const provider = new MoonshotWebSearchProvider({
      tokenProvider: { getAccessToken },
      baseUrl: 'https://search.example/v1',
      fetchImpl,
    });

    await expect(provider.search('query')).rejects.toThrow(/HTTP 401/);

    expect(getAccessToken).toHaveBeenCalledTimes(1);
    expect(getAccessToken).toHaveBeenCalledWith();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: 'Bearer fresh-token',
    });
  });
});
