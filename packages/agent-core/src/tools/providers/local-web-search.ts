import {
  NetResilienceRegistry,
  backoffMs,
  classifyHttpBlock,
  looksLikeCaptchaBody,
  type NetHostPolicy,
} from '../../runtime/net-resilience';
import type { UrlFetcher } from '../builtin/web/fetch-url';
import type { WebSearchProvider, WebSearchResult } from '../builtin/web/web-search';

import { LocalResearchCache } from './local-web-search-cache';
import {
  recordLocalResearchCacheHit,
  recordLocalResearchCacheMiss,
} from './local-research-cache-telemetry';
import { BING_SEARCH_URL, parseBingResults } from './local-web-search-bing-parse';
import {
  parseDuckDuckGoLiteResults,
  parseDuckDuckGoResults,
} from './local-web-search-ddg-parse';
import { DirectSourceAdapter } from './local-web-search-direct-sources';
import {
  formatSearchRouteLine,
  inferSearchIntent,
  hasAnyDirectSource,
  selectDirectSourcesForIntent,
  shapeQueryForIntent,
  type LocalSearchDirectSources,
  type SearchIntent,
} from './local-web-search-intent';
import type { LlmClassifierDeps } from '../../utils/llm-classifier-utils';
import { rankAndDedupeResults } from './local-web-search-ranking';
import {
  asRecord,
  asRecordArray,
  buildResult,
  clampInt,
  DDG_LITE_SEARCH_URL,
  DEFAULT_SEARCH_URL,
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
  /** Include the keyless Bing HTML endpoint in the primary fan-out. Default true. */
  bing?: boolean;
  /** Per-host pacing/cooldown harness. Defaults to the process-wide registry. */
  resilience?: NetResilienceRegistry;
  /** Optional effect judge — omit to leave sources as configured (no keyword route). */
  classifier?: LlmClassifierDeps;
}

/** DDG HTML endpoints rate-limit aggressively; pace and cool down per host. */
const DDG_HOST_POLICY: NetHostPolicy = {
  minIntervalMs: 350,
  jitterMs: 500,
  blockThreshold: 2,
  cooldownMs: 5 * 60_000,
};
const DDG_MAX_BLOCK_RETRIES = 1;
const DDG_RETRY_BASE_BACKOFF_MS = 600;

/** Bing's static HTML endpoint behaves similarly to DDG's under load. */
const BING_HOST_POLICY: NetHostPolicy = {
  minIntervalMs: 400,
  jitterMs: 600,
  blockThreshold: 2,
  cooldownMs: 5 * 60_000,
};
const BING_MAX_BLOCK_RETRIES = 1;
const BING_RETRY_BASE_BACKOFF_MS = 700;

interface ResilientHtmlFetchOptions {
  readonly resilience: NetResilienceRegistry;
  readonly hostPolicy: NetHostPolicy;
  readonly maxBlockRetries: number;
  readonly retryBaseBackoffMs: number;
  readonly url: URL;
  readonly pinnedUserAgent?: string | undefined;
  readonly fetchImpl: typeof fetch;
  readonly timeoutMs: number;
  readonly maxBytes: number;
}

/**
 * GET an HTML search page through the resilience harness: cooldown fast-fail,
 * per-host pacing, UA rotation, one backoff retry on 429/403/202/captcha.
 * Returns the page body; throws when the host stays blocked.
 */
async function fetchHtmlWithResilience(options: ResilientHtmlFetchOptions): Promise<string> {
  const host = options.url.hostname;
  options.resilience.assertReady(host);

  let lastStatus = 0;
  let lastStatusText = '';
  let blockedByBody = false;
  for (let attempt = 0; attempt <= options.maxBlockRetries; attempt++) {
    await options.resilience.pace(host, options.hostPolicy);
    const userAgent = options.pinnedUserAgent ?? options.resilience.pickUserAgent(host);

    // Network/timeout failures are not host blocks — a flaky local link must
    // not bench an otherwise healthy host into cooldown, so they propagate
    // untouched (same rule as FetchURL).
    const response = await fetchWithTimeout(options.fetchImpl, options.url, {
      method: 'GET',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': userAgent,
        'Accept-Language': 'en-US,en;q=0.9',
      },
    }, options.timeoutMs);

    lastStatus = response.status;
    lastStatusText = response.statusText;
    const block = classifyHttpBlock(response.status);
    if (block === undefined) {
      const html = await readBoundedText(response, options.maxBytes);
      if (looksLikeCaptchaBody(html)) {
        blockedByBody = true;
        options.resilience.noteBlock(host, 'captcha', options.hostPolicy);
      } else {
        options.resilience.noteSuccess(host);
        return html;
      }
    } else {
      await response.body?.cancel().catch(() => undefined);
      options.resilience.noteBlock(host, block, options.hostPolicy);
    }

    if (attempt < options.maxBlockRetries) {
      await options.resilience.sleep(backoffMs(attempt, options.retryBaseBackoffMs));
    }
  }

  if (blockedByBody && lastStatus < 400) {
    throw new Error(`Local search blocked by "${host}": bot check page returned.`);
  }
  throw new Error(`Local search request failed: HTTP ${String(lastStatus)} ${lastStatusText}`);
}

export class LocalWebSearchProvider implements WebSearchProvider {
  private readonly searchUrl: string;
  private readonly pinnedUserAgent: string | undefined;
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
  private readonly bingEnabled: boolean;
  private readonly resilience: NetResilienceRegistry;
  private readonly classifier: LlmClassifierDeps | undefined;
  private lastRouteLine: string | undefined;
  private lastRawQuery: string | undefined;
  private lastShapedQuery: string | undefined;

