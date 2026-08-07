import type { AgentStatusUpdatedEvent } from '@superliora/protocol';
import type { CircuitBreakerStatus } from '@superliora/protocol';
import type { ProviderRouteStatus, UsageStatus } from '#/rpc';
import { STALE_INTERVENTION_AGE_MS, type PermissionMode } from './permission';
import type { MicroTriggerKind } from './compaction/micro';

/** Minimal host surface for building `agent.status.updated` payloads. */
export interface AgentStatusUpdatedHost {
  readonly context: { readonly tokenCount: number };
  readonly config: {
    readonly hasModel: boolean;
    readonly model: string;
    readonly modelCapabilities: { readonly max_context_tokens?: number | undefined };
  };
  readonly usage: { status(): UsageStatus | undefined };
  providerRouteStatus(): ProviderRouteStatus | null;
  readonly contextOS: {
    health(): {
      readonly pageCount: number;
      readonly readyPageCount: number;
      readonly needsRehydrationPageCount: number;
      readonly atRiskPageCount: number;
      readonly missingEvidencePageCount: number;
      readonly evidenceIdRecallScore: number;
      readonly latestContinuityStatus: string | undefined;
    };
  };
  readonly microCompaction: {
    readonly triggers: {
      snapshot(): {
        readonly total: number;
        readonly lastTrigger: MicroTriggerKind | null | undefined;
        readonly lastContextUsageRatio: number | null | undefined;
        readonly byTrigger: Record<string, number>;
      };
    };
  };
  readonly planMode: { readonly isActive: boolean };
  readonly premiumQuality: { isEnabled(): boolean };
  readonly permission: {
    readonly mode: string;
    readonly interventionQueue: { snapshot(): { readonly count: number } };
    touchInterventionQueueForStatus(nowMs?: number): void;
    staleInterventionCount(maxAgeMs: number, nowMs?: number): number;
    oldestInterventionAgeMs(nowMs?: number): number | undefined;
  };
  circuitBreakerStatus(): CircuitBreakerStatus | undefined;
  readonly dream: { snapshot(): unknown } | null;
}

export function buildAgentStatusUpdatedEvent(host: AgentStatusUpdatedHost): AgentStatusUpdatedEvent {
  const contextTokens = host.context.tokenCount;
  const maxContextTokens = host.config.modelCapabilities.max_context_tokens;
  const contextUsage =
    maxContextTokens !== undefined && maxContextTokens > 0
      ? contextTokens / maxContextTokens
      : undefined;
  const usage = host.usage.status();
  const providerRoute = host.providerRouteStatus();
  const contextOSHealth = host.contextOS.health();
  const microSnap = host.microCompaction.triggers.snapshot();
  host.permission.touchInterventionQueueForStatus();
  const pendingInterventions = host.permission.interventionQueue.snapshot().count;
  const staleInterventions = host.permission.staleInterventionCount(STALE_INTERVENTION_AGE_MS);
  const oldestInterventionAgeMs =
    pendingInterventions > 0 ? host.permission.oldestInterventionAgeMs() : undefined;
  const circuitBreakers = host.circuitBreakerStatus();

  return {
    type: 'agent.status.updated',
    model: host.config.model,
    contextTokens,
    maxContextTokens,
    contextUsage,
    planMode: host.planMode.isActive,
    premiumQualityMode: host.premiumQuality.isEnabled(),
    permission: host.permission.mode as PermissionMode,
    usage,
    providerRoute,
    contextOS:
      contextOSHealth.pageCount === 0
        ? null
        : {
            pageCount: contextOSHealth.pageCount,
            readyPageCount: contextOSHealth.readyPageCount,
            needsRehydrationPageCount: contextOSHealth.needsRehydrationPageCount,
            atRiskPageCount: contextOSHealth.atRiskPageCount,
            missingEvidencePageCount: contextOSHealth.missingEvidencePageCount,
            evidenceIdRecallScore: contextOSHealth.evidenceIdRecallScore,
            latestContinuityStatus: contextOSHealth.latestContinuityStatus ?? '',
          },
    microCompaction:
      microSnap.total === 0
        ? null
        : {
            total: microSnap.total,
            lastTrigger: microSnap.lastTrigger ?? null,
            lastContextUsageRatio: microSnap.lastContextUsageRatio ?? null,
            byTrigger: microSnap.byTrigger,
          },
    autoDream:
      host.dream === null
        ? null
        : (host.dream.snapshot() as AgentStatusUpdatedEvent['autoDream']),
    ...(pendingInterventions > 0 ? { pendingInterventions } : {}),
    ...(staleInterventions > 0 ? { staleInterventions } : {}),
    ...(oldestInterventionAgeMs !== undefined ? { oldestInterventionAgeMs } : {}),
    ...(circuitBreakers !== undefined ? { circuitBreakers } : {}),
  };
}

export function durableTraceRecordType(
  eventType: string,
): 'subagent.lifecycle' | undefined {
  return eventType.startsWith('subagent.') ? 'subagent.lifecycle' : undefined;
}
