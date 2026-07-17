/**
 * Multi-provider deep-research search engine.
 *
 * Cost-first design (agent research best practices):
 *   1. Snippets first, full page body only on explicit include_content.
 *   2. Cascade (auto) not fan-out — one cheap provider, escalate only if thin.
 *   3. Hard budget caps: max paid calls / content pages / content chars.
 *   4. Free fallback last; never paid+free parallel by default.
 *   5. Cache-friendly local stack remains available for zero-config.
 *
 * Composes paid/free backends (Brave, Tavily, Exa, Serper, SearXNG,
 * DuckDuckGo/local) with rate-limit cooldowns and free fallback.
 *
 * Official endpoints (verified against public docs 2026-07):
 *   - Brave:  GET  https://api.search.brave.com/res/v1/web/search  (X-Subscription-Token)
 *   - Tavily: POST https://api.tavily.com/search                   (Bearer / api_key body)
 *   - Exa:    POST https://api.exa.ai/search                      (x-api-key)
 *   - Serper: POST https://google.serper.dev/search               (X-API-KEY)
 */

import type {
  ResearchSearchConfig,
  ResearchSearchProviderConfig,
  ResearchSearchProviderKind,
  ResearchSearchRoutingStrategy,
} from '#/config/schema';
import type { UrlFetcher } from '../builtin/web/fetch-url';
import type { WebSearchProvider, WebSearchResult } from '../builtin/web/web-search';
import { LocalWebSearchProvider, type LocalWebSearchProviderOptions } from './local-web-search';
import { MoonshotWebSearchProvider } from './moonshot-web-search';

// ── Public types ─────────────────────────────────────────────────────

export interface ResearchSearchEngineOptions {
  readonly search?: ResearchSearchConfig | undefined;
  readonly local?: LocalWebSearchProviderOptions | undefined;
  readonly moonshot?: {
    readonly baseUrl: string;
    readonly apiKey?: string | undefined;
    readonly defaultHeaders?: Record<string, string> | undefined;
    readonly tokenProvider?: {
      getAccessToken(options?: { readonly force?: boolean | undefined }): Promise<string>;
    };
  };
  readonly fetchImpl?: typeof fetch;
  readonly urlFetcher?: UrlFetcher;
  readonly now?: () => number;
}

export interface ResearchSearchStatus {
  readonly providers: readonly ResearchSearchProviderStatus[];
  readonly strategy: ResearchSearchRoutingStrategy;
  readonly freeFallback: boolean;
}

export interface ResearchSearchProviderStatus {
  readonly id: string;
  readonly kind: ResearchSearchProviderKind;
  readonly label: string;
  readonly ready: boolean;
  readonly source: 'config' | 'env' | 'local' | 'moonshot';
  readonly cooldownUntil?: number | undefined;
  readonly rpm?: number | undefined;
}

// ── Env auto-detect ──────────────────────────────────────────────────

const ENV_KEY_MAP: ReadonlyArray<{
  readonly kind: ResearchSearchProviderKind;
  readonly envs: readonly string[];
}> = [
  { kind: 'brave', envs: ['BRAVE_API_KEY', 'BRAVE_SEARCH_API_KEY'] },
  { kind: 'tavily', envs: ['TAVILY_API_KEY'] },
  { kind: 'exa', envs: ['EXA_API_KEY'] },
  { kind: 'serper', envs: ['SERPER_API_KEY', 'SERPER_DEV_API_KEY'] },
];

export function detectSearchProviderEnvKeys(
  env: NodeJS.ProcessEnv = process.env,
): ResearchSearchProviderConfig[] {
  const detected: ResearchSearchProviderConfig[] = [];
  for (const entry of ENV_KEY_MAP) {
    for (const envName of entry.envs) {
      const value = env[envName]?.trim();
      if (value !== undefined && value.length > 0) {
        detected.push({
          kind: entry.kind,
          apiKeyEnv: envName,
          label: entry.kind,
        });
        break;
      }
    }
  }
  return detected;
}

