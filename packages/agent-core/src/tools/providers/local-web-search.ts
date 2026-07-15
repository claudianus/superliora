import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname } from 'pathe';
import { parseHTML as rawParseHTML } from 'linkedom';

import type { UrlFetcher } from '../builtin/web/fetch-url';
import type { WebSearchProvider, WebSearchResult } from '../builtin/web/web-search';

interface DomElementLike {
  textContent: string | null;
  getAttribute(name: string): string | null;
  querySelector(selector: string): DomElementLike | null;
  querySelectorAll(selector: string): DomElementLike[];
}

interface DomParseResult {
  document: DomElementLike;
}

interface SqliteRunResult {
  readonly changes: number;
  readonly lastInsertRowid: number | bigint;
}

interface SqliteStatement {
  run(...params: unknown[]): SqliteRunResult;
  get(...params: unknown[]): unknown;
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

interface SqliteModule {
  readonly DatabaseSync: new (path: string) => SqliteDatabase;
}

interface SearchCacheRow {
  readonly results_json: string;
  readonly created_at: number;
  readonly ttl_ms: number;
}

class SearchResponseTooLargeError extends Error {
  override readonly name = 'SearchResponseTooLargeError';
}

const parseHTML = rawParseHTML as unknown as (html: string) => DomParseResult;

const DEFAULT_SEARCH_URL = 'https://duckduckgo.com/html/';
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_WEB_CACHE_TTL_MS = 7 * 86_400_000;
const MAX_ADAPTER_RESULTS = 12;
const CONTENT_FETCH_LIMIT = 4;

export interface LocalSearchDirectSources {
  readonly github?: boolean;
  readonly arxiv?: boolean;
  readonly npm?: boolean;
  readonly pypi?: boolean;
  readonly crates?: boolean;
}

export interface LocalWebSearchProviderOptions {
  searchUrl?: string;
  userAgent?: string;
  fetchImpl?: typeof fetch;
  maxBytes?: number;
  urlFetcher?: UrlFetcher;
  concurrency?: number;
  timeoutMs?: number;
  searxngUrl?: string;
  yacyUrl?: string;
  directSources?: LocalSearchDirectSources;
  offlineMode?: 'auto' | 'always' | 'never';
  cachePath?: string;
  cacheTtlMs?: number;
}

interface LocalSearchAdapter {
  readonly id: string;
  search(query: string, limit: number): Promise<readonly WebSearchResult[]>;
}

export class LocalWebSearchProvider implements WebSearchProvider {
  private readonly searchUrl: string;
  private readonly userAgent: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxBytes: number;
  private readonly urlFetcher: UrlFetcher | undefined;
  private readonly concurrency: number;
  private readonly timeoutMs: number;
  private readonly searxngUrl: string | undefined;
  private readonly yacyUrl: string | undefined;
  private readonly directSources: LocalSearchDirectSources;
  private readonly offlineMode: 'auto' | 'always' | 'never';
  private readonly cache: LocalResearchCache | undefined;
  private readonly cacheTtlMs: number;

  constructor(options: LocalWebSearchProviderOptions = {}) {
    this.searchUrl = options.searchUrl ?? DEFAULT_SEARCH_URL;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.urlFetcher = options.urlFetcher;
    this.concurrency = clampInt(options.concurrency ?? DEFAULT_CONCURRENCY, 1, 16);
    this.timeoutMs = clampInt(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1_000, 120_000);
    this.searxngUrl = normalizeOptionalUrl(options.searxngUrl);
    this.yacyUrl = normalizeOptionalUrl(options.yacyUrl);
    this.directSources = {
      github: options.directSources?.github ?? true,
      arxiv: options.directSources?.arxiv ?? true,
      npm: options.directSources?.npm ?? true,
      pypi: options.directSources?.pypi ?? true,
      crates: options.directSources?.crates ?? true,
    };
    this.offlineMode = options.offlineMode ?? 'auto';
    this.cache = options.cachePath === undefined ? undefined : new LocalResearchCache(options.cachePath);
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_WEB_CACHE_TTL_MS;
  }

