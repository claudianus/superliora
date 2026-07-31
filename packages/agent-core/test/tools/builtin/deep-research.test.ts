/**
 * Covers: DeepResearch query planning and source merge helpers.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  buildDeepResearchOutput,
  clampDeepResearchBudgetUsd,
  DeepResearchTool,
  depthIncludesContent,
  depthSearchLimit,
  extractKeyTerms,
  mergeResearchSources,
  normalizeResearchUrl,
  planDeepResearchQueries,
  resolveDeepResearchAllowBrowser,
} from '../../../src/tools/builtin/web/deep-research';
import type { UrlFetcher } from '../../../src/tools/builtin/web/fetch-url';
import { ResearchSearchEngine } from '../../../src/tools/providers/research-search';
import {
  getSearchNeverEmptyTelemetry,
  resetSearchNeverEmptyTelemetry,
} from '../../../src/tools/providers/search-never-empty-telemetry';
import type { WebSearchProvider } from '../../../src/tools/builtin/web/web-search';
import { executeTool } from '../fixtures/execute-tool';
import { toolContentString } from '../fixtures/fake-kaos';

describe('depthSearchLimit', () => {
  it('maps depth presets to per-query limits', () => {
    expect(depthSearchLimit('quick')).toBe(3);
    expect(depthSearchLimit('standard')).toBe(5);
    expect(depthSearchLimit('exhaustive')).toBe(8);
  });
});

describe('depthIncludesContent', () => {
  it('enables page excerpts for standard and exhaustive only', () => {
    expect(depthIncludesContent('quick')).toBe(false);
    expect(depthIncludesContent('standard')).toBe(true);
    expect(depthIncludesContent('exhaustive')).toBe(true);
  });
});

describe('extractKeyTerms', () => {
  it('drops stop words and keeps significant tokens', () => {
    expect(extractKeyTerms('What is the latest Rust async runtime?')).toEqual([
      'latest',
      'rust',
      'async',
    ]);
  });
});

describe('planDeepResearchQueries', () => {
  it('always includes the question and an overview query', () => {
    const queries = planDeepResearchQueries('GraphQL federation patterns');
    expect(queries[0]).toBe('GraphQL federation patterns');
    expect(queries).toContain('GraphQL federation patterns overview');
  });

  it('adds freshness-oriented queries when freshness is not any', () => {
    const queries = planDeepResearchQueries('OpenAI API pricing', 'week');
    expect(queries.some((query) => query.startsWith('latest '))).toBe(true);
    expect(queries.some((query) => query.endsWith(' week'))).toBe(true);
  });

  it('caps planned queries at five', () => {
    expect(planDeepResearchQueries('What are the best practices for secure Kubernetes ingress?', 'month').length).toBeLessThanOrEqual(5);
  });
});

describe('normalizeResearchUrl', () => {
  it('normalizes host casing and trailing slashes', () => {
    expect(normalizeResearchUrl('https://WWW.Example.com/docs/')).toBe('https://example.com/docs');
  });
});

describe('mergeResearchSources', () => {
  it('dedupes by URL and ranks by hit count then snippet length', () => {
    const merged = mergeResearchSources(
      [
        {
          query: 'alpha',
          results: [
            { title: 'Short', url: 'https://example.com/a', snippet: 'short' },
            { title: 'Dup', url: 'https://example.com/shared', snippet: 'first hit' },
          ],
        },
        {
          query: 'beta',
          results: [
            {
              title: 'Dup longer',
              url: 'https://www.example.com/shared/',
              snippet: 'second hit with a much longer snippet body',
            },
            { title: 'Other', url: 'https://example.com/b', snippet: 'other' },
          ],
        },
      ],
      8,
    );

    expect(merged).toHaveLength(3);
    expect(merged[0]?.url).toBe('https://example.com/shared');
    expect(merged[0]?.hitCount).toBe(2);
    expect(merged[0]?.matchedQueries).toEqual(['alpha', 'beta']);
    expect(merged[0]?.snippet).toContain('much longer snippet');
  });

  it('respects max_sources', () => {
    const merged = mergeResearchSources(
      [
        {
          query: 'q',
          results: [
            { title: '1', url: 'https://example.com/1', snippet: 'one' },
            { title: '2', url: 'https://example.com/2', snippet: 'two' },
            { title: '3', url: 'https://example.com/3', snippet: 'three' },
          ],
        },
      ],
      2,
    );
    expect(merged).toHaveLength(2);
  });
});

describe('resolveDeepResearchAllowBrowser', () => {
  it('defaults to exhaustive-only escalate when allow_browser omitted', () => {
    expect(resolveDeepResearchAllowBrowser(undefined, 'quick')).toBe(false);
    expect(resolveDeepResearchAllowBrowser(undefined, 'standard')).toBe(false);
    expect(resolveDeepResearchAllowBrowser(undefined, 'exhaustive')).toBe(true);
  });

  it('honors explicit allow_browser over depth', () => {
    expect(resolveDeepResearchAllowBrowser(true, 'quick')).toBe(true);
    expect(resolveDeepResearchAllowBrowser(false, 'exhaustive')).toBe(false);
  });
});

describe('clampDeepResearchBudgetUsd', () => {
  it('clamps to 0..100', () => {
    expect(clampDeepResearchBudgetUsd(undefined)).toBeUndefined();
    expect(clampDeepResearchBudgetUsd(-1)).toBe(0);
    expect(clampDeepResearchBudgetUsd(250)).toBe(100);
    expect(clampDeepResearchBudgetUsd(1.5)).toBe(1.5);
  });
});

describe('buildDeepResearchOutput', () => {
  it('emits structured sections and degraded hints when empty', () => {
    const output = buildDeepResearchOutput({
      question: 'Rust async',
      queries: ['Rust async', 'Rust async overview'],
      sources: [],
      degraded: true,
      hops: 2,
      channelsTried: ['ch3'],
      allowBrowser: false,
    });

    expect(output).toContain('answer_outline:');
    expect(output).toContain('claims:');
    expect(output).toContain('sources:');
    expect(output).toContain('queries: Rust async | Rust async overview');
    expect(output).toContain('channels_used: ch3');
    expect(output).toContain('offline_stub:');
    expect(output).toContain('mode: local-only');
    expect(output).toContain('hops: 2');
    expect(output).toContain('channelsTried: ch3');
    expect(output).toContain('allow_browser: false');
    expect(output).toContain('degraded: true');
    expect(output).toContain('next:');
    expect(output).toContain('Ch4');
    expect(output).toContain('Ch5');
  });

  it('includes merged sources in claims and sources sections', () => {
    const output = buildDeepResearchOutput({
      question: 'Rust async',
      queries: ['Rust async'],
      sources: [
        {
          title: 'Tokio guide',
          url: 'https://example.com/tokio',
          snippet: 'Tokio is the async runtime for Rust.',
          date: '2026-07-15',
          hitCount: 2,
          matchedQueries: ['Rust async', 'Rust async overview'],
        },
      ],
      degraded: false,
      hops: 1,
      channelsTried: ['ch1', 'ch3'],
    });

    expect(output).toContain('Tokio guide');
    expect(output).toContain('https://example.com/tokio');
    expect(output).toContain('[high]');
    expect(output).toContain('as_of: 2026-07-15');
    expect(output).toContain('degraded: false');
  });

  it('includes truncated body excerpts in sources when content is present', () => {
    const output = buildDeepResearchOutput({
      question: 'Rust async',
      queries: ['Rust async'],
      sources: [
        {
          title: 'Tokio guide',
          url: 'https://example.com/tokio',
          snippet: 'Tokio is the async runtime for Rust.',
          content: 'Tokio provides an event-driven platform for writing asynchronous Rust applications.',
          hitCount: 1,
          matchedQueries: ['Rust async'],
        },
      ],
      degraded: false,
      hops: 1,
      channelsTried: ['ch3'],
    });

    expect(output).toContain('excerpt:');
    expect(output).toContain('event-driven platform');
  });
});

describe('DeepResearchTool', () => {
  const signal = new AbortController().signal;

  function requestUrl(input: string | URL | { readonly url: string }): string {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.href;
    return input.url;
  }

  function buildDdgHtml(title: string, url: string, snippet: string): string {
    return [
      '<html><body>',
      '<div class="result">',
      `<a class="result__a" href="${url}">${title}</a>`,
      `<a class="result__snippet">${snippet}</a>`,
      '</div>',
      '</body></html>',
    ].join('');
  }

  it('fetches page excerpts for standard depth via ResearchSearchEngine', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = requestUrl(input);
      if (url.includes('duckduckgo.com/html')) {
        return new Response(
          buildDdgHtml(
            'Deep crawl doc',
            'https://example.com/deep-crawl',
            'SERP snippet for deep crawl',
          ),
          { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
        );
      }
      return new Response('{}', { status: 404 });
    });
    const urlFetcher: UrlFetcher = {
      fetch: vi.fn(async (url) => ({
        content: `Fetched body for ${url}`,
        kind: 'extracted' as const,
      })),
    };

    const engine = new ResearchSearchEngine({
      fetchImpl,
      urlFetcher,
      search: {
        strategy: 'fallback',
        freeFallback: true,
        providers: [],
      },
      local: {
        searchUrl: 'https://duckduckgo.com/html/',
        directSources: { github: false, arxiv: false, npm: false, pypi: false, crates: false },
      },
    });

    const tool = new DeepResearchTool(engine);
    const result = await executeTool(tool, {
      turnId: 't1',
      toolCallId: 'c-deep-content',
      args: { question: 'deep crawl topic', depth: 'standard', max_sources: 3 },
      signal,
    });

    expect(result.isError).toBe(false);
    const content = toolContentString(result);
    expect(content).toContain('excerpt:');
    expect(content).toContain('Fetched body for https://example.com/deep-crawl');
    expect(urlFetcher.fetch).toHaveBeenCalled();
  });

  it('skips page excerpts for quick depth', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = requestUrl(input);
      if (url.includes('duckduckgo.com/html')) {
        return new Response(
          buildDdgHtml(
            'Quick SERP doc',
            'https://example.com/quick-only',
            'SERP snippet only',
          ),
          { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
        );
      }
      return new Response('{}', { status: 404 });
    });
    const urlFetcher: UrlFetcher = {
      fetch: vi.fn(async (url) => ({
        content: `Should not fetch ${url}`,
        kind: 'extracted' as const,
      })),
    };

    const engine = new ResearchSearchEngine({
      fetchImpl,
      urlFetcher,
      search: {
        strategy: 'fallback',
        freeFallback: true,
        providers: [],
      },
      local: {
        searchUrl: 'https://duckduckgo.com/html/',
        directSources: { github: false, arxiv: false, npm: false, pypi: false, crates: false },
      },
    });

    const tool = new DeepResearchTool(engine);
    const result = await executeTool(tool, {
      turnId: 't1',
      toolCallId: 'c-deep-quick',
      args: { question: 'quick depth topic', depth: 'quick', max_sources: 2 },
      signal,
    });

    expect(result.isError).toBe(false);
    const content = toolContentString(result);
    expect(content).not.toContain('excerpt:');
    expect(content).not.toContain('Should not fetch');
    expect(urlFetcher.fetch).not.toHaveBeenCalled();
  });

  it('soft-degrades without throwing when all channels return empty (freeFallback off)', async () => {
    process.env['SUPERLIORA_ALLOW_DISABLE_FREE_FALLBACK'] = '1';
    try {
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

    const tool = new DeepResearchTool(engine);
    const result = await executeTool(tool, {
      turnId: 't1',
      toolCallId: 'c-deep-empty',
      args: { question: 'empty cascade deep research' },
      signal,
    });

    expect(result.isError).toBe(false);
    const content = toolContentString(result);
    expect(content).toContain('degraded: true');
    expect(content).toContain('offline_stub:');
    expect(content).toContain('next:');
    expect(content).toContain('Ch4');
    expect(content).toContain('Ch5');
    expect(content).toContain('No live sources returned');
    expect(content).toMatch(/channels_used: /);
    expect(content).not.toMatch(/channels_used: empty cascade/);
    expect(browserSearch).not.toHaveBeenCalled();
    expect(chromeSearch).not.toHaveBeenCalled();
    } finally {
      delete process.env['SUPERLIORA_ALLOW_DISABLE_FREE_FALLBACK'];
    }
  });

  it('escalates to browser when allow_browser is true', async () => {
    process.env['SUPERLIORA_ALLOW_DISABLE_FREE_FALLBACK'] = '1';
    try {
      const browserSearch = vi
        .fn<() => Promise<Array<{ title: string; url: string; snippet: string }>>>()
        .mockResolvedValue([
          {
            title: 'Browser hit',
            url: 'https://example.com/browser-hit',
            snippet: 'from Ch4',
          },
        ]);
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ web: { results: [] } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

      const engine = new ResearchSearchEngine({
        fetchImpl,
        browserChannel: { available: () => true, search: browserSearch },
        search: {
          strategy: 'fallback',
          freeFallback: false,
          providers: [{ kind: 'brave', apiKey: 'brave-test-key' }],
        },
      });

      const tool = new DeepResearchTool(engine);
      const result = await executeTool(tool, {
        turnId: 't1',
        toolCallId: 'c-deep-browser',
        args: {
          question: 'need browser escalate',
          depth: 'quick',
          allow_browser: true,
          max_sources: 3,
        },
        signal,
      });

      expect(result.isError).toBe(false);
      expect(browserSearch).toHaveBeenCalled();
      const content = toolContentString(result);
      expect(content).toContain('Browser hit');
      expect(content).toContain('allow_browser: true');
    } finally {
      delete process.env['SUPERLIORA_ALLOW_DISABLE_FREE_FALLBACK'];
    }
  });

  it('auto-escalates browser on exhaustive depth when allow_browser omitted', async () => {
    process.env['SUPERLIORA_ALLOW_DISABLE_FREE_FALLBACK'] = '1';
    try {
      const browserSearch = vi
        .fn<() => Promise<Array<{ title: string; url: string; snippet: string }>>>()
        .mockResolvedValue([
          {
            title: 'Exhaustive browser hit',
            url: 'https://example.com/exhaustive',
            snippet: 'from Ch4 exhaustive',
          },
        ]);
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ web: { results: [] } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

      const engine = new ResearchSearchEngine({
        fetchImpl,
        browserChannel: { available: () => true, search: browserSearch },
        search: {
          strategy: 'fallback',
          freeFallback: false,
          providers: [{ kind: 'brave', apiKey: 'brave-test-key' }],
        },
      });

      const tool = new DeepResearchTool(engine);
      const result = await executeTool(tool, {
        turnId: 't1',
        toolCallId: 'c-deep-exhaustive',
        args: {
          question: 'exhaustive depth escalate',
          depth: 'exhaustive',
          max_sources: 3,
        },
        signal,
      });

      expect(result.isError).toBe(false);
      expect(browserSearch).toHaveBeenCalled();
      const content = toolContentString(result);
      expect(content).toContain('Exhaustive browser hit');
      expect(content).toContain('allow_browser: true');
    } finally {
      delete process.env['SUPERLIORA_ALLOW_DISABLE_FREE_FALLBACK'];
    }
  });

  it('soft-degrades when sub-queries reject without killing the turn', async () => {
    const throwingProvider: WebSearchProvider = {
      search: vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
      status: () => ({
        strategy: 'fallback',
        freeFallback: false,
        browser: { configured: false, ready: false },
        chromeExtension: { configured: false, enabled: false, ready: false },
        providers: [],
      }),
    };

    const tool = new DeepResearchTool(throwingProvider);
    const result = await executeTool(tool, {
      turnId: 't1',
      toolCallId: 'c-deep-throw',
      args: { question: 'network failure topic', depth: 'standard' },
      signal,
    });

    expect(result.isError).toBe(false);
    const content = toolContentString(result);
    expect(content).toContain('offline_stub:');
    expect(content).toContain('degraded: true');
    expect(content).toContain('next:');
    expect(content).toContain('Ch4');
    expect(content).toContain('Ch5');
    expect(content).toContain('do_not: halt');
  });

  it('records never-empty soft-degrade telemetry on empty cascade', async () => {
    resetSearchNeverEmptyTelemetry();
    process.env['SUPERLIORA_ALLOW_DISABLE_FREE_FALLBACK'] = '1';
    try {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ web: { results: [] } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

      const engine = new ResearchSearchEngine({
        fetchImpl,
        search: {
          strategy: 'fallback',
          freeFallback: false,
          providers: [{ kind: 'brave', apiKey: 'brave-test-key' }],
        },
      });

      const tool = new DeepResearchTool(engine);
      const result = await executeTool(tool, {
        turnId: 't1',
        toolCallId: 'c-deep-telemetry',
        args: { question: 'telemetry empty cascade' },
        signal,
      });

      expect(result.isError).toBe(false);
      expect(getSearchNeverEmptyTelemetry()).toEqual({
        hardFailCount: 0,
        softDegradeCount: 1,
      });
    } finally {
      delete process.env['SUPERLIORA_ALLOW_DISABLE_FREE_FALLBACK'];
    }
  });
});
