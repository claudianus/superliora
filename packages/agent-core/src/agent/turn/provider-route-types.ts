/**
 * Shared types for provider route failover used by KosongLLM and route state.
 */

import type {
  ChatProvider,
  LayeredSystemPrompt,
  ModelCapability,
  TokenUsage,
  generate as kosongGenerate,
} from '@superliora/kosong';

import type { ModelRoutingStrategy } from '../../config';
import type { Logger } from '../../logging/types';
import type { ProviderRouteRateLimitStatus } from '#/rpc';
import type { CompletionBudgetConfig } from '../../utils/completion-budget';
import type { LlmProviderCircuitObserver } from '../llm-provider-circuit-breaker';

export type GenerateFn = typeof kosongGenerate;

export interface KosongLLMRouteCandidate {
  readonly modelAlias: string;
  readonly providerName: string;
  readonly credentialLabel?: string;
  readonly weight?: number;
  readonly localLimits?: KosongLLMLocalLimits | undefined;
  readonly provider: ChatProvider;
  readonly capability?: ModelCapability | undefined;
  readonly completionBudgetConfig?: CompletionBudgetConfig | undefined;
}

export interface KosongLLMLocalLimits {
  readonly rpm?: number;
  readonly tpm?: number;
}

export interface KosongLLMRoute {
  readonly key: string;
  readonly strategy: ModelRoutingStrategy;
  readonly cooldownMs?: number | undefined;
  readonly sessionAffinity?: boolean | undefined;
  readonly preferredCredential?: string | undefined;
  readonly candidates: readonly KosongLLMRouteCandidate[];
}

export interface ProviderRouteState {
  orderCandidates(route: KosongLLMRoute): readonly KosongLLMRouteCandidate[];
  unavailable(route: KosongLLMRoute): ProviderRouteUnavailable | undefined;
  reset(route: KosongLLMRoute): boolean;
  recordSuccess(
    route: KosongLLMRoute,
    candidate: KosongLLMRouteCandidate,
    metrics?: ProviderRouteSuccessMetrics,
  ): boolean;
  recordCooldown(
    route: KosongLLMRoute,
    candidate: KosongLLMRouteCandidate,
    failure: ProviderRouteFailure,
  ): boolean;
  recordRateLimits(
    route: KosongLLMRoute,
    candidate: KosongLLMRouteCandidate,
    rateLimits: readonly ProviderRouteRateLimitStatus[],
  ): boolean;
  recordFailure(
    route: KosongLLMRoute,
    candidate: KosongLLMRouteCandidate,
    failure: ProviderRouteFailure,
  ): boolean;
}

export type ProviderRouteFailureKind =
  | 'auth'
  | 'quota'
  | 'rate_limit'
  | 'server'
  | 'connection'
  | 'timeout'
  | 'empty';

export interface ProviderRouteFailure {
  readonly kind: ProviderRouteFailureKind;
  readonly cooldownMs: number;
}

export interface ProviderRouteUnavailable {
  readonly retryAfterMs: number;
  readonly retryAt: number;
}

export interface ProviderRouteSuccessMetrics {
  readonly latencyMs?: number;
  readonly usage?: TokenUsage;
}

export interface KosongLLMConfig {
  readonly provider: ChatProvider;
  readonly systemPrompt: string;
  /**
   * Layered system prompt for cache-optimized providers (Anthropic).
   * When provided, the provider will use multi-block system with
   * cache_control on the static layer for maximum cache hit rate.
   */
  readonly layeredSystemPrompt?: LayeredSystemPrompt | undefined;
  readonly capability?: ModelCapability | undefined;
  /**
   * Optional override for the kosong `generate()` entry point. Lets the
   * agent host (and its test harness) inject a scripted generator without
   * having to substitute the entire LLM implementation.
   */
  readonly generate?: GenerateFn | undefined;
  /**
   * Completion budget config resolved from agent/provider settings. The
   * final cap is applied to each request.
   */
  readonly completionBudgetConfig?: CompletionBudgetConfig | undefined;
  /**
   * Returns the number of context tokens already consumed by the latest
   * completed step (API-reported input + output). Used by chat-completions
   * providers to size the completion budget to the remaining context window.
   */
  readonly usedContextTokens?: (() => number) | undefined;
  readonly route?: KosongLLMRoute | undefined;
  readonly routeState?: ProviderRouteState | undefined;
  readonly onRouteStatusChanged?: (() => void) | undefined;
  /** Optional Never-Halt observer (Agent.circuitBreakerRegistry when wired). */
  readonly circuitObserver?: LlmProviderCircuitObserver | undefined;
  readonly log?: Logger | undefined;
}