  async search(
    query: string,
    options?: { limit?: number; includeContent?: boolean; toolCallId?: string },
  ): Promise<WebSearchResult[]> {
    const trimmed = query.trim();
    if (trimmed.length === 0) return [];

    const limit = clampInt(options?.limit ?? 5, 1, 20);
    const includeContent = options?.includeContent === true;
    const cacheKey = this.cacheKey(trimmed, limit, includeContent);
    const now = Date.now();

    if (this.offlineMode === 'always') {
      return this.cache?.get(cacheKey, now, { allowStale: true, mark: 'offline cache' }) ?? [];
    }

    const cached = this.cache?.get(cacheKey, now, { allowStale: false });
    if (cached !== undefined) return cached.slice(0, limit);

    const primaryResults = await this.searchAdapters(this.createPrimaryAdapters(), trimmed, limit);
    const fallbackResults =
      primaryResults.length > 0
        ? []
        : await this.searchAdapters(this.createFallbackAdapters(), trimmed, limit);
    const adapterResults = [...primaryResults, ...fallbackResults];
    let results = rankAndDedupeResults(adapterResults, trimmed).slice(0, limit);
    if (results.length === 0) {
      return this.cache?.get(cacheKey, now, { allowStale: true, mark: 'stale local cache' }) ?? [];
    }

    if (includeContent && this.urlFetcher !== undefined) {
      results = await this.withFetchedContent(results, limit);
    }

    this.cache?.set(cacheKey, trimmed, results, this.cacheTtlMs, now);
    return results;
  }

  private async searchAdapters(
    adapters: readonly LocalSearchAdapter[],
    query: string,
    limit: number,
  ): Promise<readonly WebSearchResult[]> {
    const jobs = adapters.map((adapter) => async () => {
      try {
        return await adapter.search(query, Math.max(limit * 2, MAX_ADAPTER_RESULTS));
      } catch (error) {
        if (isFatalSearchError(error)) throw error;
        return [];
      }
    });
    return (await runWithConcurrency(jobs, this.concurrency)).flat();
  }

  private createPrimaryAdapters(): readonly LocalSearchAdapter[] {
    const adapters: LocalSearchAdapter[] = [
      new DuckDuckGoHtmlAdapter({
        searchUrl: this.searchUrl,
        userAgent: this.userAgent,
        fetchImpl: this.fetchImpl,
        maxBytes: this.maxBytes,
        timeoutMs: this.timeoutMs,
      }),
    ];
    if (this.searxngUrl !== undefined) {
      adapters.push(new SearxngAdapter(this.searxngUrl, this.fetchImpl, this.timeoutMs));
    }
    if (this.yacyUrl !== undefined) {
      adapters.push(new YaCyAdapter(this.yacyUrl, this.fetchImpl, this.timeoutMs));
    }
    return adapters;
  }

  private createFallbackAdapters(): readonly LocalSearchAdapter[] {
    return [new DirectSourceAdapter(this.directSources, this.fetchImpl, this.timeoutMs)];
  }

  private async withFetchedContent(
    results: readonly WebSearchResult[],
    requestedLimit: number,
  ): Promise<WebSearchResult[]> {
    const fetchCount = Math.min(results.length, requestedLimit, CONTENT_FETCH_LIMIT);
    const jobs = results.slice(0, fetchCount).map((result) => async (): Promise<WebSearchResult> => {
      try {
        const fetched = await this.urlFetcher?.fetch(result.url, {});
        if (fetched === undefined || fetched.content.trim().length === 0) return result;
        return buildResult({
          title: result.title,
          url: result.url,
          snippet: result.snippet,
          date: result.date,
          content: fetched.content,
        });
      } catch {
        return result;
      }
    });
    const fetched = await runWithConcurrency(jobs, Math.min(this.concurrency, CONTENT_FETCH_LIMIT));
    return [...fetched, ...results.slice(fetchCount)];
  }

