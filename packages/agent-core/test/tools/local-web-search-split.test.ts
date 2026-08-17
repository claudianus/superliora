/**
 * Covers: local web search intent classification and result ranking helpers.
 */

import { describe, expect, it } from 'vitest';

import {
  classifySearchIntent,
  formatSearchRouteLine,
  hasAnyDirectSource,
  parseSearchIntentJudgment,
  searchIntentFromJudgment,
  selectDirectSourcesForIntent,
  shapeQueryForIntent,
} from '../../src/tools/providers/local-web-search-intent';
import { rankAndDedupeResults } from '../../src/tools/providers/local-web-search-ranking';

describe('local web search intent', () => {
  it('does not classify from query keywords', () => {
    expect(classifySearchIntent('zod typescript npm schema')).toEqual({ kind: 'general' });
    expect(classifySearchIntent('what is the capital of france')).toEqual({ kind: 'general' });
  });

  it('keeps configured sources when intent is general (no keyword disable)', () => {
    expect(
      selectDirectSourcesForIntent(
        { github: true, npm: true, arxiv: true, pypi: true, crates: true },
        { kind: 'general' },
      ),
    ).toEqual({ github: true, npm: true, arxiv: true, pypi: true, crates: true });
  });

  it('does not rewrite the query from an intent cookbook', () => {
    expect(shapeQueryForIntent('kimi code latest', { kind: 'tech' })).toBe('kimi code latest');
  });

  it('maps a confident package judgment onto npm sources', () => {
    expect(
      searchIntentFromJudgment({ artifact: 'package', ecosystem: 'npm', confidence: 0.9 }),
    ).toEqual({ kind: 'package', packageEcosystem: 'npm' });
    expect(
      parseSearchIntentJudgment(
        '{"artifact":"package","ecosystem":"npm","confidence":0.88,"rationale":"install a library"}',
      ),
    ).toEqual({ kind: 'package', packageEcosystem: 'npm' });
    expect(
      selectDirectSourcesForIntent(
        { github: true, npm: true, arxiv: true, pypi: true, crates: true },
        { kind: 'package', packageEcosystem: 'npm' },
      ),
    ).toEqual({
      github: true,
      npm: true,
      pypi: false,
      crates: false,
      arxiv: false,
    });
  });

  it('formats a ready-to-render route line from intent and sources', () => {
    expect(
      formatSearchRouteLine(
        { kind: 'package', packageEcosystem: 'npm' },
        { github: true, npm: true, pypi: false, crates: false, arxiv: false },
      ),
    ).toBe('package/npm · sources github, npm');
    expect(
      formatSearchRouteLine({ kind: 'general' }, { github: true, npm: true, pypi: true, crates: true, arxiv: true }),
    ).toBe('general · sources github, npm, pypi, crates, arxiv');
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