export function resolveResearchApiKey(input: {
  readonly apiKey?: string | undefined;
  readonly apiKeyEnv?: string | undefined;
  readonly apiKeys?: readonly string[] | undefined;
  readonly env?: NodeJS.ProcessEnv;
}): string | undefined {
  const env = input.env ?? process.env;
  const candidates: string[] = [];
  if (input.apiKey !== undefined) candidates.push(input.apiKey);
  if (input.apiKeys !== undefined) candidates.push(...input.apiKeys);
  for (const raw of candidates) {
    const resolved = resolveKeyRef(raw, env);
    if (resolved !== undefined) return resolved;
  }
  if (input.apiKeyEnv !== undefined) {
    const fromEnv = env[input.apiKeyEnv]?.trim();
    if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
  }
  return undefined;
}

function resolveKeyRef(raw: string, env: NodeJS.ProcessEnv): string | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  const envRef = /^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(trimmed);
  if (envRef?.[1] !== undefined) {
    const value = env[envRef[1]]?.trim();
    return value !== undefined && value.length > 0 ? value : undefined;
  }
  return trimmed;
}

// ── Engine ───────────────────────────────────────────────────────────

const DEFAULT_COOLDOWN_MS = 60_000;
const DEFAULT_CONCURRENCY = 2;
/** Auto/cascade: at most this many paid/remote calls per WebSearch. */
const DEFAULT_MAX_PROVIDER_CALLS = 2;
/** Stop cascading once we have this many usable results (capped by limit). */
const DEFAULT_MIN_RESULTS_TO_STOP = 3;
/** Token guard: truncate each include_content body. */
const DEFAULT_MAX_CONTENT_CHARS = 2_500;
/** Token/network guard: fetch bodies for at most this many top hits. */
const DEFAULT_CONTENT_FETCH_LIMIT = 2;

/** Lower = preferred in cost-aware cascade. Free is always last. */
const PROVIDER_COST_RANK: Readonly<Record<ResearchSearchProviderKind, number>> = {
  brave: 10,
  serper: 20,
  searxng: 25,
  moonshot: 30,
  tavily: 40,
  exa: 50,
  duckduckgo: 100,
};

interface ProviderSlot {
  readonly id: string;
  readonly kind: ResearchSearchProviderKind;
  readonly label: string;
  readonly source: ResearchSearchProviderStatus['source'];
  readonly weight: number;
  readonly rpm: number | undefined;
  readonly provider: WebSearchProvider;
  cooldownUntil: number;
  useCount: number;
  keyCursor: number;
}

export class ResearchSearchEngine implements WebSearchProvider {
  private readonly strategy: ResearchSearchRoutingStrategy;
  private readonly freeFallback: boolean;
  private readonly cooldownMs: number;
  private readonly concurrency: number;
  private readonly maxProviderCalls: number;
  private readonly minResultsToStop: number;
  private readonly maxContentChars: number;
  private readonly contentFetchLimit: number;
  private readonly urlFetcher: UrlFetcher | undefined;
  private readonly now: () => number;
  private readonly slots: ProviderSlot[];
  private rrCursor = 0;

  constructor(options: ResearchSearchEngineOptions = {}) {
    this.strategy = options.search?.strategy ?? 'auto';
    this.freeFallback = options.search?.freeFallback !== false;
    this.cooldownMs = options.search?.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.concurrency = clampInt(options.search?.concurrency ?? DEFAULT_CONCURRENCY, 1, 16);
    this.maxProviderCalls = clampInt(
      options.search?.maxProviderCalls ?? DEFAULT_MAX_PROVIDER_CALLS,
      1,
      8,
    );
    this.minResultsToStop = clampInt(
      options.search?.minResultsToStop ?? DEFAULT_MIN_RESULTS_TO_STOP,
      1,
      20,
    );
    this.maxContentChars = clampInt(
      options.search?.maxContentChars ?? DEFAULT_MAX_CONTENT_CHARS,
      200,
      20_000,
    );
    this.contentFetchLimit = clampInt(
      options.search?.contentFetchLimit ?? DEFAULT_CONTENT_FETCH_LIMIT,
      0,
      8,
    );
    this.urlFetcher = options.urlFetcher ?? options.local?.urlFetcher;
    this.now = options.now ?? Date.now;
    this.slots = buildProviderSlots(options);
  }

