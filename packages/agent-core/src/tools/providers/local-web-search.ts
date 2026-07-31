import type { UrlFetcher } from '../builtin/web/fetch-url';
import type { WebSearchProvider, WebSearchResult } from '../builtin/web/web-search';

import { LocalResearchCache } from './local-web-search-cache';
import {
  recordLocalResearchCacheHit,
  recordLocalResearchCacheMiss,
} from './local-research-cache-telemetry';
import {
  parseDuckDuckGoLiteResults,
  parseDuckDuckGoResults,
} from './local-web-search-ddg-parse';
import { DirectSourceAdapter } from './local-web-search-direct-sources';
import {
  classifySearchIntent,
  hasAnyDirectSource,
  selectDirectSourcesForIntent,
  shapeQueryForIntent,
  type LocalSearchDirectSources,
  type SearchIntent,
} from './local-web-search-intent';
import { rankAndDedupeResults } from './local-web-search-ranking';
import {
  asRecord,
  asRecordArray,
  buildResult,
  clampInt,
  DDG_LITE_SEARCH_URL,
  DEFAULT_SEARCH_URL,
  DEFAULT_USER_AGENT,
  ensureTrailingSlash,
  fetchWithTimeout,
  hasUsableUrl,
  isFatalSearchError,
  normalizeOptionalUrl,
  prefixedSnippet,
  readBoundedText,
  runWithConcurrency,
  stringValue,
  type LocalSearchAdapter,
} from './local-web-search-shared';

