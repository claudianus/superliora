import type { WebSearchResult } from '../builtin/web/web-search';

const RRF_RANK_CONSTANT = 60;
const MIN_QUERY_TOKEN_COVERAGE = 0.5;
const MAX_RESULTS_PER_DOMAIN = 2;

const TRACKING_QUERY_PARAMS = new Set([
  'dclid',
  'fbclid',
  'gclid',
  'gbraid',
  'igshid',
  'mc_cid',
  'mc_eid',
  'msclkid',
  'mkt_tok',
  'oly_anon_id',
  'oly_enc_id',
  'vero_conv',
  'vero_id',
  'wbraid',
  '_hsenc',
  '_hsmi',
]);

export interface SearchProviderBatch {
  readonly providerId: string;
  readonly results: readonly WebSearchResult[];
}

export interface SearchFusionMetrics {
  readonly uniqueUrlCount: number;
  readonly domainCount: number;
  readonly queryTokenCoverage: number;
}

export interface SearchFusionResult {
  readonly results: WebSearchResult[];
  readonly metrics: SearchFusionMetrics;
}

interface InternalSearchCandidate {
  readonly canonicalUrl: string;
  readonly providerIds: Set<string>;
  readonly firstProviderIndex: number;
  readonly firstResultIndex: number;
  bestLocalRank: number;
  relevance: number;
  result: WebSearchResult;
  rrfScore: number;
}

export function canonicalizeSearchUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return rawUrl;

    url.hash = '';
    if (
      (url.protocol === 'http:' && url.port === '80') ||
      (url.protocol === 'https:' && url.port === '443')
    ) {
      url.port = '';
    }
    const trackingKeys = new Set<string>();
    for (const key of url.searchParams.keys()) {
      if (isTrackingQueryParam(key)) trackingKeys.add(key);
    }
    for (const key of trackingKeys) url.searchParams.delete(key);
    url.searchParams.sort();

    const pathname = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '');
    return `${url.protocol}//${url.host}${pathname}${url.search}`;
  } catch {
    return rawUrl;
  }
}

export function fuseSearchResults(
  batches: readonly SearchProviderBatch[],
  query: string,
  limit: number,
): SearchFusionResult {
  const queryTokens = tokenizeQuery(query);
  const candidates = new Map<string, InternalSearchCandidate>();

  batches.forEach((batch, providerIndex) => {
    const providerSeen = new Set<string>();
    batch.results.forEach((result, resultIndex) => {
      const canonicalUrl = canonicalizeSearchUrl(result.url);
      if (providerSeen.has(canonicalUrl)) return;
      providerSeen.add(canonicalUrl);

      const localRank = resultIndex + 1;
      const relevance = scoreQueryRelevance(result, queryTokens);
      const normalizedResult = { ...result, url: canonicalUrl };
      const existing = candidates.get(canonicalUrl);
      if (existing === undefined) {
        candidates.set(canonicalUrl, {
          canonicalUrl,
          providerIds: new Set([batch.providerId]),
          firstProviderIndex: providerIndex,
          firstResultIndex: resultIndex,
          bestLocalRank: localRank,
          relevance,
          result: normalizedResult,
          rrfScore: reciprocalRank(localRank),
        });
        return;
      }

      existing.providerIds.add(batch.providerId);
      existing.rrfScore += reciprocalRank(localRank);
      existing.bestLocalRank = Math.min(existing.bestLocalRank, localRank);
      if (isPreferredRepresentative(normalizedResult, relevance, existing)) {
        existing.result = normalizedResult;
        existing.relevance = relevance;
      }
    });
  });

  const ranked = [...candidates.values()].toSorted(compareCandidates);
  const diversified = diversifyByDomain(ranked, limit);
  const results = diversified.map((candidate) => candidate.result);
  return {
    results,
    metrics: {
      uniqueUrlCount: candidates.size,
      domainCount: new Set(diversified.map((candidate) => domainOf(candidate.canonicalUrl))).size,
      queryTokenCoverage: queryCoverage(results, queryTokens),
    },
  };
}

export function needsSearchEscalation(
  fusion: SearchFusionResult,
  targetCount: number,
): boolean {
  if (fusion.metrics.uniqueUrlCount < targetCount) return true;
  if (targetCount > 1 && fusion.metrics.domainCount < 2) return true;
  return fusion.metrics.queryTokenCoverage < MIN_QUERY_TOKEN_COVERAGE;
}

function isTrackingQueryParam(key: string): boolean {
  const normalized = key.toLowerCase();
  return normalized.startsWith('utm_') || TRACKING_QUERY_PARAMS.has(normalized);
}

function reciprocalRank(rank: number): number {
  return 1 / (RRF_RANK_CONSTANT + rank);
}

function tokenizeQuery(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter((token) => token.length > 1);
}

function scoreQueryRelevance(result: WebSearchResult, queryTokens: readonly string[]): number {
  const haystack = `${result.title} ${result.snippet}`.toLowerCase();
  let score = 0;
  for (const token of queryTokens) {
    if (haystack.includes(token)) score += 1;
  }
  if (result.content !== undefined && result.content.length > 0) score += 0.5;
  return score;
}

function isPreferredRepresentative(
  result: WebSearchResult,
  relevance: number,
  existing: InternalSearchCandidate,
): boolean {
  if (relevance !== existing.relevance) return relevance > existing.relevance;
  const hasContent = result.content !== undefined && result.content.length > 0;
  const existingHasContent =
    existing.result.content !== undefined && existing.result.content.length > 0;
  if (hasContent !== existingHasContent) return hasContent;
  return result.snippet.length > existing.result.snippet.length;
}

function compareCandidates(a: InternalSearchCandidate, b: InternalSearchCandidate): number {
  if (a.rrfScore !== b.rrfScore) return b.rrfScore - a.rrfScore;
  if (a.providerIds.size !== b.providerIds.size) return b.providerIds.size - a.providerIds.size;
  if (a.relevance !== b.relevance) return b.relevance - a.relevance;
  if (a.bestLocalRank !== b.bestLocalRank) return a.bestLocalRank - b.bestLocalRank;
  if (a.firstProviderIndex !== b.firstProviderIndex) {
    return a.firstProviderIndex - b.firstProviderIndex;
  }
  if (a.firstResultIndex !== b.firstResultIndex) return a.firstResultIndex - b.firstResultIndex;
  return a.canonicalUrl.localeCompare(b.canonicalUrl);
}

function diversifyByDomain(
  ranked: readonly InternalSearchCandidate[],
  limit: number,
): InternalSearchCandidate[] {
  const selected: InternalSearchCandidate[] = [];
  const deferred: InternalSearchCandidate[] = [];
  const domainCounts = new Map<string, number>();

  for (const candidate of ranked) {
    const domain = domainOf(candidate.canonicalUrl);
    const count = domainCounts.get(domain) ?? 0;
    if (count >= MAX_RESULTS_PER_DOMAIN) {
      deferred.push(candidate);
      continue;
    }
    selected.push(candidate);
    domainCounts.set(domain, count + 1);
    if (selected.length === limit) return selected;
  }

  for (const candidate of deferred) {
    selected.push(candidate);
    if (selected.length === limit) break;
  }
  return selected;
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return url;
  }
}

function queryCoverage(results: readonly WebSearchResult[], queryTokens: readonly string[]): number {
  if (queryTokens.length === 0) return 1;
  const haystack = results
    .map((result) => `${result.title} ${result.snippet}`.toLowerCase())
    .join(' ');
  const covered = queryTokens.filter((token) => haystack.includes(token)).length;
  return covered / queryTokens.length;
}