  status(): ResearchSearchStatus {
    const now = this.now();
    return {
      strategy: this.strategy,
      freeFallback: this.freeFallback,
      providers: this.slots.map((slot) => ({
        id: slot.id,
        kind: slot.kind,
        label: slot.label,
        ready: slot.cooldownUntil <= now,
        source: slot.source,
        cooldownUntil: slot.cooldownUntil > now ? slot.cooldownUntil : undefined,
        rpm: slot.rpm,
      })),
    };
  }

  async search(
    query: string,
    options?: { limit?: number; includeContent?: boolean; toolCallId?: string },
  ): Promise<WebSearchResult[]> {
    const trimmed = query.trim();
    if (trimmed.length === 0) return [];
    // Efficiency default: prefer 3 hits; model can raise limit intentionally.
    const limit = clampInt(options?.limit ?? 3, 1, 20);
    // Never ask every remote provider for full page bodies — content is
    // attached once after ranking (local Defuddle fetch).
    const metadataOptions = { ...options, includeContent: false as const };
    const now = this.now();

    const ready = this.slots.filter((slot) => slot.cooldownUntil <= now);
    if (ready.length === 0) {
      const free = this.slots.filter((slot) => slot.kind === 'duckduckgo' || slot.source === 'local');
      if (free.length === 0) return [];
      const last = await this.searchSlot(free[0]!, trimmed, metadataOptions, limit);
      return this.maybeAttachContent(rankAndDedupe(last, trimmed).slice(0, limit), options);
    }

    let results: WebSearchResult[];
    switch (this.strategy) {
      case 'parallel':
        results = await this.searchParallel(ready, trimmed, metadataOptions, limit);
        break;
      case 'auto':
        results = await this.searchCascade(ready, trimmed, metadataOptions, limit);
        break;
      case 'fallback':
        results = await this.searchFallback(ready, trimmed, metadataOptions, limit);
        break;
      case 'round_robin':
        results = await this.searchOne(this.pickRoundRobin(ready), trimmed, metadataOptions, limit, ready);
        break;
      case 'weighted_round_robin':
        results = await this.searchOne(this.pickWeighted(ready), trimmed, metadataOptions, limit, ready);
        break;
      case 'least_used':
        results = await this.searchOne(this.pickLeastUsed(ready), trimmed, metadataOptions, limit, ready);
        break;
      case 'rate_limit_aware':
        results = await this.searchOne(this.pickRateLimitAware(ready), trimmed, metadataOptions, limit, ready);
        break;
      default:
        results = await this.searchCascade(ready, trimmed, metadataOptions, limit);
        break;
    }

    return this.maybeAttachContent(results, options);
  }

  /**
   * Cost-aware cascade (default `auto`):
   * paid providers ordered by cost rank → stop when enough good results → free last.
   * At most `maxProviderCalls` paid/remote calls per invocation.
   */
  private async searchCascade(
    slots: readonly ProviderSlot[],
    query: string,
    options: { limit?: number; includeContent?: boolean; toolCallId?: string } | undefined,
    limit: number,
  ): Promise<WebSearchResult[]> {
    const paid = orderByCost(
      slots.filter((s) => s.kind !== 'duckduckgo' && s.source !== 'local'),
    );
    const free = slots.filter((s) => s.kind === 'duckduckgo' || s.source === 'local');
    const stopAt = Math.min(limit, this.minResultsToStop);
    const collected: WebSearchResult[] = [];
    let paidCalls = 0;

    for (const slot of paid) {
      if (paidCalls >= this.maxProviderCalls) break;
      const batch = await this.searchSlot(slot, query, options, limit);
      paidCalls += 1;
      collected.push(...batch);
      const ranked = rankAndDedupe(collected, query);
      if (ranked.length >= stopAt) {
        return ranked.slice(0, limit);
      }
    }

    if (this.freeFallback && free.length > 0) {
      if (rankAndDedupe(collected, query).length < stopAt) {
        for (const slot of free) {
          const batch = await this.searchSlot(slot, query, options, limit);
          collected.push(...batch);
          const ranked = rankAndDedupe(collected, query);
          if (ranked.length >= stopAt) break;
        }
      }
    }

    return rankAndDedupe(collected, query).slice(0, limit);
  }

