/**
 * Covers: local web search intent classification and result ranking helpers.
 */

import { describe, expect, it } from 'vitest';

import {
  classifySearchIntent,
  hasAnyDirectSource,
  selectDirectSourcesForIntent,
  shapeQueryForIntent,
} from '../../src/tools/providers/local-web-search-intent';
import { rankAndDedupeResults } from '../../src/tools/providers/local-web-search-ranking';

describe('local web search intent', () => {
  it('classifies npm package queries', () => {
    expect(classifySearchIntent('zod typescript npm schema')).toEqual({
      kind: 'package',
      packageEcosystem: 'npm',
    });
  });

  it('classifies general queries without direct-source fan-out', () => {
    expect(classifySearchIntent('what is the capital of france')).toEqual({ kind: 'general' });
    expect(
      selectDirectSourcesForIntent(
        { github: true, npm: true, arxiv: true, pypi: true, crates: true },
        { kind: 'general' },
      ),
    ).toEqual({
      github: false,
      npm: false,
      pypi: false,
      crates: false,
      arxiv: false,
    });
  });

  it('shapes tech queries toward docs and github', () => {
    expect(shapeQueryForIntent('kimi code latest', { kind: 'tech' })).toBe(
      'kimi code latest docs OR github',
    );
  });

  it('detects when any direct source remains enabled', () => {
    expect(hasAnyDirectSource({ github: false, npm: false, pypi: false, crates: false, arxiv: false }))
      .toBe(false);
    expect(hasAnyDirectSource({ github: true, npm: false, pypi: false, crates: false, arxiv: false }))
      .toBe(true);
  });
});

describe('local web search ranking', () => {
  it('prefers github/npm hits over generic blogs for package queries', () => {
    const ranked = rankAndDedupeResults(
      [
        {
          title: 'SEO Blog',
          url: 'https://example.com/blog',
          snippet: 'generic blog post',
        },
        {
          title: 'zod',
          url: 'https://www.npmjs.com/package/zod',
          snippet: '[npm] TypeScript-first schema validation',
        },
        {
          title: 'colinhacks/zod',
          url: 'https://github.com/colinhacks/zod',
          snippet: '[github] TypeScript-first schema declaration',
        },
      ],
      'zod typescript npm schema',
    );

    expect(ranked.map((result) => result.url)).toEqual([
      'https://www.npmjs.com/package/zod',
      'https://github.com/colinhacks/zod',
      'https://example.com/blog',
    ]);
  });

  it('dedupes canonicalized URLs and keeps the higher-scoring entry', () => {
    const ranked = rankAndDedupeResults(
      [
        {
          title: 'Example Docs',
          url: 'https://example.com/docs?utm_source=newsletter',
          snippet: 'official docs',
        },
        {
          title: 'Example Docs Mirror',
          url: 'https://example.com/docs?ref=twitter',
          snippet: 'official docs mirror',
        },
      ],
      'example docs',
    );

    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.url.startsWith('https://example.com/docs')).toBe(true);
  });
});