  private cacheKey(query: string, limit: number, includeContent: boolean): string {
    return JSON.stringify({
      query,
      limit,
      includeContent,
      searchUrl: this.searchUrl,
      searxngUrl: this.searxngUrl,
      yacyUrl: this.yacyUrl,
      directSources: this.directSources,
    });
  }
}

class DuckDuckGoHtmlAdapter implements LocalSearchAdapter {
  readonly id = 'duckduckgo-html';
  private readonly searchUrl: string;
  private readonly userAgent: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxBytes: number;
  private readonly timeoutMs: number;

  constructor(options: {
    readonly searchUrl: string;
    readonly userAgent: string;
    readonly fetchImpl: typeof fetch;
    readonly maxBytes: number;
    readonly timeoutMs: number;
  }) {
    this.searchUrl = options.searchUrl;
    this.userAgent = options.userAgent;
    this.fetchImpl = options.fetchImpl;
    this.maxBytes = options.maxBytes;
    this.timeoutMs = options.timeoutMs;
  }

  async search(query: string, limit: number): Promise<WebSearchResult[]> {
    const url = new URL(this.searchUrl);
    url.searchParams.set('q', query);

    const response = await fetchWithTimeout(this.fetchImpl, url, {
      method: 'GET',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': this.userAgent,
      },
    }, this.timeoutMs);
    if (response.status >= 400) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`Local search request failed: HTTP ${String(response.status)} ${response.statusText}`);
    }

    const html = await readBoundedText(response, this.maxBytes);
    return parseDuckDuckGoResults(html, limit);
  }
}

class SearxngAdapter implements LocalSearchAdapter {
  readonly id = 'searxng';
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch,
    private readonly timeoutMs: number,
  ) {}

  async search(query: string, limit: number): Promise<WebSearchResult[]> {
    const url = new URL('/search', ensureTrailingSlash(this.baseUrl));
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    const response = await fetchWithTimeout(this.fetchImpl, url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    }, this.timeoutMs);
    if (response.status >= 400) throw new Error(`SearXNG request failed: HTTP ${String(response.status)}`);
    const json = await response.json() as unknown;
    const results = asRecordArray(asRecord(json)?.['results']);
    return results.slice(0, limit).map((entry) => buildResult({
      title: stringValue(entry['title']) ?? 'SearXNG result',
      url: stringValue(entry['url']) ?? '',
      snippet: prefixedSnippet('searxng', stringValue(entry['content']) ?? ''),
      date: stringValue(entry['publishedDate']) ?? stringValue(entry['published_date']),
    })).filter(hasUsableUrl);
  }
}

class YaCyAdapter implements LocalSearchAdapter {
  readonly id = 'yacy';
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch,
    private readonly timeoutMs: number,
  ) {}

  async search(query: string, limit: number): Promise<WebSearchResult[]> {
    const url = new URL('/yacysearch.json', ensureTrailingSlash(this.baseUrl));
    url.searchParams.set('query', query);
    url.searchParams.set('count', String(limit));
    const response = await fetchWithTimeout(this.fetchImpl, url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    }, this.timeoutMs);
    if (response.status >= 400) throw new Error(`YaCy request failed: HTTP ${String(response.status)}`);
    const json = await response.json() as unknown;
    const root = asRecord(json);
    const channels = asRecordArray(root?.['channels']);
    const firstChannel = channels[0];
    const items = asRecordArray(firstChannel?.['items'] ?? root?.['items']);
    return items.slice(0, limit).map((entry) => buildResult({
      title: stringValue(entry['title']) ?? 'YaCy result',
      url: stringValue(entry['link']) ?? stringValue(entry['url']) ?? '',
      snippet: prefixedSnippet('yacy', stringValue(entry['description']) ?? ''),
      date: stringValue(entry['pubDate']),
    })).filter(hasUsableUrl);
  }
}