  private async searchParallel(
    slots: readonly ProviderSlot[],
    query: string,
    options: { limit?: number; includeContent?: boolean; toolCallId?: string } | undefined,
    limit: number,
  ): Promise<WebSearchResult[]> {
    // Parallel is opt-in and still budgeted: only the cheapest N paid slots.
    const paid = orderByCost(
      slots.filter((s) => s.kind !== 'duckduckgo' && s.source !== 'local'),
    ).slice(0, this.maxProviderCalls);
    const free = slots.filter((s) => s.kind === 'duckduckgo' || s.source === 'local');
    const primary = paid.length > 0 ? paid : free;
    const secondary = paid.length > 0 && this.freeFallback ? free : [];

    const primaryResults = await this.fanOut(primary, query, options, limit);
    if (primaryResults.length > 0 || secondary.length === 0) {
      return rankAndDedupe(primaryResults, query).slice(0, limit);
    }
    const fallbackResults = await this.fanOut(secondary, query, options, limit);
    return rankAndDedupe([...primaryResults, ...fallbackResults], query).slice(0, limit);
  }

  private async searchFallback(
    slots: readonly ProviderSlot[],
    query: string,
    options: { limit?: number; includeContent?: boolean; toolCallId?: string } | undefined,
    limit: number,
  ): Promise<WebSearchResult[]> {
    const ordered = [
      ...orderByCost(slots.filter((s) => s.kind !== 'duckduckgo' && s.source !== 'local')),
      ...slots.filter((s) => s.kind === 'duckduckgo' || s.source === 'local'),
    ];
    let paidCalls = 0;
    for (const slot of ordered) {
      const isPaid = slot.kind !== 'duckduckgo' && slot.source !== 'local';
      if (isPaid) {
        if (paidCalls >= this.maxProviderCalls) continue;
        paidCalls += 1;
      }
      const results = await this.searchSlot(slot, query, options, limit);
      if (results.length > 0) return results.slice(0, limit);
    }
    return [];
  }

  private async searchOne(
    slot: ProviderSlot | undefined,
    query: string,
    options: { limit?: number; includeContent?: boolean; toolCallId?: string } | undefined,
    limit: number,
    allReady: readonly ProviderSlot[],
  ): Promise<WebSearchResult[]> {
    if (slot === undefined) return [];
    const results = await this.searchSlot(slot, query, options, limit);
    if (results.length > 0) return results.slice(0, limit);
    let paidCalls = slot.kind !== 'duckduckgo' && slot.source !== 'local' ? 1 : 0;
    for (const other of orderByCost(allReady)) {
      if (other.id === slot.id) continue;
      const isPaid = other.kind !== 'duckduckgo' && other.source !== 'local';
      if (isPaid) {
        if (paidCalls >= this.maxProviderCalls) continue;
        paidCalls += 1;
      }
      const more = await this.searchSlot(other, query, options, limit);
      if (more.length > 0) return more.slice(0, limit);
    }
    return [];
  }

  private async fanOut(
    slots: readonly ProviderSlot[],
    query: string,
    options: { limit?: number; includeContent?: boolean; toolCallId?: string } | undefined,
    limit: number,
  ): Promise<WebSearchResult[]> {
    const jobs = slots.map((slot) => async () => this.searchSlot(slot, query, options, limit));
    const batches = await runWithConcurrency(jobs, this.concurrency);
    return batches.flat();
  }

  private async searchSlot(
    slot: ProviderSlot,
    query: string,
    options: { limit?: number; includeContent?: boolean; toolCallId?: string } | undefined,
    limit: number,
  ): Promise<WebSearchResult[]> {
    try {
      const results = await slot.provider.search(query, {
        limit,
        includeContent: options?.includeContent,
        toolCallId: options?.toolCallId,
      });
      slot.useCount += 1;
      return results.map((result) => annotateSource(result, slot.label));
    } catch (error) {
      if (isRateLimitError(error)) {
        slot.cooldownUntil = this.now() + this.cooldownMs;
      }
      return [];
    }
  }

