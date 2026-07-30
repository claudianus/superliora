import type { WebSearchResult } from '../builtin/web/web-search';

import {
  buildResult,
  canonicalUrl,
  DDG_LITE_SEARCH_URL,
  normalizeResultUrl,
  normalizeText,
  normalizeUrl,
  parseHTML,
  textOf,
} from './local-web-search-shared';

export function parseDuckDuckGoLiteResults(html: string, limit: number): WebSearchResult[] {
  const { document } = parseHTML(html);
  const anchors = [...document.querySelectorAll('a[href]')];
  const results: WebSearchResult[] = [];
  const seen = new Set<string>();
  for (const anchor of anchors) {
    const rawUrl = anchor.getAttribute('href') ?? '';
    const url = normalizeUrl(rawUrl, DDG_LITE_SEARCH_URL);
    if (url === undefined) continue;
    if (url.includes('duckduckgo.com')) continue;
    const title = textOf(anchor);
    if (title.length < 2) continue;
    const key = canonicalUrl(url);
    if (seen.has(key)) continue;
    seen.add(key);
    const parentSnippet = normalizeText(anchor.parentNode?.textContent ?? '');
    const snippet =
      parentSnippet.length > title.length ? parentSnippet.replace(title, '').trim() : '';
    results.push(
      buildResult({
        title,
        url,
        snippet: snippet.length > 0 ? snippet : title,
      }),
    );
    if (results.length >= limit) break;
  }
  return results;
}

export function parseDuckDuckGoResults(html: string, limit: number): WebSearchResult[] {
  const { document } = parseHTML(html);
  const nodes = [...document.querySelectorAll('.result')];
  const results: WebSearchResult[] = [];
  for (const node of nodes) {
    const link = node.querySelector('a.result__a') ?? node.querySelector('a[href]');
    const rawUrl = link?.getAttribute('href') ?? '';
    const url = normalizeResultUrl(rawUrl);
    if (url === undefined) continue;
    const title = textOf(link);
    if (title.length === 0) continue;
    const snippet =
      textOf(node.querySelector('.result__snippet')) ||
      textOf(node.querySelector('.result__body')) ||
      textOf(node);
    results.push(buildResult({
      title,
      url,
      snippet,
    }));
    if (results.length >= limit) break;
  }
  return results;
}
