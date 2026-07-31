import type { ResearchSearchProviderKind } from '#/config/schema';
import type { CircuitBreakerRegistry } from '#/runtime/circuit-breaker';

import type { WebSearchProvider } from '../builtin/web/web-search';
import { ResearchSearchEngine } from './research-search';
import { PreferXaiGrokWebSearchProvider } from './xai-grok-build-web-providers';

export type SearchCircuitChannel = ResearchSearchProviderKind | 'browser' | 'chrome-ext';

/** Map provider/channel to Never-Halt circuit breaker scope id. */
export function searchChannelScopeId(channel: SearchCircuitChannel): string {
  switch (channel) {
    case 'serper':
      return 'search:google';
    case 'duckduckgo':
    case 'searxng':
      return 'search:free';
    case 'browser':
      return 'search:browser';
    case 'chrome-ext':
      return 'search:chrome-ext';
    default:
      return `search:${channel}`;
  }
}

export function formatSearchChannelFailureReason(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }
  return 'search channel error';
}

export function resolveResearchSearchEngine(
  provider: WebSearchProvider | undefined,
): ResearchSearchEngine | undefined {
  if (provider === undefined) return undefined;
  if (provider instanceof ResearchSearchEngine) return provider;
  if (provider instanceof PreferXaiGrokWebSearchProvider) {
    return resolveResearchSearchEngine(provider.researchFallback);
  }
  return undefined;
}

/** Late-bind Agent registry + status callback onto a shared session webSearcher. */
export function attachResearchSearchCircuitBreakers(
  webSearcher: WebSearchProvider | undefined,
  registry: CircuitBreakerRegistry,
  onChanged?: () => void,
): void {
  resolveResearchSearchEngine(webSearcher)?.attachCircuitBreakers(registry, onChanged);
}