  /**
   * Attach page bodies only after ranking, only for top-N, only when asked.
   * Uses local Defuddle fetch (already HTML-cleaned) when available.
   */
  private async maybeAttachContent(
    results: WebSearchResult[],
    options: { limit?: number; includeContent?: boolean; toolCallId?: string } | undefined,
  ): Promise<WebSearchResult[]> {
    if (options?.includeContent !== true || results.length === 0) {
      return results.map((r) => truncateResultContent(r, this.maxContentChars));
    }
    if (this.urlFetcher === undefined) {
      return results.map((r) => truncateResultContent(r, this.maxContentChars));
    }

    const fetchCount = Math.min(results.length, this.contentFetchLimit);
    const head = results.slice(0, fetchCount);
    const tail = results.slice(fetchCount);
    const enriched = await runWithConcurrency(
      head.map((result) => async (): Promise<WebSearchResult> => {
        if (result.content !== undefined && result.content.trim().length > 0) {
          return truncateResultContent(result, this.maxContentChars);
        }
        try {
          const fetched = await this.urlFetcher?.fetch(result.url, {
            toolCallId: options.toolCallId,
          });
          if (fetched === undefined || fetched.content.trim().length === 0) {
            return truncateResultContent(result, this.maxContentChars);
          }
          return truncateResultContent(
            {
              ...result,
              content: fetched.content,
            },
            this.maxContentChars,
          );
        } catch {
          return truncateResultContent(result, this.maxContentChars);
        }
      }),
      Math.min(this.concurrency, fetchCount),
    );
    return [
      ...enriched,
      ...tail.map((r) => truncateResultContent(r, this.maxContentChars)),
    ];
  }

  private pickRoundRobin(slots: readonly ProviderSlot[]): ProviderSlot | undefined {
    if (slots.length === 0) return undefined;
    const index = this.rrCursor % slots.length;
    this.rrCursor = (this.rrCursor + 1) % Number.MAX_SAFE_INTEGER;
    return slots[index];
  }

  private pickWeighted(slots: readonly ProviderSlot[]): ProviderSlot | undefined {
    if (slots.length === 0) return undefined;
    const total = slots.reduce((sum, slot) => sum + slot.weight, 0);
    let cursor = (this.rrCursor % Math.max(total, 1)) + 1;
    this.rrCursor += 1;
    for (const slot of slots) {
      cursor -= slot.weight;
      if (cursor <= 0) return slot;
    }
    return slots[0];
  }

  private pickLeastUsed(slots: readonly ProviderSlot[]): ProviderSlot | undefined {
    if (slots.length === 0) return undefined;
    return [...slots].sort((a, b) => a.useCount - b.useCount)[0];
  }

  private pickRateLimitAware(slots: readonly ProviderSlot[]): ProviderSlot | undefined {
    if (slots.length === 0) return undefined;
    return [...slots].sort((a, b) => {
      if (a.cooldownUntil !== b.cooldownUntil) return a.cooldownUntil - b.cooldownUntil;
      return a.useCount - b.useCount;
    })[0];
  }
}

// ── Slot construction ────────────────────────────────────────────────

