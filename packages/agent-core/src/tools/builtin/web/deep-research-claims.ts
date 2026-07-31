/**
 * DeepResearch citation + freshness gate — pure helpers.
 *
 * Builds structured claims from merged sources, demotes uncited or stale
 * entries, and exposes citation-coverage metrics for fixture gold-sets.
 */

export type DeepResearchFreshness = 'any' | 'day' | 'week' | 'month' | 'year';

export interface ClaimSourceInput {
  title: string;
  url: string;
  snippet: string;
  date?: string | undefined;
  hitCount: number;
}

export type DeepResearchConfidence = 'high' | 'medium' | 'low' | 'speculative';

export interface DeepResearchClaim {
  claim: string;
  sources: string[];
  confidence: DeepResearchConfidence;
  as_of?: string | undefined;
}

export const CITATION_COVERAGE_GOLD_THRESHOLD = 0.95;

const FRESHNESS_MAX_AGE_MS: Record<Exclude<DeepResearchFreshness, 'any'>, number> = {
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  year: 365 * 24 * 60 * 60 * 1000,
};

export function demoteConfidence(confidence: DeepResearchConfidence): DeepResearchConfidence {
  switch (confidence) {
    case 'high':
      return 'medium';
    case 'medium':
      return 'low';
    case 'low':
      return 'speculative';
    default:
      return 'speculative';
  }
}

export function parseResearchSourceDate(raw: string | undefined, now: Date = new Date()): Date | undefined {
  if (raw === undefined || raw.trim().length === 0) return undefined;
  const parsed = Date.parse(raw.trim());
  if (Number.isNaN(parsed)) return undefined;
  const date = new Date(parsed);
  if (date.getTime() > now.getTime() + 24 * 60 * 60 * 1000) return undefined;
  return date;
}

export function isSourceStaleForFreshness(
  asOf: Date | undefined,
  freshness: DeepResearchFreshness,
  now: Date = new Date(),
): boolean {
  if (freshness === 'any' || asOf === undefined) return false;
  const maxAge = FRESHNESS_MAX_AGE_MS[freshness];
  return now.getTime() - asOf.getTime() > maxAge;
}

export function baseConfidenceFromSource(source: ClaimSourceInput): DeepResearchConfidence {
  if (source.url.trim().length === 0) return 'speculative';
  if (source.hitCount >= 2) return 'high';
  if (source.date !== undefined && source.date.trim().length > 0) return 'medium';
  return 'low';
}

export function applyCitationGate(claim: DeepResearchClaim): DeepResearchClaim {
  const cited = claim.sources.some((url) => url.trim().length > 0);
  if (cited) return claim;
  return {
    ...claim,
    sources: [],
    confidence: 'speculative',
  };
}

export function applyFreshnessGate(
  claim: DeepResearchClaim,
  freshness: DeepResearchFreshness,
  now: Date = new Date(),
): DeepResearchClaim {
  if (freshness === 'any') return claim;

  const asOfDate = parseResearchSourceDate(claim.as_of, now);
  if (asOfDate === undefined) {
    return {
      ...claim,
      confidence: demoteConfidence(claim.confidence),
    };
  }

  if (!isSourceStaleForFreshness(asOfDate, freshness, now)) return claim;

  return {
    ...claim,
    confidence: demoteConfidence(demoteConfidence(claim.confidence)),
  };
}

export function filterClaimsByFreshness(
  claims: readonly DeepResearchClaim[],
  freshness: DeepResearchFreshness,
  now: Date = new Date(),
): DeepResearchClaim[] {
  if (freshness === 'any') return [...claims];

  return claims.filter((claim) => {
    const asOfDate = parseResearchSourceDate(claim.as_of, now);
    if (asOfDate === undefined) return true;
    return !isSourceStaleForFreshness(asOfDate, freshness, now) || claim.confidence !== 'speculative';
  });
}

export function buildClaimsFromSources(
  sources: readonly ClaimSourceInput[],
  options: {
    freshness?: DeepResearchFreshness;
    maxClaims?: number;
    now?: Date;
  } = {},
): DeepResearchClaim[] {
  const freshness = options.freshness ?? 'any';
  const now = options.now ?? new Date();
  const maxClaims = options.maxClaims ?? 6;

  const gated = sources.slice(0, maxClaims).map((source) => {
    const claimText = normalizeClaimText(source.snippet || source.title);
    const initial: DeepResearchClaim = {
      claim: claimText,
      sources: source.url.trim().length > 0 ? [source.url] : [],
      confidence: baseConfidenceFromSource(source),
      as_of: source.date?.trim() || undefined,
    };
    return applyFreshnessGate(applyCitationGate(initial), freshness, now);
  });

  return filterClaimsByFreshness(gated, freshness, now);
}

export function citationCoverageRatio(claims: readonly DeepResearchClaim[]): number {
  if (claims.length === 0) return 1;
  const cited = claims.filter((claim) => claim.sources.some((url) => url.trim().length > 0)).length;
  return cited / claims.length;
}

export function meetsCitationCoverageGoldSet(
  claims: readonly DeepResearchClaim[],
  sourcesAvailable: boolean,
  threshold: number = CITATION_COVERAGE_GOLD_THRESHOLD,
): boolean {
  if (!sourcesAvailable) return true;
  return citationCoverageRatio(claims) >= threshold;
}

export function formatStructuredClaimLine(claim: DeepResearchClaim): string {
  const sources =
    claim.sources.length === 0 ? '(none)' : claim.sources.join(', ');
  const asOf = claim.as_of !== undefined ? claim.as_of : '(unknown)';
  return `- [${claim.confidence}] ${truncateClaimText(claim.claim, 200)} | sources: ${sources} | as_of: ${asOf}`;
}

function normalizeClaimText(text: string): string {
  return text.replaceAll(/\s+/g, ' ').trim();
}

function truncateClaimText(text: string, maxLength: number): string {
  const normalized = normalizeClaimText(text);
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}