class DirectSourceAdapter implements LocalSearchAdapter {
  readonly id = 'direct-sources';
  constructor(
    private readonly sources: LocalSearchDirectSources,
    private readonly fetchImpl: typeof fetch,
    private readonly timeoutMs: number,
  ) {}

  async search(query: string, limit: number): Promise<WebSearchResult[]> {
    const perSourceLimit = Math.max(2, Math.ceil(limit / 3));
    const jobs: Array<() => Promise<readonly WebSearchResult[]>> = [];
    if (this.sources.github !== false) jobs.push(() => this.searchGitHub(query, perSourceLimit));
    if (this.sources.npm !== false) jobs.push(() => this.searchNpm(query, perSourceLimit));
    if (this.sources.crates !== false) jobs.push(() => this.searchCrates(query, perSourceLimit));
    if (this.sources.arxiv !== false) jobs.push(() => this.searchArxiv(query, perSourceLimit));
    if (this.sources.pypi !== false) jobs.push(() => this.searchPyPi(query, perSourceLimit));
    return (await runWithConcurrency(jobs, 3)).flat().slice(0, limit);
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

class LocalResearchCache {
  private readonly db: SqliteDatabase;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const require = createRequire(import.meta.url);
    const sqlite = require('node:sqlite') as SqliteModule;
    this.db = new sqlite.DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS local_research_search_cache (
        key TEXT PRIMARY KEY,
        query TEXT NOT NULL,
        results_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        ttl_ms INTEGER NOT NULL
      );
    `);
  }

  get(
    key: string,
    now: number,
    options: { readonly allowStale: boolean; readonly mark?: string },
  ): WebSearchResult[] | undefined {
    const row = this.db
      .prepare('SELECT results_json, created_at, ttl_ms FROM local_research_search_cache WHERE key = ?')
      .get(key);
    if (!isSearchCacheRow(row)) return undefined;
    const expired = row.created_at + row.ttl_ms < now;
    if (expired && !options.allowStale) return undefined;
    const parsed = parseCachedResults(row.results_json);
    if (parsed === undefined) return undefined;
    const mark = options.mark;
    if (mark === undefined) return parsed;
    return parsed.map((result) => buildResult({
      title: result.title,
      url: result.url,
      snippet: prefixedSnippet(mark, result.snippet),
      date: result.date,
      content: result.content,
    }));
  }

  set(
    key: string,
    query: string,
    results: readonly WebSearchResult[],
    ttlMs: number,
    now: number,
  ): void {
    this.db
      .prepare(`
        INSERT INTO local_research_search_cache (key, query, results_json, created_at, ttl_ms)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          query = excluded.query,
          results_json = excluded.results_json,
          created_at = excluded.created_at,
          ttl_ms = excluded.ttl_ms
      `)
      .run(key, query, JSON.stringify(results), now, ttlMs);
  }
}

function parseDuckDuckGoResults(html: string, limit: number): WebSearchResult[] {
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

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  input: URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const contentLengthRaw = response.headers.get('content-length');
  if (contentLengthRaw !== null) {
    const contentLength = Number(contentLengthRaw);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new SearchResponseTooLargeError(
        `Search response too large: ${String(contentLength)} bytes exceeds maxBytes (${String(maxBytes)}).`,
      );
    }
  }

  const html = await response.text();
  const actualBytes = Buffer.byteLength(html, 'utf8');
  if (actualBytes > maxBytes) {
    throw new SearchResponseTooLargeError(
      `Search response too large: ${String(actualBytes)} bytes exceeds maxBytes (${String(maxBytes)}).`,
    );
  }
  return html;
}

function isFatalSearchError(error: unknown): boolean {
  return error instanceof SearchResponseTooLargeError;
}

async function runWithConcurrency<T>(
  jobs: readonly (() => Promise<T>)[],
  concurrency: number,
): Promise<T[]> {
  const results: T[] = [];
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = next;
      next += 1;
      const job = jobs[index];
      if (job === undefined) return;
      results[index] = await job();
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, jobs.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function rankAndDedupeResults(
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
  const url = result.url.toLowerCase();
  const titleHits = terms.filter((term) => title.includes(term)).length;
  const snippetHits = terms.filter((term) => snippet.includes(term)).length;
  const officialBoost =
    url.includes('github.com') ||
    url.includes('docs.') ||
    url.includes('arxiv.org') ||
    url.includes('npmjs.com') ||
    url.includes('pypi.org') ||
    url.includes('crates.io')
      ? 4
      : 0;
  const primaryBoost = /\[(github|npm|crates\.io|arxiv|pypi|searxng|yacy|duckduckgo)\]/i.test(result.snippet)
    ? 1
    : 0;
  return officialBoost + primaryBoost + titleHits * 2 + snippetHits;
}

function buildResult(input: {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
  readonly date?: string;
  readonly content?: string;
}): WebSearchResult {
  const result: WebSearchResult = {
    title: normalizeText(input.title),
    url: input.url,
    snippet: normalizeText(input.snippet),
  };
  const date = normalizeText(input.date ?? '');
  if (date.length > 0) result.date = date;
  const content = input.content?.trim();
  if (content !== undefined && content.length > 0) result.content = content;
  return result;
}

function hasUsableUrl(result: WebSearchResult): boolean {
  try {
    const parsed = new URL(result.url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function prefixedSnippet(source: string, snippet: string): string {
  const normalized = normalizeText(snippet);
  return normalized.length === 0 ? `[${source}]` : `[${source}] ${normalized}`;
}

function textOf(element: DomElementLike | null | undefined): string {
  return normalizeText(element?.textContent ?? '');
}

function normalizeText(text: string): string {
  return text.replaceAll(/\s+/g, ' ').trim();
}

function normalizeResultUrl(rawUrl: string): string | undefined {
  return normalizeUrl(rawUrl, DEFAULT_SEARCH_URL);
}

function normalizeUrl(rawUrl: string, baseUrl: string): string | undefined {
  if (rawUrl.length === 0) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl, baseUrl);
  } catch {
    return undefined;
  }
  const unwrapped = parsed.searchParams.get('uddg');
  if (unwrapped !== null && unwrapped.length > 0) {
    try {
      parsed = new URL(unwrapped);
    } catch {
      return undefined;
    }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
  return parsed.toString();
}

function canonicalUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    parsed.hash = '';
    for (const key of parsed.searchParams.keys()) {
      if (key.startsWith('utm_') || key === 'ref' || key === 'source') {
        parsed.searchParams.delete(key);
      }
    }
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

function normalizeOptionalUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.map(asRecord).filter((entry): entry is Record<string, unknown> => entry !== undefined)
    : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function isSearchCacheRow(value: unknown): value is SearchCacheRow {
  const row = asRecord(value);
  return (
    row !== undefined &&
    typeof row['results_json'] === 'string' &&
    typeof row['created_at'] === 'number' &&
    typeof row['ttl_ms'] === 'number'
  );
}

function parseCachedResults(value: string): WebSearchResult[] | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return undefined;
    return parsed
      .map((entry) => asRecord(entry))
      .filter((entry): entry is Record<string, unknown> => entry !== undefined)
      .map((entry) => buildResult({
        title: stringValue(entry['title']) ?? '',
        url: stringValue(entry['url']) ?? '',
        snippet: stringValue(entry['snippet']) ?? '',
        date: stringValue(entry['date']),
        content: stringValue(entry['content']),
      }))
      .filter(hasUsableUrl);
  } catch {
    return undefined;
  }
}