function buildProviderSlots(options: ResearchSearchEngineOptions): ProviderSlot[] {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const configured = options.search?.providers ?? [];
  const envDetected = detectSearchProviderEnvKeys();
  const merged = mergeProviderConfigs(configured, envDetected);

  const slots: ProviderSlot[] = [];
  let index = 0;

  for (const config of merged) {
    if (config.enabled === false) continue;
    const apiKey = resolveResearchApiKey(config);
    if (needsApiKey(config.kind) && apiKey === undefined) continue;

    const provider = createRemoteProvider(config, apiKey, fetchImpl, options);
    if (provider === undefined) continue;

    slots.push({
      id: `${config.kind}:${String(index)}`,
      kind: config.kind,
      label: config.label ?? config.kind,
      source: config.sourceHint ?? 'config',
      weight: config.weight ?? 1,
      rpm: config.rpm,
      provider,
      cooldownUntil: 0,
      useCount: 0,
      keyCursor: 0,
    });
    index += 1;
  }

  // Moonshot managed search (if configured) as a paid-tier peer.
  if (options.moonshot?.baseUrl !== undefined) {
    slots.push({
      id: `moonshot:${String(index)}`,
      kind: 'moonshot',
      label: 'moonshot',
      source: 'moonshot',
      weight: 1,
      rpm: undefined,
      provider: new MoonshotWebSearchProvider({
        baseUrl: options.moonshot.baseUrl,
        apiKey: options.moonshot.apiKey,
        defaultHeaders: options.moonshot.defaultHeaders,
        tokenProvider: options.moonshot.tokenProvider,
        fetchImpl,
      }),
      cooldownUntil: 0,
      useCount: 0,
      keyCursor: 0,
    });
    index += 1;
  }

  // Free local fallback always available unless explicitly disabled.
  if (options.search?.freeFallback !== false) {
    const local = new LocalWebSearchProvider({
      ...options.local,
      fetchImpl,
      urlFetcher: options.urlFetcher ?? options.local?.urlFetcher,
    });
    slots.push({
      id: `duckduckgo:${String(index)}`,
      kind: 'duckduckgo',
      label: 'duckduckgo',
      source: 'local',
      weight: 1,
      rpm: undefined,
      provider: local,
      cooldownUntil: 0,
      useCount: 0,
      keyCursor: 0,
    });
  }

  return slots;
}

type ProviderConfigWithHint = ResearchSearchProviderConfig & {
  readonly sourceHint?: ResearchSearchProviderStatus['source'];
};

function mergeProviderConfigs(
  configured: readonly ResearchSearchProviderConfig[],
  envDetected: readonly ResearchSearchProviderConfig[],
): ProviderConfigWithHint[] {
  const out: ProviderConfigWithHint[] = configured.map((c) => ({ ...c, sourceHint: 'config' as const }));
  const configuredKinds = new Set(configured.map((c) => c.kind));
  for (const env of envDetected) {
    if (configuredKinds.has(env.kind)) continue;
    out.push({ ...env, sourceHint: 'env' });
  }
  return out;
}

function needsApiKey(kind: ResearchSearchProviderKind): boolean {
  return kind === 'brave' || kind === 'tavily' || kind === 'exa' || kind === 'serper';
}

function createRemoteProvider(
  config: ResearchSearchProviderConfig,
  apiKey: string | undefined,
  fetchImpl: typeof fetch,
  options: ResearchSearchEngineOptions,
): WebSearchProvider | undefined {
  switch (config.kind) {
    case 'brave':
      if (apiKey === undefined) return undefined;
      return new BraveSearchAdapter(apiKey, fetchImpl);
    case 'tavily':
      if (apiKey === undefined) return undefined;
      return new TavilySearchAdapter(apiKey, fetchImpl);
    case 'exa':
      if (apiKey === undefined) return undefined;
      return new ExaSearchAdapter(apiKey, fetchImpl);
    case 'serper':
      if (apiKey === undefined) return undefined;
      return new SerperSearchAdapter(apiKey, fetchImpl);
    case 'searxng': {
      const baseUrl = config.baseUrl ?? options.local?.searxngUrl;
      if (baseUrl === undefined) return undefined;
      return new SearxngSearchAdapter(baseUrl, fetchImpl);
    }
    case 'duckduckgo':
      return new LocalWebSearchProvider({
        ...options.local,
        fetchImpl,
        urlFetcher: options.urlFetcher,
      });
    case 'moonshot':
      // Handled via options.moonshot in buildProviderSlots.
      return undefined;
    default:
      return undefined;
  }
}

