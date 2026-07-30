import type { AgentEvent, ProviderRouteStatus, UsageStatus } from '#/rpc';

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
        readonly lastTrigger: string | undefined;
        readonly lastContextUsageRatio: number | undefined;
        readonly byTrigger: Record<string, number>;
      };
    };
  };
  readonly planMode: { readonly isActive: boolean };
  readonly swarmMode: { readonly isActive: boolean };
  readonly premiumQuality: { isEnabled(): boolean };
  readonly orchestratorMode: boolean;
  readonly orchestratorWorkers: ReadonlyMap<
    string,
    {
      readonly id: string;
      readonly description: string;
      readonly status: string;
      readonly tokenUsage?: { readonly output?: number | undefined } | undefined;
    }
  >;
  readonly permission: { readonly mode: string };
  readonly dream: { snapshot(): unknown } | null;
}

export function buildAgentStatusUpdatedEvent(host: AgentStatusUpdatedHost): AgentEvent {
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

  return {
    type: 'agent.status.updated',
    model: host.config.model,
    contextTokens,
    maxContextTokens,
    contextUsage,
    planMode: host.planMode.isActive,
    swarmMode: host.swarmMode.isActive,
    premiumQualityMode: host.premiumQuality.isEnabled(),
    orchestratorMode: host.orchestratorMode || undefined,
    orchestratorWorkers:
      host.orchestratorMode && host.orchestratorWorkers.size > 0
        ? [...host.orchestratorWorkers.values()].map((w) => ({
            id: w.id,
            description: w.description,
            status: w.status,
            tokenOutput: w.tokenUsage?.output,
          }))
        : undefined,
    permission: host.permission.mode,
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
            latestContinuityStatus: contextOSHealth.latestContinuityStatus,
          },
    microCompaction:
      microSnap.total === 0
        ? null
        : {
            total: microSnap.total,
            lastTrigger: microSnap.lastTrigger,
            lastContextUsageRatio: microSnap.lastContextUsageRatio,
            byTrigger: microSnap.byTrigger,
          },
    autoDream: host.dream === null ? null : host.dream.snapshot(),
  };
}

export function durableTraceRecordType(
  eventType: AgentEvent['type'],
): 'subagent.lifecycle' | 'ultrawork.event' | undefined {
  if (eventType.startsWith('subagent.')) return 'subagent.lifecycle';
  if (eventType.startsWith('ultrawork.')) return 'ultrawork.event';
  return undefined;
}
