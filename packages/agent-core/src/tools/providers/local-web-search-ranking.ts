import type { WebSearchResult } from '../builtin/web/web-search';

import { canonicalUrl, hasUsableUrl } from './local-web-search-shared';

export function rankAndDedupeResults(
  results: readonly WebSearchResult[],
  query: string,
): WebSearchResult[] {
  const seen = new Map<string, { readonly result: WebSearchResult; readonly score: number }>();
  for (const result of results) {
    if (!hasUsableUrl(result)) continue;
    const key = canonicalUrl(result.url);
    const score = scoreResult(result, query);
    const existing = seen.get(key);
    if (existing === undefined || score > existing.score) {
      seen.set(key, { result, score });
    }
  }
  return [...seen.values()]
    .toSorted((a, b) => b.score - a.score || a.result.title.localeCompare(b.result.title))
    .map((entry) => entry.result);
}

function scoreResult(result: WebSearchResult, query: string): number {
  const terms = query.toLowerCase().split(/\W+/).filter((term) => term.length > 2);
  const title = result.title.toLowerCase();
  const snippet = result.snippet.toLowerCase();
  const titleHits = terms.filter((term) => title.includes(term)).length;
  const snippetHits = terms.filter((term) => snippet.includes(term)).length;
  let hostBoost = 0;
  try {
    const host = new URL(result.url).hostname.replace(/^www\./, '');
    if (
      host === 'github.com' ||
      host === 'gitlab.com' ||
      host.endsWith('.github.io') ||
      host === 'arxiv.org' ||
      host === 'npmjs.com' ||
      host === 'pypi.org' ||
      host === 'crates.io' ||
      host === 'docs.rs' ||
      host.startsWith('docs.') ||
      host.includes('readthedocs') ||
      host === 'developer.mozilla.org' ||
      host === 'stackoverflow.com'
    ) {
      hostBoost = 6;
    } else if (
      host.includes('pinterest.') ||
      host.includes('quora.com') ||
      host.includes('facebook.com') ||
      host.includes('instagram.com') ||
      host.includes('tiktok.com')
    ) {
      hostBoost = -3;
    }
  } catch {
    hostBoost = 0;
  }
  const sourceBoost =
    /\[(github|npm|crates\.io|arxiv|pypi|searxng|yacy|duckduckgo|brave|tavily|exa|serper)\]/i.test(
      result.snippet,
    )
      ? 1
      : 0;
  const contentBoost = result.content !== undefined && result.content.length > 200 ? 2 : 0;
  const recencyBoost = result.date !== undefined && result.date.length > 0 ? 1 : 0;
  return hostBoost + sourceBoost + contentBoost + recencyBoost + titleHits * 3 + snippetHits;
}
