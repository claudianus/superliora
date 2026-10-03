import type { AgentStatusUpdatedEvent, CircuitBreakerStatus } from '@superliora/protocol';
import type { ProviderRouteStatus, UsageStatus } from '#/rpc';
import { STALE_INTERVENTION_AGE_MS, type PermissionMode } from './permission';

export interface AgentStatusUpdatedHost {
  readonly context: { readonly tokenCount: number };
  readonly config: {
    readonly model: string;
    readonly modelCapabilities: { readonly max_context_tokens?: number };
  };
  readonly usage: { status(): UsageStatus | undefined };
  providerRouteStatus(): ProviderRouteStatus | null;
  readonly permission: {
    readonly mode: PermissionMode;
    readonly interventionQueue: { snapshot(): { readonly count: number } };
    touchInterventionQueueForStatus(nowMs?: number): void;
    staleInterventionCount(maxAgeMs: number, nowMs?: number): number;
    oldestInterventionAgeMs(nowMs?: number): number | undefined;
  };
  circuitBreakerStatus(): CircuitBreakerStatus | undefined;
}

export function buildAgentStatusUpdatedEvent(host: AgentStatusUpdatedHost): AgentStatusUpdatedEvent {
  const contextTokens = host.context.tokenCount;
  const maxContextTokens = host.config.modelCapabilities.max_context_tokens;
  host.permission.touchInterventionQueueForStatus();
  const pendingInterventions = host.permission.interventionQueue.snapshot().count;
  const staleInterventions = host.permission.staleInterventionCount(STALE_INTERVENTION_AGE_MS);
  const oldestInterventionAgeMs = pendingInterventions > 0 ? host.permission.oldestInterventionAgeMs() : undefined;
  const circuitBreakers = host.circuitBreakerStatus();
  return {
    type: 'agent.status.updated',
    model: host.config.model,
    contextTokens,
    maxContextTokens,
    contextUsage: maxContextTokens !== undefined && maxContextTokens > 0 ? contextTokens / maxContextTokens : undefined,
    permission: host.permission.mode,
    usage: host.usage.status(),
    providerRoute: host.providerRouteStatus(),
    ...(pendingInterventions > 0 ? { pendingInterventions } : {}),
    ...(staleInterventions > 0 ? { staleInterventions } : {}),
    ...(oldestInterventionAgeMs !== undefined ? { oldestInterventionAgeMs } : {}),
    ...(circuitBreakers !== undefined ? { circuitBreakers } : {}),
  };
}

export function durableTraceRecordType(eventType: string): 'subagent.lifecycle' | undefined {
  return eventType.startsWith('subagent.') && eventType !== 'subagent.tool_progress' ? 'subagent.lifecycle' : undefined;
}
