/**
 * Shared credential failover for side LLM calls (`Agent.generate`).
 *
 * Main-turn chat already loops candidates in {@link KosongLLM.chatWithRoute}.
 * Ultra Plan Seed Spec / ambiguity / classifiers / dream go through
 * `agent.generate` without that loop — so a quota-exhausted primary account
 * made Seed Spec extraction return null even when a secondary was healthy.
 *
 * This helper reuses the same `orderCandidates` / `recordFailure` /
 * `recordSuccess` surface so both paths share cooldown bookkeeping.
 */

import type {
  KosongLLMRoute,
  KosongLLMRouteCandidate,
  ProviderRouteFailure,
  ProviderRouteState,
} from './turn/kosong-llm';
import { classifyProviderRouteFailure } from './turn/kosong-llm';

export type SideGenerateCandidateAttempt<T> = {
  readonly candidate: KosongLLMRouteCandidate;
  readonly run: () => Promise<T>;
};

export type SideGenerateFailoverParams<T> = {
  readonly route: KosongLLMRoute;
  readonly routeState: ProviderRouteState;
  readonly attempts: readonly SideGenerateCandidateAttempt<T>[];
  readonly signal?: AbortSignal;
  readonly onCandidateFailed?: (info: {
    readonly candidate: KosongLLMRouteCandidate;
    readonly failure: ProviderRouteFailure;
    readonly error: unknown;
    readonly hasNext: boolean;
  }) => void;
  readonly onSuccess?: (candidate: KosongLLMRouteCandidate) => void;
  readonly onRouteStatusChanged?: () => void;
};

/**
 * Try each ordered candidate until one succeeds or all fail with a
 * failover-class error. Non-failover errors (e.g. bad request) rethrow immediately.
 */
export async function runSideGenerateWithSharedFailover<T>(
  params: SideGenerateFailoverParams<T>,
): Promise<T> {
  const ordered = params.routeState.orderCandidates(params.route);
  // Map ordered candidates back to attempt runners by credential+model key.
  const attemptByKey = new Map<string, SideGenerateCandidateAttempt<T>>();
  for (const attempt of params.attempts) {
    attemptByKey.set(sideCandidateKey(attempt.candidate), attempt);
  }

  let lastError: unknown;
  for (let index = 0; index < ordered.length; index++) {
    const candidate = ordered[index]!;
    const attempt = attemptByKey.get(sideCandidateKey(candidate));
    if (attempt === undefined) continue;

    try {
      const result = await attempt.run();
      params.routeState.recordSuccess(params.route, candidate);
      params.onSuccess?.(candidate);
      params.onRouteStatusChanged?.();
      return result;
    } catch (error) {
      lastError = error;
      if (params.signal?.aborted === true) throw error;

      const failure = classifyProviderRouteFailure(error, params.route.cooldownMs);
      if (failure === undefined) throw error;

      const switched = params.routeState.recordFailure(params.route, candidate, failure);
      if (switched) {
        params.onRouteStatusChanged?.();
      }

      const hasNext = index < ordered.length - 1;
      params.onCandidateFailed?.({ candidate, failure, error, hasNext });
      if (!hasNext) break;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('side generate failed for all provider-route candidates');
}

export function sideCandidateKey(candidate: KosongLLMRouteCandidate): string {
  // Mirror KosongLLM's candidateKey fields (no oauthRef on the route candidate type).
  const baseUrl = (candidate.provider as { readonly baseUrl?: unknown }).baseUrl;
  return [
    candidate.modelAlias,
    candidate.providerName,
    candidate.credentialLabel ?? '',
    candidate.provider.modelName,
    typeof baseUrl === 'string' && baseUrl.trim().length > 0 ? baseUrl.trim() : '',
  ].join('\n');
}
