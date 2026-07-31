/**
 * Covers: DeepResearch query planning and source merge helpers.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  buildDeepResearchOutput,
  DeepResearchTool,
  depthSearchLimit,
  extractKeyTerms,
  mergeResearchSources,
  normalizeResearchUrl,
  planDeepResearchQueries,
} from '../../../src/tools/builtin/web/deep-research';
import { ResearchSearchEngine } from '../../../src/tools/providers/research-search';
import { executeTool } from '../fixtures/execute-tool';
import { toolContentString } from '../fixtures/fake-kaos';

describe('depthSearchLimit', () => {
  it('maps depth presets to per-query limits', () => {
    expect(depthSearchLimit('quick')).toBe(3);
    expect(depthSearchLimit('standard')).toBe(5);
    expect(depthSearchLimit('exhaustive')).toBe(8);
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

describe('buildDeepResearchOutput', () => {
  it('emits structured sections and degraded hints when empty', () => {
    const output = buildDeepResearchOutput({
      question: 'Rust async',
      queries: ['Rust async', 'Rust async overview'],
      sources: [],
      degraded: true,
      hops: 2,
      channelsTried: ['ch3'],
    });

    expect(output).toContain('answer_outline:');
    expect(output).toContain('claims:');
    expect(output).toContain('sources:');
    expect(output).toContain('channels_used: Rust async | Rust async overview');
    expect(output).toContain('hops: 2');
    expect(output).toContain('channelsTried: ch3');
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
    expect(output).toContain('degraded: false');
  });
});

describe('DeepResearchTool', () => {
  const signal = new AbortController().signal;

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
    expect(content).toContain('next:');
    expect(content).toContain('Ch4');
    expect(content).toContain('Ch5');
    expect(content).toContain('No live sources returned');
    } finally {
      delete process.env['SUPERLIORA_ALLOW_DISABLE_FREE_FALLBACK'];
    }
  });
});
