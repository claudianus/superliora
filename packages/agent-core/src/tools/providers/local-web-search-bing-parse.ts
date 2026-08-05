import type { WebSearchResult } from '../builtin/web/web-search';

import {
  buildResult,
  canonicalUrl,
  normalizeUrl,
  parseHTML,
  textOf,
} from './local-web-search-shared';

export const BING_SEARCH_URL = 'https://www.bing.com/search';

/**
 * Parse the static `bing.com/search` HTML (no key, no JS). Organic results
 * are `<li class="b_algo">` blocks with `h2 > a` title/link and an optional
 * `.b_caption p` snippet. Ads (`b_ad`) and answer boxes are skipped.
 */
export function parseBingResults(html: string, limit: number): WebSearchResult[] {
  const { document } = parseHTML(html);
  const nodes = [...document.querySelectorAll('li.b_algo')];
  const results: WebSearchResult[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    const link = node.querySelector('h2 a[href]') ?? node.querySelector('a[href]');
    const rawUrl = link?.getAttribute('href') ?? '';
    const url = normalizeUrl(rawUrl, BING_SEARCH_URL);
    if (url === undefined) continue;
    if (url.includes('bing.com') || url.includes('microsoft.com/ck/a')) continue;
    const title = textOf(link);
    if (title.length < 2) continue;
    const key = canonicalUrl(url);
    if (seen.has(key)) continue;
    seen.add(key);
    const snippet =
      textOf(node.querySelector('.b_caption p')) ||
      textOf(node.querySelector('p')) ||
      title;
    results.push(buildResult({ title, url, snippet }));
    if (results.length >= limit) break;
  }
  return results;
}