  constructor(options: LocalWebSearchProviderOptions = {}) {
    this.searchUrl = options.searchUrl ?? DEFAULT_SEARCH_URL;
    this.pinnedUserAgent = options.userAgent;
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
    this.bingEnabled = options.bing ?? true;
    // Per-instance by default so cooldown state never leaks across tests or
    // independent engines; the runtime factory passes the shared registry.
    this.resilience = options.resilience ?? new NetResilienceRegistry();
    this.classifier = options.classifier;
  }

  lastRoute(): string | undefined {
    return this.lastRouteLine;
  }

  lastSearchedQuery(): string | undefined {
    if (this.lastShapedQuery === undefined || this.lastRawQuery === undefined) return undefined;
    return this.lastShapedQuery === this.lastRawQuery ? undefined : this.lastShapedQuery;
  }

  async search(
    query: string,
    options?: { limit?: number; includeContent?: boolean; toolCallId?: string },
  ): Promise<WebSearchResult[]> {
    const trimmed = query.trim();
    if (trimmed.length === 0) return [];

    const limit = clampInt(options?.limit ?? 5, 1, 20);
    const includeContent = options?.includeContent === true;
    const intent = await inferSearchIntent(trimmed, this.classifier);
    const shapedQuery = shapeQueryForIntent(trimmed, intent);
    const routedSources = selectDirectSourcesForIntent(this.directSources, intent);
    this.lastRouteLine = formatSearchRouteLine(intent, routedSources);
    this.lastRawQuery = trimmed;
    this.lastShapedQuery = shapedQuery;
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
        userAgent: this.pinnedUserAgent,
        fetchImpl: this.fetchImpl,
        maxBytes: this.maxBytes,
        timeoutMs: this.timeoutMs,
        intent,
        resilience: this.resilience,
      }),
    ];
    if (this.bingEnabled) {
      adapters.push(new BingHtmlAdapter({
        userAgent: this.pinnedUserAgent,
        fetchImpl: this.fetchImpl,
        maxBytes: this.maxBytes,
        timeoutMs: this.timeoutMs,
        resilience: this.resilience,
      }));
    }
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
      bing: this.bingEnabled,
      directSources: this.directSources,
    });
  }
}

class DuckDuckGoHtmlAdapter implements LocalSearchAdapter {
  readonly id = 'duckduckgo-html';
  private readonly searchUrl: string;
  private readonly liteSearchUrl: string;
  private readonly pinnedUserAgent: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly maxBytes: number;
  private readonly timeoutMs: number;
  private readonly intent: SearchIntent;
  private readonly resilience: NetResilienceRegistry;

  constructor(options: {
    readonly searchUrl: string;
    readonly liteSearchUrl: string;
    readonly userAgent?: string | undefined;
    readonly fetchImpl: typeof fetch;
    readonly maxBytes: number;
    readonly timeoutMs: number;
    readonly intent: SearchIntent;
    readonly resilience: NetResilienceRegistry;
  }) {
    this.searchUrl = options.searchUrl;
    this.liteSearchUrl = options.liteSearchUrl;
    this.pinnedUserAgent = options.userAgent;
    this.fetchImpl = options.fetchImpl;
    this.maxBytes = options.maxBytes;
    this.timeoutMs = options.timeoutMs;
    this.intent = options.intent;
    this.resilience = options.resilience;
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

    const html = await fetchHtmlWithResilience({
      resilience: this.resilience,
      hostPolicy: DDG_HOST_POLICY,
      maxBlockRetries: DDG_MAX_BLOCK_RETRIES,
      retryBaseBackoffMs: DDG_RETRY_BASE_BACKOFF_MS,
      url,
      pinnedUserAgent: this.pinnedUserAgent,
      fetchImpl: this.fetchImpl,
      timeoutMs: this.timeoutMs,
      maxBytes: this.maxBytes,
    });
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

class BingHtmlAdapter implements LocalSearchAdapter {
  readonly id = 'bing-html';
  private readonly searchUrl: string;
  private readonly pinnedUserAgent: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly maxBytes: number;
  private readonly timeoutMs: number;
  private readonly resilience: NetResilienceRegistry;

  constructor(options: {
    readonly searchUrl?: string | undefined;
    readonly userAgent?: string | undefined;
    readonly fetchImpl: typeof fetch;
    readonly maxBytes: number;
    readonly timeoutMs: number;
    readonly resilience: NetResilienceRegistry;
  }) {
    this.searchUrl = options.searchUrl ?? BING_SEARCH_URL;
    this.pinnedUserAgent = options.userAgent;
    this.fetchImpl = options.fetchImpl;
    this.maxBytes = options.maxBytes;
    this.timeoutMs = options.timeoutMs;
    this.resilience = options.resilience;
  }

  async search(query: string, limit: number): Promise<WebSearchResult[]> {
    const url = new URL(this.searchUrl);
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(Math.min(Math.max(limit * 2, 10), 30)));
    const html = await fetchHtmlWithResilience({
      resilience: this.resilience,
      hostPolicy: BING_HOST_POLICY,
      maxBlockRetries: BING_MAX_BLOCK_RETRIES,
      retryBaseBackoffMs: BING_RETRY_BASE_BACKOFF_MS,
      url,
      pinnedUserAgent: this.pinnedUserAgent,
      fetchImpl: this.fetchImpl,
      timeoutMs: this.timeoutMs,
      maxBytes: this.maxBytes,
    });
    return parseBingResults(html, limit).map((result) =>
      buildResult({
        title: result.title,
        url: result.url,
        snippet: prefixedSnippet('bing', result.snippet),
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