// ── Remote adapters ──────────────────────────────────────────────────
class SearxngSearchAdapter implements WebSearchProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async search(
    query: string,
    options?: { limit?: number; includeContent?: boolean; toolCallId?: string },
  ): Promise<WebSearchResult[]> {
    const limit = clampInt(options?.limit ?? 5, 1, 20);
    const url = new URL('/search', this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    const response = await this.fetchImpl(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (response.status === 429) throw rateLimitError('searxng', response.status);
    if (response.status >= 400) {
      throw new Error(`SearXNG search failed: HTTP ${String(response.status)}`);
    }
    const json = (await response.json()) as { results?: Array<Record<string, unknown>> };
    const results = json.results ?? [];
    return results
      .slice(0, limit)
      .map((entry) =>
        buildResult({
          title: stringValue(entry['title']) ?? 'SearXNG result',
          url: stringValue(entry['url']) ?? '',
          snippet: stringValue(entry['content']) ?? '',
          date: stringValue(entry['publishedDate']) ?? stringValue(entry['published_date']),
        }),
      )
      .filter(hasUsableUrl);
  }
}


class BraveSearchAdapter implements WebSearchProvider {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async search(
    query: string,
    options?: { limit?: number; includeContent?: boolean; toolCallId?: string },
  ): Promise<WebSearchResult[]> {
    const limit = clampInt(options?.limit ?? 5, 1, 20);
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(limit));
    const response = await this.fetchImpl(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': this.apiKey,
      },
    });
    if (response.status === 429) throw rateLimitError('brave', response.status);
    if (response.status >= 400) {
      throw new Error(`Brave search failed: HTTP ${String(response.status)}`);
    }
    const json = (await response.json()) as {
      web?: { results?: Array<Record<string, unknown>> };
    };
    const results = json.web?.results ?? [];
    return results.slice(0, limit).map((entry) =>
      buildResult({
        title: stringValue(entry['title']) ?? 'Brave result',
        url: stringValue(entry['url']) ?? '',
        snippet: stringValue(entry['description']) ?? '',
        date: stringValue(entry['age']) ?? stringValue(entry['page_age']),
      }),
    ).filter(hasUsableUrl);
  }
}

class TavilySearchAdapter implements WebSearchProvider {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async search(
    query: string,
    options?: { limit?: number; includeContent?: boolean; toolCallId?: string },
  ): Promise<WebSearchResult[]> {
    const limit = clampInt(options?.limit ?? 5, 1, 20);
    const response = await this.fetchImpl('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        query,
        max_results: limit,
        // Always basic metadata here; full bodies are attached once after ranking.
        search_depth: 'basic',
        include_raw_content: false,
        include_answer: false,
      }),
    });
    if (response.status === 429) throw rateLimitError('tavily', response.status);
    if (response.status >= 400) {
      throw new Error(`Tavily search failed: HTTP ${String(response.status)}`);
    }
    const json = (await response.json()) as {
      results?: Array<Record<string, unknown>>;
    };
    const results = json.results ?? [];
    return results.slice(0, limit).map((entry) =>
      buildResult({
        title: stringValue(entry['title']) ?? 'Tavily result',
        url: stringValue(entry['url']) ?? '',
        snippet: stringValue(entry['content']) ?? '',
        date: stringValue(entry['published_date']),
        content:
          typeof entry['raw_content'] === 'string' && entry['raw_content'].trim().length > 0
            ? entry['raw_content']
            : undefined,
      }),
    ).filter(hasUsableUrl);
  }
}

class ExaSearchAdapter implements WebSearchProvider {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async search(
    query: string,
    options?: { limit?: number; includeContent?: boolean; toolCallId?: string },
  ): Promise<WebSearchResult[]> {
    const limit = clampInt(options?.limit ?? 5, 1, 20);
    const response = await this.fetchImpl('https://api.exa.ai/search', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
      },
      body: JSON.stringify({
        query,
        numResults: limit,
        type: 'auto',
        // Highlights only — full text is fetched selectively after ranking.
        contents: { highlights: true },
      }),
    });
    if (response.status === 429) throw rateLimitError('exa', response.status);
    if (response.status >= 400) {
      throw new Error(`Exa search failed: HTTP ${String(response.status)}`);
    }
    const json = (await response.json()) as {
      results?: Array<Record<string, unknown>>;
    };
    const results = json.results ?? [];
    return results.slice(0, limit).map((entry) => {
      const highlights = Array.isArray(entry['highlights'])
        ? entry['highlights'].filter((h): h is string => typeof h === 'string').join(' … ')
        : '';
      return buildResult({
        title: stringValue(entry['title']) ?? 'Exa result',
        url: stringValue(entry['url']) ?? stringValue(entry['id']) ?? '',
        snippet: highlights || stringValue(entry['text'])?.slice(0, 400) || '',
        date: stringValue(entry['publishedDate']),
        content: options?.includeContent === true ? stringValue(entry['text']) : undefined,
      });
    }).filter(hasUsableUrl);
  }
}

