import type { SessionStatusResponse } from '@superliora/protocol';

import type { ICoreProcessService } from '../coreProcess/coreProcess';

import { SessionNotFoundError } from './session';

export async function buildSessionStatusResponse(
  id: string,
  core: ICoreProcessService,
  computeStatus: (sessionId: string) => SessionStatusResponse['status'],
): Promise<SessionStatusResponse> {
  const all = await core.rpc.listSessions({});
  const summary = all.find((s) => s.id === id);
  if (summary === undefined) {
    throw new SessionNotFoundError(id);
  }
  await core.rpc.resumeSession({ sessionId: id });

  const [
    config,
    context,
    permission,
    providerRoute,
    usage,
    circuitBreakers,
    cacheFrozen,
    cacheFreezeViolations,
    oauth,
  ] = await Promise.all([
    core.rpc.getConfig({ sessionId: id, agentId: 'main' }),
    core.rpc.getContext({ sessionId: id, agentId: 'main' }),
    core.rpc.getPermission({ sessionId: id, agentId: 'main' }),
    core.rpc.getProviderRouteStatus({ sessionId: id, agentId: 'main' }),
    core.rpc.getUsage({ sessionId: id, agentId: 'main' }).catch(() => undefined),
    core.rpc.getCircuitBreakers({ sessionId: id, agentId: 'main' }).catch(() => undefined),
    core.rpc.getCacheFrozen({ sessionId: id, agentId: 'main' }).catch(() => undefined),
    core.rpc.getCacheFreezeViolations({ sessionId: id, agentId: 'main' }).catch(() => undefined),
    core.rpc.getOAuthStatus({ sessionId: id, agentId: 'main' }).catch(() => undefined),
  ]);

  const maxContextTokens = config.modelCapabilities?.max_context_tokens ?? 0;
  const contextTokens = context.tokenCount;
  const contextUsage = maxContextTokens > 0 ? contextTokens / maxContextTokens : 0;

  return {
    status: computeStatus(id),
    model: config.modelAlias ?? config.provider?.model,
    thinking_level: config.thinkingLevel,
    permission: permission.mode,
    context_tokens: contextTokens,
    max_context_tokens: maxContextTokens,
    context_usage: contextUsage,
    cache_hit_rate: usage?.cacheHitRate,
    cache_warm_streak: usage?.cacheWarmStreak,
    ...(cacheFrozen !== undefined ? { cache_frozen: cacheFrozen } : {}),
    ...(cacheFreezeViolations !== undefined
      ? { cache_freeze_violations: cacheFreezeViolations }
      : {}),
    ...(circuitBreakers !== undefined
      ? {
          circuit_breakers: {
            closed: circuitBreakers.closed,
            open: circuitBreakers.open,
            halfOpen: circuitBreakers.halfOpen,
            ...(circuitBreakers.lastTripReason !== undefined
              ? { lastTripReason: circuitBreakers.lastTripReason }
              : {}),
            ...(circuitBreakers.scopes !== undefined
              ? {
                  scopes: circuitBreakers.scopes.map((scope) => ({
                    id: scope.id,
                    state: scope.state,
                    failures: scope.failures,
                    ...(scope.lastTripReason !== undefined
                      ? { lastTripReason: scope.lastTripReason }
                      : {}),
                  })),
                }
              : {}),
          },
        }
      : {}),
    provider_route: providerRoute,
    oauth:
      oauth === undefined
        ? undefined
        : {
            ...(oauth.poolSize !== undefined ? { pool_size: oauth.poolSize } : {}),
            ...(oauth.nextRefreshAtMs !== undefined
              ? { next_refresh_at_ms: oauth.nextRefreshAtMs }
              : {}),
          },
  };
}
