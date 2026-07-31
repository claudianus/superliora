/**
 * LLM provider / route failover ↔ Agent.circuitBreakerRegistry wiring.
 *
 * Mirrors {@link attachResearchSearchCircuitBreakers}: record failures when
 * route failover or turn-level auto_retry fires; reset on success after recovery.
 */

import type { LioraErrorPayload } from '#/errors';
import type { CircuitBreakerRegistry } from '#/runtime/circuit-breaker';

import type { Agent } from './index';
import type {
  KosongLLMRoute,
  KosongLLMRouteCandidate,
  ProviderRouteFailure,
} from './turn/provider-route-types';

/** Never-Halt scope for a configured provider id (e.g. `llm:primary`). */
export function llmProviderScopeId(providerId: string): string {
  return `llm:${providerId}`;
}

/** Never-Halt scope for a model route key (e.g. `llm:k2`). */
export function llmRouteScopeId(routeKey: string): string {
  return `llm:${routeKey}`;
}

export function formatLlmProviderFailureReason(
  error: unknown,
  failure?: ProviderRouteFailure,
): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    const kind = failure?.kind;
    return kind !== undefined ? `${kind}: ${error.message.trim()}` : error.message.trim();
  }
  if (failure !== undefined) return failure.kind;
  return 'llm provider error';
}

export function formatLlmTurnFailureReason(error: LioraErrorPayload): string {
  const message = error.message?.trim();
  if (message !== undefined && message.length > 0) return message;
  return error.code;
}

export function resolveAgentLlmProviderId(agent: Agent): string | undefined {
  const alias = agent.config.modelAlias;
  if (alias === undefined) return undefined;
  return agent.kimiConfig?.models?.[alias]?.provider;
}

export type LlmProviderCircuitObserver = {
  readonly onFailure: (input: {
    readonly route: KosongLLMRoute;
    readonly candidate: KosongLLMRouteCandidate;
    readonly failure: ProviderRouteFailure;
    readonly error: unknown;
  }) => void;
  readonly onSuccess: (input: {
    readonly route: KosongLLMRoute;
    readonly candidate: KosongLLMRouteCandidate;
  }) => void;
};

export function createLlmProviderCircuitObserver(
  registry: CircuitBreakerRegistry,
  onChanged?: () => void,
): LlmProviderCircuitObserver {
  return {
    onFailure: ({ route, candidate, failure, error }) => {
      const reason = formatLlmProviderFailureReason(error, failure);
      const providerScope = llmProviderScopeId(candidate.providerName);
      const routeScope = llmRouteScopeId(route.key);
      registry.get(providerScope).recordFailure(reason);
      if (routeScope !== providerScope) {
        registry.get(routeScope).recordFailure(reason);
      }
      onChanged?.();
    },
    onSuccess: ({ route, candidate }) => {
      const providerScope = llmProviderScopeId(candidate.providerName);
      const routeScope = llmRouteScopeId(route.key);
      registry.get(providerScope).recordSuccess();
      if (routeScope !== providerScope) {
        registry.get(routeScope).recordSuccess();
      }
      onChanged?.();
    },
  };
}

/** Late-bind Agent registry onto KosongLLM / side-generate failover observers. */
export function attachLlmProviderCircuitBreakers(
  agent: Agent,
  onChanged?: () => void,
): LlmProviderCircuitObserver {
  return createLlmProviderCircuitObserver(agent.circuitBreakerRegistry, onChanged);
}

export function recordLlmTurnProviderFailure(agent: Agent, error: LioraErrorPayload): void {
  const providerId = resolveAgentLlmProviderId(agent);
  if (providerId === undefined) return;
  const reason = formatLlmTurnFailureReason(error);
  const registry = agent.circuitBreakerRegistry;
  const providerScope = llmProviderScopeId(providerId);
  registry.get(providerScope).recordFailure(reason);
  const routeKey = agent.config.modelAlias;
  if (routeKey !== undefined) {
    const routeScope = llmRouteScopeId(routeKey);
    if (routeScope !== providerScope) {
      registry.get(routeScope).recordFailure(reason);
    }
  }
  agent.emitStatusUpdated();
}

export function recordLlmTurnProviderSuccess(agent: Agent): void {
  const providerId = resolveAgentLlmProviderId(agent);
  if (providerId === undefined) return;
  const registry = agent.circuitBreakerRegistry;
  const providerScope = llmProviderScopeId(providerId);
  registry.get(providerScope).recordSuccess();
  const routeKey = agent.config.modelAlias;
  if (routeKey !== undefined) {
    const routeScope = llmRouteScopeId(routeKey);
    if (routeScope !== providerScope) {
      registry.get(routeScope).recordSuccess();
    }
  }
  agent.emitStatusUpdated();
}