class SerperSearchAdapter implements WebSearchProvider {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async search(
    query: string,
    options?: { limit?: number; includeContent?: boolean; toolCallId?: string },
  ): Promise<WebSearchResult[]> {
    const limit = clampInt(options?.limit ?? 5, 1, 20);
    const response = await this.fetchImpl('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-API-KEY': this.apiKey,
      },
      body: JSON.stringify({ q: query, num: limit }),
    });
    if (response.status === 429) throw rateLimitError('serper', response.status);
    if (response.status >= 400) {
      throw new Error(`Serper search failed: HTTP ${String(response.status)}`);
    }
    const json = (await response.json()) as {
      organic?: Array<Record<string, unknown>>;
    };
    const results = json.organic ?? [];
    return results.slice(0, limit).map((entry) =>
      buildResult({
        title: stringValue(entry['title']) ?? 'Serper result',
        url: stringValue(entry['link']) ?? '',
        snippet: stringValue(entry['snippet']) ?? '',
        date: stringValue(entry['date']),
      }),
    ).filter(hasUsableUrl);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

class SearchRateLimitError extends Error {
  override readonly name = 'SearchRateLimitError';
  constructor(
    readonly provider: string,
    readonly status: number,
  ) {
    super(`${provider} rate limited: HTTP ${String(status)}`);
  }
}

function rateLimitError(provider: string, status: number): SearchRateLimitError {
  return new SearchRateLimitError(provider, status);
}

function isRateLimitError(error: unknown): boolean {
  if (error instanceof SearchRateLimitError) return true;
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return msg.includes('429') || msg.includes('rate limit') || msg.includes('too many requests');
}

function orderByCost(slots: readonly ProviderSlot[]): ProviderSlot[] {
  return [...slots].sort((a, b) => {
    const cost = (PROVIDER_COST_RANK[a.kind] ?? 50) - (PROVIDER_COST_RANK[b.kind] ?? 50);
    if (cost !== 0) return cost;
    return a.useCount - b.useCount;
  });
}

function truncateResultContent(result: WebSearchResult, maxChars: number): WebSearchResult {
  if (result.content === undefined || result.content.length <= maxChars) return result;
  return {
    ...result,
    content: `${result.content.slice(0, Math.max(0, maxChars - 20)).trimEnd()}\n\n[...truncated]`,
  };
}

function annotateSource(result: WebSearchResult, source: string): WebSearchResult {
  if (result.snippet.startsWith(`[${source}]`)) return result;
  return {
    ...result,
    snippet: result.snippet.length > 0 ? `[${source}] ${result.snippet}` : `[${source}]`,
  };
}

function buildResult(input: {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
  readonly date?: string | undefined;
  readonly content?: string | undefined;
}): WebSearchResult {
  const out: WebSearchResult = {
    title: input.title,
    url: input.url,
    snippet: input.snippet,
  };
  if (input.date !== undefined && input.date.length > 0) out.date = input.date;
  if (input.content !== undefined && input.content.length > 0) out.content = input.content;
  return out;
}

function hasUsableUrl(result: WebSearchResult): boolean {
  try {
    const parsed = new URL(result.url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function rankAndDedupe(results: readonly WebSearchResult[], query: string): WebSearchResult[] {
  const seen = new Set<string>();
  const scored = results
    .filter((result) => {
      const key = canonicalUrl(result.url);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((result) => ({ result, score: scoreResult(result, query) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.map((entry) => entry.result);
}

function scoreResult(result: WebSearchResult, query: string): number {
  const tokens = query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
  const hay = `${result.title} ${result.snippet}`.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (hay.includes(token)) score += 1;
  }
  if (result.content !== undefined && result.content.length > 0) score += 0.5;
  return score;
}

function canonicalUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return rawUrl;
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

async function runWithConcurrency<T>(
  jobs: readonly (() => Promise<T>)[],
  concurrency: number,
): Promise<T[]> {
  if (jobs.length === 0) return [];
  const results: T[] = new Array(jobs.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= jobs.length) return;
      results[index] = await jobs[index]!();
    }
  });
  await Promise.all(workers);
  return results;
}
