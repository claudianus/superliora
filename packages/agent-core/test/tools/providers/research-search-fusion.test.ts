import { describe, expect, it } from 'vitest';

import {
  canonicalizeSearchUrl,
  fuseSearchResults,
} from '../../../src/tools/providers/research-search-fusion';

describe('canonicalizeSearchUrl', () => {
  it('removes fragments, default ports, trailing slashes, and tracking params', () => {
    expect(
      canonicalizeSearchUrl(
        'https://Example.COM:443/path/?utm_source=newsletter&fbclid=abc&page=2&lang=ko#section',
      ),
    ).toBe('https://example.com/path?lang=ko&page=2');
    expect(canonicalizeSearchUrl('http://example.com:80/?gclid=abc')).toBe('http://example.com');
  });

  it('preserves meaningful query parameters', () => {
    expect(canonicalizeSearchUrl('https://example.com/search/?q=web+search&sort=date')).toBe(
      'https://example.com/search?q=web+search&sort=date',
    );
  });
});

describe('fuseSearchResults', () => {
  it('dedupes identical canonical URLs and ranks provider consensus with RRF', () => {
    const fusion = fuseSearchResults(
      [
        {
          providerId: 'brave:0',
          results: [
            {
              title: 'Shared result',
              url: 'https://example.com/guide/?utm_medium=email',
              snippet: 'adaptive fusion',
            },
            {
              title: 'Brave only',
              url: 'https://brave.example/only',
              snippet: 'adaptive',
            },
          ],
        },
        {
          providerId: 'tavily:1',
          results: [
            {
              title: 'Shared consensus',
              url: 'https://example.com/guide#details',
              snippet: 'adaptive fusion consensus from a second provider',
            },
            {
              title: 'Tavily only',
              url: 'https://tavily.example/only',
              snippet: 'fusion',
            },
          ],
        },
      ],
      'adaptive fusion',
      3,
    );

    expect(fusion.metrics.uniqueUrlCount).toBe(3);
    expect(fusion.results[0]).toMatchObject({
      url: 'https://example.com/guide',
      snippet: 'adaptive fusion consensus from a second provider',
    });
    expect(fusion.results.filter((result) => result.url === 'https://example.com/guide')).toHaveLength(1);
  });

  it('keeps query relevance as a deterministic RRF tie-breaker', () => {
    const fusion = fuseSearchResults(
      [
        {
          providerId: 'first',
          results: [
            { title: 'Unrelated', url: 'https://first.example/a', snippet: 'other text' },
          ],
        },
        {
          providerId: 'second',
          results: [
            { title: 'Adaptive fusion', url: 'https://second.example/a', snippet: 'matched text' },
          ],
        },
      ],
      'adaptive fusion',
      2,
    );

    expect(fusion.results[0]?.url).toBe('https://second.example/a');
  });

  it('limits same-domain dominance and deterministically refills when needed', () => {
    const fusion = fuseSearchResults(
      [
        {
          providerId: 'provider',
          results: [
            { title: 'Topic A', url: 'https://same.example/a', snippet: 'topic' },
            { title: 'Topic B', url: 'https://same.example/b', snippet: 'topic' },
            { title: 'Topic C', url: 'https://same.example/c', snippet: 'topic' },
            { title: 'Topic D', url: 'https://same.example/d', snippet: 'topic' },
            { title: 'Topic E', url: 'https://other.example/e', snippet: 'topic' },
          ],
        },
      ],
      'topic',
      4,
    );

    expect(fusion.results.map((result) => result.url)).toEqual([
      'https://same.example/a',
      'https://same.example/b',
      'https://other.example/e',
      'https://same.example/c',
    ]);
  });

  it('returns the same ordering for the same fixture 100 times', () => {
    const batches = [
      {
        providerId: 'first',
        results: [
          { title: 'Topic Z', url: 'https://z.example/1', snippet: 'topic' },
          { title: 'Topic shared', url: 'https://shared.example/a?utm_campaign=x', snippet: 'topic' },
          { title: 'Topic B', url: 'https://b.example/3', snippet: 'topic' },
        ],
      },
      {
        providerId: 'second',
        results: [
          { title: 'Topic A', url: 'https://a.example/1', snippet: 'topic' },
          { title: 'Topic shared', url: 'https://shared.example/a#fragment', snippet: 'topic' },
          { title: 'Topic C', url: 'https://c.example/3', snippet: 'topic' },
        ],
      },
    ] as const;
    const expected = fuseSearchResults(batches, 'topic', 5).results.map((result) => result.url);

    for (let iteration = 0; iteration < 100; iteration += 1) {
      expect(fuseSearchResults(batches, 'topic', 5).results.map((result) => result.url)).toEqual(
        expected,
      );
    }
  });
});
