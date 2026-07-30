/**
 * Multi-provider deep-research search engine.
 *
 * Quality-first adaptive design:
 *   1. Snippets first, full page body only on explicit include_content.
 *   2. Auto fuses two ready remote providers when the call budget allows.
 *   3. Hard budget caps: max paid calls / content pages / content chars.
 *   4. Escalate to remaining/free providers only while result quality is thin.
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

import type { ResearchSearchRoutingStrategy } from '#/config/schema';
import type { UrlFetcher } from '../builtin/web/fetch-url';
import type { WebSearchProvider, WebSearchResult } from '../builtin/web/web-search';
import { clampInt, isRateLimitError } from './research-search-adapters';
import {
  fuseSearchResults,
  needsSearchEscalation,
  type SearchProviderBatch,
} from './research-search-fusion';
import {
  orderByCost,
  rankAndDedupe,
  runWithConcurrency,
  truncateResultContent,
} from './research-search-helpers';
import { buildProviderSlots, type ProviderSlot } from './research-search-slots';
import type { ResearchSearchEngineOptions, ResearchSearchStatus } from './research-search-types';

export type {
  ResearchSearchEngineOptions,
  ResearchSearchProviderStatus,
  ResearchSearchStatus,
} from './research-search-types';
export { detectSearchProviderEnvKeys, resolveResearchApiKey } from './research-search-env';

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
        results = await this.searchAdaptive(ready, trimmed, metadataOptions, limit);
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
        results = await this.searchAdaptive(ready, trimmed, metadataOptions, limit);
        break;
    }

    return this.maybeAttachContent(results, options);
  }

  /**
   * Quality-first adaptive routing (default `auto`):
   * fuse at least two ready remote slots when the call budget allows, then
   * escalate only while unique URL, query coverage, or domain diversity is thin.
   */
  private async searchAdaptive(
    slots: readonly ProviderSlot[],
    query: string,
    options: { limit?: number; includeContent?: boolean; toolCallId?: string } | undefined,
    limit: number,
  ): Promise<WebSearchResult[]> {
    const remote = orderByCost(
      slots.filter((slot) => slot.kind !== 'duckduckgo' && slot.source !== 'local'),
    );
    const free = slots.filter((slot) => slot.kind === 'duckduckgo' || slot.source === 'local');
    const targetCount = Math.min(limit, this.minResultsToStop);
    const batches: SearchProviderBatch[] = [];
    const initialCount = Math.min(remote.length, this.maxProviderCalls, 2);
    const initial = remote.slice(0, initialCount);

    if (initial.length > 0) {
      const initialBatches = await runWithConcurrency(
        initial.map((slot) => async (): Promise<SearchProviderBatch> => ({
          providerId: slot.id,
          results: await this.searchSlot(slot, query, options, limit),
        })),
        this.concurrency,
      );
      batches.push(...initialBatches);
    }

    let fusion = fuseSearchResults(batches, query, limit);
    let remoteCalls = initial.length;
    for (const slot of remote.slice(initial.length)) {
      if (remoteCalls >= this.maxProviderCalls || !needsSearchEscalation(fusion, targetCount)) {
        break;
      }
      batches.push({
        providerId: slot.id,
        results: await this.searchSlot(slot, query, options, limit),
      });
      remoteCalls += 1;
      fusion = fuseSearchResults(batches, query, limit);
    }

    // If no remote calls were made (e.g., no remote slots available), always try free slots
    // regardless of freeFallback setting to avoid returning empty results.
    const shouldTryFree =
      (this.freeFallback && needsSearchEscalation(fusion, targetCount)) ||
      (initial.length === 0 && free.length > 0);

    if (shouldTryFree) {
      for (const slot of free) {
        batches.push({
          providerId: slot.id,
          results: await this.searchSlot(slot, query, options, limit),
        });
        fusion = fuseSearchResults(batches, query, limit);
        if (!needsSearchEscalation(fusion, targetCount)) break;
      }
    }

    return fusion.results;
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
      return results;
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
    return slots.toSorted((a, b) => a.useCount - b.useCount)[0];
  }

  private pickRateLimitAware(slots: readonly ProviderSlot[]): ProviderSlot | undefined {
    if (slots.length === 0) return undefined;
    return slots.toSorted((a, b) => {
      if (a.cooldownUntil !== b.cooldownUntil) return a.cooldownUntil - b.cooldownUntil;
      return a.useCount - b.useCount;
    })[0];
  }
}
