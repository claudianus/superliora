import type { SessionStatusResponse } from '@superliora/protocol';

import type { ICoreProcessService } from '../coreProcess/coreProcess';
import type { IPromptService } from '../prompt/prompt';

import { SessionNotFoundError } from './session';

export async function buildSessionStatusResponse(
  id: string,
  core: ICoreProcessService,
  promptService: IPromptService,
  computeStatus: (sessionId: string) => SessionStatusResponse['status'],
): Promise<SessionStatusResponse> {
  const all = await core.rpc.listSessions({});
  const summary = all.find((s) => s.id === id);
  if (summary === undefined) {
    throw new SessionNotFoundError(id);
  }

  const [
    config,
    context,
    permission,
    plan,
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
    core.rpc.getPlan({ sessionId: id, agentId: 'main' }),
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

  const agentState = promptService.getAgentStateSnapshot(id);

  const contextOS = context.contextOS;
  return {
    status: computeStatus(id),
    model: config.modelAlias ?? config.provider?.model,
    thinking_level: config.thinkingLevel,
    permission: permission.mode,
    plan_mode: plan !== null,
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
    role_models:
      config.roleModels === undefined
        ? undefined
        : {
            compaction: config.roleModels.compaction ?? null,
            completion: config.roleModels.completion ?? null,
            exploration: config.roleModels.exploration ?? null,
            coding: config.roleModels.coding ?? null,
            planning: config.roleModels.planning ?? null,
            debugging: config.roleModels.debugging ?? null,
          },
    provider_route: providerRoute,
    context_os:
      contextOS === undefined
        ? undefined
        : {
            page_count: contextOS.pageCount,
            ready_page_count: contextOS.readyPageCount,
            needs_rehydration_page_count: contextOS.needsRehydrationPageCount,
            at_risk_page_count: contextOS.atRiskPageCount,
            missing_evidence_page_count: contextOS.missingEvidencePageCount,
            evidence_id_recall_score: contextOS.evidenceIdRecallScore,
            latest_continuity_status: contextOS.latestContinuityStatus,
          },
    micro_compaction:
      context.microCompaction === undefined
        ? undefined
        : {
            total: context.microCompaction.total,
            last_trigger: context.microCompaction.lastTrigger,
            last_context_usage_ratio: context.microCompaction.lastContextUsageRatio,
            by_trigger: { ...context.microCompaction.byTrigger },
          },
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
