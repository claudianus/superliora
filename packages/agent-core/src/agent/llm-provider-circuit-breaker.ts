/** Record native provider / route outcomes in Agent.circuitBreakerRegistry. */

import type { CircuitBreakerRegistry } from '#/runtime/circuit-breaker';

import type { Agent } from './index';
import type {
  KosongLLMRoute,
  KosongLLMRouteCandidate,
  ProviderRouteFailure,
} from './turn/provider-route-types';

/** Never-Halt scope for a configured provider id (e.g. `llm:primary`). */
function llmProviderScopeId(providerId: string): string {
  return `llm:${providerId}`;
}

/** Never-Halt scope for a model route key (e.g. `llm:k2`). */
function llmRouteScopeId(routeKey: string): string {
  return `llm:${routeKey}`;
}

function formatLlmProviderFailureReason(
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