export type { LocalSearchDirectSources } from './local-web-search-intent';

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_WEB_CACHE_TTL_MS = 7 * 86_400_000;
const MAX_ADAPTER_RESULTS = 12;
const CONTENT_FETCH_LIMIT = 4;
const TECH_DIRECT_SOURCE_MIN_RESULTS = 2;

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
    const intent = classifySearchIntent(trimmed);
    const shapedQuery = shapeQueryForIntent(trimmed, intent);
    const cacheKey = this.cacheKey(shapedQuery, limit, includeContent, intent);
    const now = Date.now();

    if (this.offlineMode === 'always') {
      return this.lookupCache(cacheKey, now, { allowStale: true, mark: 'offline cache' }) ?? [];
    }

    const cached = this.lookupCache(cacheKey, now, { allowStale: false });
    if (cached !== undefined) return cached.slice(0, limit);

    // Free-stack quality+efficiency:
    // 1) Fan out DDG (+ optional SearXNG/YaCy) in parallel.
    // 2) For tech/package/paper intents, also fan out direct APIs in parallel.
    // 3) Rank/dedupe once; page-fetch only top winners when include_content.
    const primaryAdapters = this.createPrimaryAdapters(intent);
    const directAdapters =
      intent.kind === 'tech' || intent.kind === 'package' || intent.kind === 'paper'
        ? this.createDirectAdapters(intent)
        : [];

    const [primaryResults, directResults] = await Promise.all([
      this.searchAdapters(primaryAdapters, shapedQuery, limit),
      directAdapters.length > 0
        ? this.searchAdapters(directAdapters, shapedQuery, Math.min(limit, 6))
        : Promise.resolve([] as readonly WebSearchResult[]),
    ]);

    let adapterResults: WebSearchResult[] = [...primaryResults, ...directResults];
    if (adapterResults.length === 0) {
      // Last resort: use full configured direct sources even for general intents
      // when HTML search produced nothing (blocked DDG, empty page, etc.).
      const lastResort = this.createDirectAdapters({ kind: 'tech' });
      adapterResults = [
        ...(await this.searchAdapters(
          lastResort.length > 0 ? lastResort : this.createDirectAdapters(intent),
          shapedQuery,
          limit,
        )),
      ];
    } else if (
      primaryResults.length > 0 &&
      directResults.length === 0 &&
      primaryResults.length < TECH_DIRECT_SOURCE_MIN_RESULTS &&
      (intent.kind === 'tech' || intent.kind === 'package' || intent.kind === 'paper')
    ) {
      const enriched = await this.searchAdapters(this.createDirectAdapters(intent), shapedQuery, limit);
      adapterResults = [...adapterResults, ...enriched];
    }

    let results = rankAndDedupeResults(adapterResults, trimmed).slice(0, limit);
    if (results.length === 0) {
      return this.lookupCache(cacheKey, now, { allowStale: true, mark: 'stale local cache' }) ?? [];
    }

    if (includeContent && this.urlFetcher !== undefined) {
      results = await this.withFetchedContent(results, limit);
    }

    this.cache?.set(cacheKey, shapedQuery, results, this.cacheTtlMs, now);
    return results;
  }

  private lookupCache(
    cacheKey: string,
    now: number,
    options: { readonly allowStale: boolean; readonly mark?: string },
  ): WebSearchResult[] | undefined {
    if (this.cache === undefined) return undefined;
    const cached = this.cache.get(cacheKey, now, options);
    if (cached !== undefined) {
      recordLocalResearchCacheHit();
      return cached;
    }
    recordLocalResearchCacheMiss();
    return undefined;
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

  private createPrimaryAdapters(intent: SearchIntent): readonly LocalSearchAdapter[] {
    const adapters: LocalSearchAdapter[] = [
      new DuckDuckGoHtmlAdapter({
        searchUrl: this.searchUrl,
        liteSearchUrl: DDG_LITE_SEARCH_URL,
        userAgent: this.userAgent,
        fetchImpl: this.fetchImpl,
        maxBytes: this.maxBytes,
        timeoutMs: this.timeoutMs,
        intent,
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

  private createDirectAdapters(intent: SearchIntent): readonly LocalSearchAdapter[] {
    const sources = selectDirectSourcesForIntent(this.directSources, intent);
    if (!hasAnyDirectSource(sources)) return [];
    return [new DirectSourceAdapter(sources, this.fetchImpl, this.timeoutMs, intent)];
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

  private cacheKey(
    query: string,
    limit: number,
    includeContent: boolean,
    intent: SearchIntent,
  ): string {
    return JSON.stringify({
      query,
      limit,
      includeContent,
      intent: intent.kind,
      packageEcosystem: intent.packageEcosystem,
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
  private readonly liteSearchUrl: string;
  private readonly userAgent: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxBytes: number;
  private readonly timeoutMs: number;
  private readonly intent: SearchIntent;

  constructor(options: {
    readonly searchUrl: string;
    readonly liteSearchUrl: string;
    readonly userAgent: string;
    readonly fetchImpl: typeof fetch;
    readonly maxBytes: number;
    readonly timeoutMs: number;
    readonly intent: SearchIntent;
  }) {
    this.searchUrl = options.searchUrl;
    this.liteSearchUrl = options.liteSearchUrl;
    this.userAgent = options.userAgent;
    this.fetchImpl = options.fetchImpl;
    this.maxBytes = options.maxBytes;
    this.timeoutMs = options.timeoutMs;
    this.intent = options.intent;
  }

  async search(query: string, limit: number): Promise<WebSearchResult[]> {
    // Prefer classic HTML endpoint; fall back to Lite when blocked/empty.
    // Both are free, no API key, and Lite often survives bot filters better.
    const endpoints = [this.searchUrl, this.liteSearchUrl];
    let lastError: unknown;
    for (const endpoint of endpoints) {
      try {
        const results = await this.searchEndpoint(endpoint, query, limit);
        if (results.length > 0) return results;
      } catch (error) {
        lastError = error;
        if (isFatalSearchError(error)) throw error;
      }
    }
    if (lastError instanceof Error) throw lastError;
    if (lastError !== undefined) {
      throw new Error(typeof lastError === 'string' ? lastError : 'local web search failed');
    }
    return [];
  }

  private async searchEndpoint(
    endpoint: string,
    query: string,
    limit: number,
  ): Promise<WebSearchResult[]> {
    const url = new URL(endpoint);
    url.searchParams.set('q', query);
    // kl=wt-wt = worldwide; kp=-2 = moderate safe search (less junk for research).
    if (!url.searchParams.has('kl')) url.searchParams.set('kl', 'wt-wt');
    if (!url.searchParams.has('kp')) url.searchParams.set('kp', '-2');
    if (this.intent.kind === 'news') url.searchParams.set('iar', 'news');

    const response = await fetchWithTimeout(this.fetchImpl, url, {
      method: 'GET',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': this.userAgent,
        'Accept-Language': 'en-US,en;q=0.9',
      },
    }, this.timeoutMs);
    if (response.status >= 400) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(
        `Local search request failed: HTTP ${String(response.status)} ${response.statusText}`,
      );
    }

    const html = await readBoundedText(response, this.maxBytes);
    const parsed = endpoint.includes('lite.duckduckgo.com')
      ? parseDuckDuckGoLiteResults(html, limit)
      : parseDuckDuckGoResults(html, limit);
    return parsed.map((result) =>
      buildResult({
        title: result.title,
        url: result.url,
        snippet: prefixedSnippet('duckduckgo', result.snippet),
        date: result.date,
        content: result.content,
      }),
    );
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
    const json = await response.json();
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
    const json = await response.json();
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
