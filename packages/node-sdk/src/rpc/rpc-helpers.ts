import {
  ErrorCodes,
  makeErrorPayload,
  type CoreAPI,
  type Event,
  type ProviderRouteStatus,
  type RPCMethods,
} from '@superliora/agent-core';

import type { MaybePromise } from '#/session/events';
import type { SessionStatus } from '#/session/types';

export type ResolvedCoreAPI = RPCMethods<CoreAPI>;

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Shared shape for the reverse-RPC bridges (`requestApproval`,
 * `requestQuestion`, `requestCredential`): all three look up a
 * per-session handler, fall back to a canonical "no handler" result
 * when none is registered, invoke the handler, and on a thrown error
 * emit an `error` event before falling back to a canonical
 * "handler failed" result. Extracted so the three call sites in
 * {@link SDKRpcClientBase} stay one-liners and the fallback/telemetry
 * policy lives in one place.
 */
export async function invokeInteractionHandler<
  TRequest extends { sessionId: string; agentId: string },
  TResult,
>(
  handler: ((request: TRequest) => MaybePromise<TResult>) | undefined,
  request: TRequest,
  options: {
    readonly errorCode: (typeof ErrorCodes)[keyof typeof ErrorCodes];
    readonly notRegisteredResult: TResult;
    readonly errorResult: TResult;
    readonly emitEvent: (event: Event) => void;
  },
): Promise<TResult> {
  if (handler === undefined) return options.notRegisteredResult;

  try {
    return await handler(request);
  } catch (error) {
    options.emitEvent({
      type: 'error',
      sessionId: request.sessionId,
      agentId: request.agentId,
      ...makeErrorPayload(options.errorCode, errorMessage(error)),
    });
    return options.errorResult;
  }
}

/** Per-facet results fetched in parallel by `SDKRpcClientBase.getStatus`. */
export interface SessionStatusFacets {
  readonly config: Awaited<ReturnType<ResolvedCoreAPI['getConfig']>>;
  readonly context: Awaited<ReturnType<ResolvedCoreAPI['getContext']>>;
  readonly permission: Awaited<ReturnType<ResolvedCoreAPI['getPermission']>>;
  readonly plan: Awaited<ReturnType<ResolvedCoreAPI['getPlan']>>;
  readonly swarmMode: Awaited<ReturnType<ResolvedCoreAPI['getSwarmMode']>> | undefined;
  readonly premiumQualityMode:
    | Awaited<ReturnType<ResolvedCoreAPI['getPremiumQuality']>>
    | undefined;
  readonly usage: Awaited<ReturnType<ResolvedCoreAPI['getUsage']>> | undefined;
  readonly providerRouteStatus: ProviderRouteStatus | null;
  readonly circuitBreakers: Awaited<ReturnType<ResolvedCoreAPI['getCircuitBreakers']>> | undefined;
  readonly cacheFrozen: Awaited<ReturnType<ResolvedCoreAPI['getCacheFrozen']>> | undefined;
  readonly parallelTools: Awaited<ReturnType<ResolvedCoreAPI['getParallelToolsStatus']>> | undefined;
  readonly oauth: Awaited<ReturnType<ResolvedCoreAPI['getOAuthStatus']>> | undefined;
}

/**
 * Assemble the {@link SessionStatus} wire shape from the parallel-fetched
 * facets in `SDKRpcClientBase.getStatus`. Individual facet fetches may
 * have already degraded to `undefined` (or `null` for
 * `providerRouteStatus`) upstream — this function only combines and
 * derives, it never fetches.
 */
export function buildSessionStatus(facets: SessionStatusFacets): SessionStatus {
  const {
    config,
    context,
    permission,
    plan,
    swarmMode,
    premiumQualityMode,
    usage,
    providerRouteStatus,
    circuitBreakers,
    cacheFrozen,
    parallelTools,
    oauth,
  } = facets;
  const maxContextTokens = config.modelCapabilities?.max_context_tokens ?? 0;
  const contextTokens = context.tokenCount;
  const contextUsage = maxContextTokens > 0 ? contextTokens / maxContextTokens : 0;
  const hasUsage =
    usage !== undefined &&
    (usage.byModel !== undefined || usage.total !== undefined || usage.currentTurn !== undefined);
  return {
    model: config.modelAlias ?? config.provider?.model,
    thinkingLevel: config.thinkingLevel,
    permission: permission.mode,
    planMode: plan !== null,
    swarmMode,
    premiumQualityMode,
    contextTokens,
    maxContextTokens,
    contextUsage,
    cacheHitRate: usage?.cacheHitRate,
    cacheWarmStreak: usage?.cacheWarmStreak,
    ...(cacheFrozen !== undefined ? { cacheFrozen } : {}),
    ...(parallelTools !== undefined
      ? { parallelToolsInFlight: parallelTools.parallelToolsInFlight }
      : {}),
    ...(parallelTools?.maxParallelTools !== undefined
      ? { maxParallelTools: parallelTools.maxParallelTools }
      : {}),
    ...(permission.pendingInterventions !== undefined
      ? { pendingInterventions: permission.pendingInterventions }
      : {}),
    ...(permission.staleInterventions !== undefined
      ? { staleInterventions: permission.staleInterventions }
      : {}),
    ...(permission.oldestInterventionAgeMs !== undefined
      ? { oldestInterventionAgeMs: permission.oldestInterventionAgeMs }
      : {}),
    ...(circuitBreakers !== undefined ? { circuitBreakers } : {}),
    roleModels: config.roleModels,
    usage: hasUsage ? usage : undefined,
    providerRouteStatus,
    contextOS: context.contextOS,
    autoDream: context.autoDream,
    ...(oauth !== undefined ? { oauth } : {}),
  };
}
