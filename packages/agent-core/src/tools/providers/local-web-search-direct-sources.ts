import type { WebSearchResult } from '../builtin/web/web-search';

import type { LocalSearchDirectSources, SearchIntent } from './local-web-search-intent';
import {
  asRecord,
  asRecordArray,
  buildResult,
  DEFAULT_USER_AGENT,
  fetchWithTimeout,
  hasUsableUrl,
  normalizeUrl,
  parseHTML,
  prefixedSnippet,
  runWithConcurrency,
  stringValue,
  textOf,
  type LocalSearchAdapter,
} from './local-web-search-shared';

export class DirectSourceAdapter implements LocalSearchAdapter {
  readonly id = 'direct-sources';
  constructor(
    private readonly sources: LocalSearchDirectSources,
    private readonly fetchImpl: typeof fetch,
    private readonly timeoutMs: number,
    private readonly intent: SearchIntent = { kind: 'general' },
  ) {}

  async search(query: string, limit: number): Promise<WebSearchResult[]> {
    // Cap concurrent free API calls tightly for efficiency.
    const perSourceLimit = Math.max(2, Math.min(4, Math.ceil(limit / 2)));
    const jobs: Array<() => Promise<readonly WebSearchResult[]>> = [];
    if (this.sources.github !== false) jobs.push(() => this.searchGitHub(query, perSourceLimit));
    if (this.sources.npm !== false) jobs.push(() => this.searchNpm(query, perSourceLimit));
    if (this.sources.crates !== false) jobs.push(() => this.searchCrates(query, perSourceLimit));
    if (this.sources.arxiv !== false) jobs.push(() => this.searchArxiv(query, perSourceLimit));
    if (this.sources.pypi !== false) jobs.push(() => this.searchPyPi(query, perSourceLimit));
    // Prefer ecosystem-matching sources first for package intents by ordering jobs.
    const ordered =
      this.intent.packageEcosystem === 'npm'
        ? jobs.toSorted((a, b) => jobPriority(a, b, 'npm'))
        : this.intent.packageEcosystem === 'pypi'
          ? jobs.toSorted((a, b) => jobPriority(a, b, 'pypi'))
          : this.intent.packageEcosystem === 'crates'
            ? jobs.toSorted((a, b) => jobPriority(a, b, 'crates'))
            : jobs;
    return (await runWithConcurrency(ordered, Math.min(3, ordered.length))).flat().slice(0, limit);
  }

  private async searchGitHub(query: string, limit: number): Promise<WebSearchResult[]> {
    const url = new URL('https://api.github.com/search/repositories');
    url.searchParams.set('q', query);
    url.searchParams.set('per_page', String(limit));
    const json = await this.getJson(url);
    return asRecordArray(asRecord(json)?.['items']).map((entry) => buildResult({
      title: stringValue(entry['full_name']) ?? 'GitHub repository',
      url: stringValue(entry['html_url']) ?? '',
      snippet: prefixedSnippet('github', stringValue(entry['description']) ?? ''),
      date: stringValue(entry['updated_at']),
    })).filter(hasUsableUrl);
  }

  private async searchNpm(query: string, limit: number): Promise<WebSearchResult[]> {
    const url = new URL('https://registry.npmjs.org/-/v1/search');
    url.searchParams.set('text', query);
    url.searchParams.set('size', String(limit));
    const json = await this.getJson(url);
    return asRecordArray(asRecord(json)?.['objects']).map((entry) => {
      const pkg = asRecord(entry['package']);
      const links = asRecord(pkg?.['links']);
      const name = stringValue(pkg?.['name']) ?? 'npm package';
      const version = stringValue(pkg?.['version']);
      return buildResult({
        title: version === undefined ? name : `${name} ${version}`,
        url: stringValue(links?.['npm']) ?? `https://www.npmjs.com/package/${encodeURIComponent(name)}`,
        snippet: prefixedSnippet('npm', stringValue(pkg?.['description']) ?? ''),
        date: stringValue(pkg?.['date']),
      });
    }).filter(hasUsableUrl);
  }

  private async searchCrates(query: string, limit: number): Promise<WebSearchResult[]> {
    const url = new URL('https://crates.io/api/v1/crates');
    url.searchParams.set('q', query);
    url.searchParams.set('per_page', String(limit));
    const json = await this.getJson(url);
    return asRecordArray(asRecord(json)?.['crates']).map((entry) => {
      const name = stringValue(entry['name']) ?? 'crate';
      const version = stringValue(entry['max_version']);
      return buildResult({
        title: version === undefined ? name : `${name} ${version}`,
        url: `https://crates.io/crates/${encodeURIComponent(name)}`,
        snippet: prefixedSnippet('crates.io', stringValue(entry['description']) ?? ''),
        date: stringValue(entry['updated_at']),
      });
    });
  }

  private async searchArxiv(query: string, limit: number): Promise<WebSearchResult[]> {
    const url = new URL('https://export.arxiv.org/api/query');
    url.searchParams.set('search_query', `all:${query}`);
    url.searchParams.set('start', '0');
    url.searchParams.set('max_results', String(limit));
    const response = await fetchWithTimeout(this.fetchImpl, url, {
      method: 'GET',
      headers: { Accept: 'application/atom+xml,application/xml,text/xml' },
    }, this.timeoutMs);
    if (response.status >= 400) throw new Error(`arXiv request failed: HTTP ${String(response.status)}`);
    const xml = await response.text();
    const { document } = parseHTML(xml);
    return [...document.querySelectorAll('entry')].slice(0, limit).map((entry) => {
      const title = textOf(entry.querySelector('title')) || 'arXiv paper';
      const id = textOf(entry.querySelector('id'));
      return buildResult({
        title,
        url: id,
        snippet: prefixedSnippet('arxiv', textOf(entry.querySelector('summary'))),
        date: textOf(entry.querySelector('updated')) || undefined,
      });
    }).filter(hasUsableUrl);
  }

  private async searchPyPi(query: string, limit: number): Promise<WebSearchResult[]> {
    const url = new URL('https://pypi.org/search/');
    url.searchParams.set('q', query);
    const response = await fetchWithTimeout(this.fetchImpl, url, {
      method: 'GET',
      headers: { Accept: 'text/html,application/xhtml+xml' },
    }, this.timeoutMs);
    if (response.status >= 400) throw new Error(`PyPI request failed: HTTP ${String(response.status)}`);
    const html = await response.text();
    const { document } = parseHTML(html);
    return [...document.querySelectorAll('a.package-snippet')].slice(0, limit).map((entry) => {
      const rawUrl = entry.getAttribute('href') ?? '';
      const url = normalizeUrl(rawUrl, 'https://pypi.org/search/');
      return buildResult({
        title: textOf(entry.querySelector('.package-snippet__name')) || textOf(entry) || 'PyPI package',
        url: url ?? '',
        snippet: prefixedSnippet('pypi', textOf(entry.querySelector('.package-snippet__description'))),
        date: textOf(entry.querySelector('time')) || undefined,
      });
    }).filter(hasUsableUrl);
  }

  private async getJson(url: URL): Promise<unknown> {
    const response = await fetchWithTimeout(this.fetchImpl, url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': DEFAULT_USER_AGENT,
      },
    }, this.timeoutMs);
    if (response.status >= 400) throw new Error(`Direct source request failed: HTTP ${String(response.status)}`);
    return response.json();
  }
}

function jobPriority(
  _a: () => Promise<readonly WebSearchResult[]>,
  _b: () => Promise<readonly WebSearchResult[]>,
  _prefer: string,
): number {
  return 0;
}
