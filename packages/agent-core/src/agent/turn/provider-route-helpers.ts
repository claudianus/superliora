import type {
  ProviderRouteRateLimitStatus,
} from '#/rpc';
import type {
  KosongLLMRouteCandidate,
  ProviderRouteFailureKind,
} from './provider-route-types';
import type { ChatProvider } from '@superliora/kosong';

export interface ProviderRouteFailureRecord {
  readonly kind: ProviderRouteFailureKind;
  readonly failedAt: number;
  readonly cooldownUntil: number;
}

export interface ProviderRouteCandidateStats {
  readonly successCount: number;
  readonly failureCount: number;
  readonly lastSuccessAt?: number;
  readonly lastLatencyMs?: number;
  readonly avgLatencyMs?: number;
  readonly lastFailureKind?: ProviderRouteFailureKind;
  readonly lastFailureAt?: number;
}

export interface ProviderRouteLocalUsageRecord {
  readonly windowStartedAt: number;
  readonly requestCount: number;
  readonly tokenCount: number;
}

export function candidateWeight(candidate: KosongLLMRouteCandidate): number {
  const weight = candidate.weight ?? 1;
  return Number.isInteger(weight) && weight > 0 ? weight : 1;
}

export function shuffleCandidates(
  candidates: readonly KosongLLMRouteCandidate[],
): readonly KosongLLMRouteCandidate[] {
  const shuffled = [...candidates];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!];
  }
  return shuffled;
}

interface RateLimitAwareCandidateOrder {
  readonly candidate: KosongLLMRouteCandidate;
  readonly index: number;
  readonly headroom?: number;
}

export function compareRateLimitAwareCandidates(
  left: RateLimitAwareCandidateOrder,
  right: RateLimitAwareCandidateOrder,
): number {
  const rankDiff = rateLimitHeadroomRank(left.headroom) - rateLimitHeadroomRank(right.headroom);
  if (rankDiff !== 0) return rankDiff;
  return (right.headroom ?? 0) - (left.headroom ?? 0) || left.index - right.index;
}

function rateLimitHeadroomRank(headroom: number | undefined): number {
  if (headroom === undefined) return 1;
  return headroom > 0 ? 0 : 2;
}

export function rateLimitHeadroom(
  rateLimits: readonly ProviderRouteRateLimitStatus[] | undefined,
): number | undefined {
  if (rateLimits === undefined || rateLimits.length === 0) return undefined;
  const headrooms: number[] = [];
  const now = Date.now();
  for (const rateLimit of rateLimits) {
    if (rateLimit.resetAt !== undefined && rateLimit.resetAt <= now) continue;
    if (rateLimit.remaining === undefined) continue;
    const remaining = Math.max(0, rateLimit.remaining);
    if (rateLimit.limit !== undefined && rateLimit.limit > 0) {
      headrooms.push(Math.min(1, remaining / rateLimit.limit));
    } else {
      headrooms.push(remaining > 0 ? 1 : 0);
    }
  }
  return headrooms.length === 0 ? undefined : Math.min(...headrooms);
}

export function normalizeLatencyMs(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value < 0) return undefined;
  return Math.round(value);
}

export function copyProviderRouteRateLimits(
  rateLimits: readonly ProviderRouteRateLimitStatus[],
): ProviderRouteRateLimitStatus[] {
  return rateLimits.map((rateLimit) => ({ ...rateLimit }));
}

export function sameProviderRouteRateLimits(
  left: readonly ProviderRouteRateLimitStatus[] | undefined,
  right: readonly ProviderRouteRateLimitStatus[],
): boolean {
  if (left === undefined || left.length !== right.length) return false;
  return left.every((leftLimit, index) => {
    const rightLimit = right[index]!;
    return (
      leftLimit.name === rightLimit.name &&
      leftLimit.limit === rightLimit.limit &&
      leftLimit.remaining === rightLimit.remaining &&
      leftLimit.resetAt === rightLimit.resetAt
    );
  });
}

export function candidateKey(candidate: KosongLLMRouteCandidate): string {
  return [
    candidate.modelAlias,
    candidate.providerName,
    candidate.credentialLabel ?? '',
    candidate.provider.modelName,
    providerBaseUrl(candidate.provider) ?? '',
  ].join('\n');
}

export function providerBaseUrl(provider: ChatProvider): string | undefined {
  const baseUrl = (provider as { readonly baseUrl?: unknown }).baseUrl;
  return typeof baseUrl === 'string' && baseUrl.trim().length > 0 ? baseUrl.trim() : undefined;
}

export function matchesPreferredCredential(
  preferredCredential: string | undefined,
  candidate: KosongLLMRouteCandidate,
): boolean {
  const preferred = preferredCredential?.trim();
  const label = candidate.credentialLabel?.trim();
  if (preferred === undefined || preferred.length === 0 || label === undefined || label.length === 0) {
    return false;
  }
  return (
    preferred === label ||
    preferred === `${candidate.modelAlias}:${label}` ||
    preferred === `${candidate.providerName}:${label}`
  );
}
