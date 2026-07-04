/**
 * Kosong-backed implementation of the loop `LLM` interface.
 *
 * Bridges the new `loop/llm.ts` contract onto
 * the kosong `generate()` streaming API:
 *
 *   - kosong's per-part `onMessagePart` is forwarded to loop per-delta
 *     callbacks (`onTextDelta`, `onThinkDelta`, `onToolCallDelta`).
 *   - loop per-block callbacks (`onTextPart`, `onThinkPart`) only fire
 *     after the kosong stream drains, iterating over the merged
 *     `result.message.content`. Completed
 *     blocks land on the WAL seam, raw deltas never do.
 *   - kosong's finish reasons are preserved as provider diagnostics. The loop
 *     derives loop control from the normalized response shape, not from the
 *     provider's finish-reason spelling.
 */

import {
  APIConnectionError,
  APIEmptyResponseError,
  APIStatusError,
  APITimeoutError,
  emptyUsage,
  generate as kosongGenerate,
  grandTotal,
  isProviderRateLimitError,
  isRetryableGenerateError,
  type ChatProvider,
  type GenerateCallbacks,
  type Message,
  type ModelCapability,
  type StreamDecodeStats,
  type StreamedMessagePart,
  type TokenUsage,
} from '@superliora/kosong';

import type { ModelRoutingStrategy } from '../../config';
import { ErrorCodes, LioraError, isKimiError } from '../../errors';
import type { Logger } from '../../logging/types';
import type {
  LLM,
  LLMChatParams,
  LLMChatResponse,
  LLMStreamTiming,
} from '../../loop';
import {
  applyCompletionBudget,
  type CompletionBudgetConfig,
} from '../../utils/completion-budget';
import type {
  ProviderRouteCandidateStatus,
  ProviderRouteRateLimitStatus,
  ProviderRouteStatus,
} from '#/rpc';
import type { GenerateOptionsWithRequestLogFields } from '../llm-request-logger';

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
  readonly log?: Logger | undefined;
}

export class KosongLLM implements LLM {
  readonly systemPrompt: string;
  readonly modelName: string;
  readonly capability?: ModelCapability | undefined;

  private readonly provider: ChatProvider;
  private readonly generate: GenerateFn;
  private readonly completionBudgetConfig: CompletionBudgetConfig | undefined;
  private readonly usedContextTokens: (() => number) | undefined;
  private readonly route: KosongLLMRoute | undefined;
  private readonly routeState: ProviderRouteState | undefined;
  private readonly onRouteStatusChanged: (() => void) | undefined;
  private readonly log: Logger | undefined;

  constructor(config: KosongLLMConfig) {
    this.provider = config.provider;
    this.modelName = config.provider.modelName;
    this.systemPrompt = config.systemPrompt;
    this.capability = config.capability;
    this.generate = config.generate ?? kosongGenerate;
    this.completionBudgetConfig = config.completionBudgetConfig;
    this.usedContextTokens = config.usedContextTokens;
    this.route = config.route;
    this.routeState = config.routeState;
    this.onRouteStatusChanged = config.onRouteStatusChanged;
    this.log = config.log;
  }

  async chat(params: LLMChatParams): Promise<LLMChatResponse> {
    const route = this.route;
    if (route !== undefined && route.candidates.length > 0) {
      return this.chatWithRoute(params, route);
    }
    return this.chatWithCandidate(params, {
      provider: this.provider,
      capability: this.capability,
      completionBudgetConfig: this.completionBudgetConfig,
    });
  }

  private async chatWithRoute(
    params: LLMChatParams,
    route: KosongLLMRoute,
  ): Promise<LLMChatResponse> {
    const unavailable = this.routeState?.unavailable(route);
    if (unavailable !== undefined) {
      this.log?.warn('llm route unavailable; all candidates are cooling down or locally limited', {
        route: route.key,
        retryAfterMs: unavailable.retryAfterMs,
        retryAt: unavailable.retryAt,
      });
      throw new LioraError(
        ErrorCodes.PROVIDER_RATE_LIMIT,
        `All provider route candidates for "${route.key}" are cooling down or locally rate-limited. Try again in ${Math.ceil(
          unavailable.retryAfterMs / 1000,
        )}s.`,
        {
          details: {
            route: route.key,
            retryAfterMs: unavailable.retryAfterMs,
            retryAt: unavailable.retryAt,
          },
        },
      );
    }

    const orderedCandidates = this.routeState?.orderCandidates(route) ?? route.candidates;
    let lastError: unknown;

    for (let index = 0; index < orderedCandidates.length; index += 1) {
      const candidate = orderedCandidates[index]!;
      const attempt = { sawStreamOutput: false };
      try {
        const startedAt = Date.now();
        const response = await this.chatWithCandidate(params, candidate, attempt);
        const latencyMs = Math.max(0, Date.now() - startedAt);
        const successChanged =
          this.routeState?.recordSuccess(route, candidate, {
            latencyMs,
            usage: response.usage,
          }) === true;
        const rateLimits = providerRouteRateLimits(response.responseHeaders);
        const rateLimitsChanged =
          rateLimits.length > 0 &&
          this.routeState?.recordRateLimits(route, candidate, rateLimits) === true;
        const proactiveCooldown = classifyProviderRouteHeaders(response.responseHeaders);
        const cooldownChanged =
          proactiveCooldown !== undefined &&
          this.routeState?.recordCooldown(route, candidate, proactiveCooldown) === true;
        if (successChanged || rateLimitsChanged || cooldownChanged) {
          this.onRouteStatusChanged?.();
        }
        return response;
      } catch (error) {
        lastError = error;
        const failure = classifyProviderRouteFailure(error, route.cooldownMs);
        if (failure === undefined || attempt.sawStreamOutput) {
          throw error;
        }
        if (this.routeState?.recordFailure(route, candidate, failure) === true) {
          this.onRouteStatusChanged?.();
        }
        if (index === orderedCandidates.length - 1) {
          throw error;
        }
        const next = orderedCandidates[index + 1]!;
        this.log?.warn('llm route candidate failed; trying fallback', {
          route: route.key,
          failedModel: candidate.modelAlias,
          failedProvider: candidate.providerName,
          failedCredential: candidate.credentialLabel,
          nextModel: next.modelAlias,
          nextProvider: next.providerName,
          nextCredential: next.credentialLabel,
          failureKind: failure.kind,
          cooldownMs: failure.cooldownMs,
          errorName: error instanceof Error ? error.name : typeof error,
          errorMessage: error instanceof Error ? error.message : String(error),
          statusCode: maybeStatusCode(error),
        });
      }
    }

    throw lastError;
  }

  private async chatWithCandidate(
    params: LLMChatParams,
    candidate: {
      readonly modelAlias?: string | undefined;
      readonly providerName?: string | undefined;
      readonly credentialLabel?: string | undefined;
      readonly provider: ChatProvider;
      readonly capability?: ModelCapability | undefined;
      readonly completionBudgetConfig?: CompletionBudgetConfig | undefined;
    },
    attempt?: { sawStreamOutput: boolean } | undefined,
  ): Promise<LLMChatResponse> {
    let requestStartedAt = Date.now();
    let requestSentAt: number | undefined;
    let firstChunkAt: number | undefined;
    let streamEndedAt: number | undefined;
    let decodeStats: StreamDecodeStats | undefined;
    const markRequestStart = (): void => {
      requestStartedAt = Date.now();
    };
    const markRequestSent = (): void => {
      requestSentAt ??= Date.now();
    };
    const markStreamEnd = (stats?: StreamDecodeStats): void => {
      streamEndedAt = Date.now();
      decodeStats = stats;
    };
    const markStreamOutput = (): void => {
      if (attempt !== undefined) attempt.sawStreamOutput = true;
      firstChunkAt ??= Date.now();
    };
    const callbacks = buildKosongCallbacks(params, markStreamOutput);

    // Compute and apply the per-request completion budget against a
    // throwaway shallow clone. `effectiveProvider` is local to this call
    // and never written back to `this.provider`, so retries (handled at
    // a higher layer) keep using the same long-lived provider/client.
    const effectiveProvider = applyCompletionBudget({
      provider: candidate.provider,
      budget: candidate.completionBudgetConfig,
      capability: candidate.capability,
      usedContextTokens: this.usedContextTokens?.(),
    });
    const options: GenerateOptionsWithRequestLogFields = {
      signal: params.signal,
      onRequestStart: markRequestStart,
      onRequestSent: markRequestSent,
      onStreamEnd: markStreamEnd,
      requestLogFields: params.requestLogFields,
      runtimeModelAlias: candidate.modelAlias,
      runtimeCredentialLabel: candidate.credentialLabel,
    };

    const result = await this.generate(
      effectiveProvider,
      this.systemPrompt,
      [...params.tools],
      params.messages,
      callbacks,
      options,
    );

    // Replay merged content parts onto loop per-block callbacks after the
    // stream drained. This preserves WAL append order and stops partial
    // parts from landing if the upstream stream aborts mid-message.
    if (params.onTextPart !== undefined || params.onThinkPart !== undefined) {
      for (const part of result.message.content) {
        if (part.type === 'text' && params.onTextPart !== undefined) {
          await params.onTextPart(part);
        } else if (part.type === 'think' && params.onThinkPart !== undefined) {
          await params.onThinkPart(part);
        }
      }
    }

    const baseUrl = providerBaseUrl(candidate.provider);
    const response: LLMChatResponse = {
      toolCalls: [...result.message.toolCalls],
      providerFinishReason: result.finishReason ?? undefined,
      rawFinishReason: result.rawFinishReason ?? undefined,
      usage: result.usage ?? emptyUsage(),
      usageModel: candidate.modelAlias,
      responseHeaders: result.responseHeaders,
      providerRouteSelection: {
        modelAlias: candidate.modelAlias ?? candidate.provider.modelName,
        providerModel: candidate.provider.modelName,
        ...(baseUrl !== undefined ? { baseUrl } : {}),
        ...(candidate.providerName !== undefined ? { providerName: candidate.providerName } : {}),
        ...(candidate.credentialLabel !== undefined
          ? { credentialLabel: candidate.credentialLabel }
          : {}),
      },
      streamTiming:
        firstChunkAt === undefined
          ? undefined
          : buildStreamTiming(requestStartedAt, requestSentAt, firstChunkAt, streamEndedAt, decodeStats),
    };

    return response;
  }

  isRetryableError(error: unknown): boolean {
    return isRetryableGenerateError(error);
  }
}

const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 60_000;
const DEFAULT_AUTH_COOLDOWN_MS = 5 * 60_000;
const DEFAULT_QUOTA_COOLDOWN_MS = 60 * 60_000;
const DEFAULT_SERVER_COOLDOWN_MS = 30_000;
const DEFAULT_CONNECTION_COOLDOWN_MS = 30_000;
const DEFAULT_EMPTY_COOLDOWN_MS = 5_000;
const MAX_RETRY_AFTER_COOLDOWN_MS = 24 * 60 * 60_000;
const LOCAL_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_HEADER_BUCKETS = [
  {
    name: 'requests',
    limit: 'x-ratelimit-limit-requests',
    remaining: 'x-ratelimit-remaining-requests',
    reset: 'x-ratelimit-reset-requests',
  },
  {
    name: 'tokens',
    limit: 'x-ratelimit-limit-tokens',
    remaining: 'x-ratelimit-remaining-tokens',
    reset: 'x-ratelimit-reset-tokens',
  },
  {
    name: 'project_tokens',
    limit: 'x-ratelimit-limit-project-tokens',
    remaining: 'x-ratelimit-remaining-project-tokens',
    reset: 'x-ratelimit-reset-project-tokens',
  },
  {
    name: 'requests',
    limit: 'anthropic-ratelimit-requests-limit',
    remaining: 'anthropic-ratelimit-requests-remaining',
    reset: 'anthropic-ratelimit-requests-reset',
  },
  {
    name: 'tokens',
    limit: 'anthropic-ratelimit-tokens-limit',
    remaining: 'anthropic-ratelimit-tokens-remaining',
    reset: 'anthropic-ratelimit-tokens-reset',
  },
  {
    name: 'input_tokens',
    limit: 'anthropic-ratelimit-input-tokens-limit',
    remaining: 'anthropic-ratelimit-input-tokens-remaining',
    reset: 'anthropic-ratelimit-input-tokens-reset',
  },
  {
    name: 'output_tokens',
    limit: 'anthropic-ratelimit-output-tokens-limit',
    remaining: 'anthropic-ratelimit-output-tokens-remaining',
    reset: 'anthropic-ratelimit-output-tokens-reset',
  },
  {
    name: 'priority_input_tokens',
    limit: 'anthropic-priority-input-tokens-limit',
    remaining: 'anthropic-priority-input-tokens-remaining',
    reset: 'anthropic-priority-input-tokens-reset',
  },
  {
    name: 'priority_output_tokens',
    limit: 'anthropic-priority-output-tokens-limit',
    remaining: 'anthropic-priority-output-tokens-remaining',
    reset: 'anthropic-priority-output-tokens-reset',
  },
  {
    name: 'generic',
    limit: 'ratelimit-limit',
    remaining: 'ratelimit-remaining',
    reset: 'ratelimit-reset',
  },
  {
    name: 'generic',
    limit: 'rate-limit-limit',
    remaining: 'rate-limit-remaining',
    reset: 'rate-limit-reset',
  },
  {
    name: 'generic',
    limit: 'x-ratelimit-limit',
    remaining: 'x-ratelimit-remaining',
    reset: 'x-ratelimit-reset',
  },
  {
    name: 'generic',
    limit: 'x-rate-limit-limit',
    remaining: 'x-rate-limit-remaining',
    reset: 'x-rate-limit-reset',
  },
] as const satisfies readonly RateLimitHeaderBucket[];
const RATE_LIMIT_RESET_HEADERS_WITHOUT_REMAINING = [
  'ratelimit-reset',
  'rate-limit-reset',
  'x-ratelimit-reset',
  'x-rate-limit-reset',
] as const;
const PROVIDER_QUOTA_MESSAGE_PATTERNS = [
  /insufficient[_\s-]?quota/,
  /quota\s+exceed(?:ed|s|ing)?/,
  /exceed(?:ed|s|ing)?\s+(?:your\s+)?(?:current\s+)?quota/,
  /credit[_\s-]?balance[_\s-]?too[_\s-]?low/,
  /credit balance is too low/,
  /balance .*too low/,
  /insufficient.*(?:credit|balance|funds|quota)/,
  /(?:credit|credits).*(?:exhausted|depleted|expired|limit|spent)/,
  /(?:no|zero)\s+(?:credit|credits)\s+(?:remaining|left|available)/,
  /usage.*limit.*(?:reached|exceed(?:ed|s|ing)?)/,
  /spend.*limit.*(?:reached|exceed(?:ed|s|ing)?)/,
  /billing.*(?:limit|quota|credit|payment)/,
  /monthly.*(?:budget|spend).*limit/,
  /hard[_\s-]?limit/,
] as const;

interface RateLimitHeaderBucket {
  readonly name: string;
  readonly limit: string;
  readonly remaining: string;
  readonly reset: string;
}

export class InMemoryProviderRouteState implements ProviderRouteState {
  private readonly failureByCandidate = new Map<string, ProviderRouteFailureRecord>();
  private readonly statsByCandidate = new Map<string, ProviderRouteCandidateStats>();
  private readonly rateLimitsByCandidate = new Map<
    string,
    readonly ProviderRouteRateLimitStatus[]
  >();
  private readonly localUsageByCandidate = new Map<string, ProviderRouteLocalUsageRecord>();
  private readonly roundRobinIndexByRoute = new Map<string, number>();
  private readonly weightedRoundRobinByRoute = new Map<string, Map<string, number>>();
  private readonly pinnedCandidateByRoute = new Map<string, string>();

  orderCandidates(route: KosongLLMRoute): readonly KosongLLMRouteCandidate[] {
    const available = route.candidates.filter((candidate) => !this.isUnavailable(candidate));
    const candidates = available.length > 0 ? available : route.candidates;
    if (candidates.length <= 1) return candidates;

    const preferred = this.preferredCandidate(route, candidates);
    if (preferred !== undefined) {
      return [preferred, ...candidates.filter((candidate) => candidate !== preferred)];
    }

    const pinned = this.pinnedCandidate(route, candidates);
    if (pinned !== undefined) {
      return [pinned, ...candidates.filter((candidate) => candidate !== pinned)];
    }

    if (route.strategy === 'auto') {
      return this.orderAuto(route, candidates);
    }

    if (route.strategy === 'least_used') {
      return candidates
        .map((candidate, index) => ({ candidate, index, requestCount: this.requestCount(candidate) }))
        .toSorted((left, right) => left.requestCount - right.requestCount || left.index - right.index)
        .map((entry) => entry.candidate);
    }

    if (route.strategy === 'lowest_latency') {
      return this.orderLowestLatency(candidates);
    }

    if (route.strategy === 'rate_limit_aware') {
      return this.orderRateLimitAware(candidates);
    }

    if (route.strategy === 'random') {
      return shuffleCandidates(candidates);
    }

    if (route.strategy === 'weighted_round_robin') {
      return this.orderWeightedRoundRobin(route, candidates);
    }

    if (route.strategy !== 'round_robin') return candidates;

    const start = this.roundRobinIndexByRoute.get(route.key) ?? 0;
    this.roundRobinIndexByRoute.set(route.key, (start + 1) % candidates.length);
    return [...candidates.slice(start), ...candidates.slice(0, start)];
  }

  unavailable(route: KosongLLMRoute): ProviderRouteUnavailable | undefined {
    const retryAts = route.candidates.map((candidate) => this.candidateUnavailableUntil(candidate));
    if (retryAts.some((retryAt) => retryAt === undefined)) return undefined;
    const retryAt = Math.min(...retryAts.map((value) => value ?? Number.POSITIVE_INFINITY));
    if (!Number.isFinite(retryAt)) return undefined;
    return { retryAt, retryAfterMs: Math.max(0, retryAt - Date.now()) };
  }

  reset(route: KosongLLMRoute): boolean {
    let changed = false;
    for (const candidate of route.candidates) {
      const key = candidateKey(candidate);
      changed = this.failureByCandidate.delete(key) || changed;
      changed = this.statsByCandidate.delete(key) || changed;
      changed = this.rateLimitsByCandidate.delete(key) || changed;
      changed = this.localUsageByCandidate.delete(key) || changed;
    }
    changed = this.deleteRoundRobinState(route.key) || changed;
    changed = this.weightedRoundRobinByRoute.delete(route.key) || changed;
    changed = this.pinnedCandidateByRoute.delete(route.key) || changed;
    return changed;
  }

  recordSuccess(
    route: KosongLLMRoute,
    candidate: KosongLLMRouteCandidate,
    metrics?: ProviderRouteSuccessMetrics,
  ): boolean {
    const key = candidateKey(candidate);
    const previous = this.statsByCandidate.get(key);
    this.recordLocalUsage(candidate, metrics?.usage);
    const latencyMs = normalizeLatencyMs(metrics?.latencyMs);
    const avgLatencyMs =
      latencyMs === undefined
        ? previous?.avgLatencyMs
        : previous?.avgLatencyMs === undefined
          ? latencyMs
          : Math.round(previous.avgLatencyMs * 0.8 + latencyMs * 0.2);
    this.statsByCandidate.set(key, {
      successCount: (previous?.successCount ?? 0) + 1,
      failureCount: previous?.failureCount ?? 0,
      lastSuccessAt: Date.now(),
      lastLatencyMs: latencyMs ?? previous?.lastLatencyMs,
      avgLatencyMs,
      lastFailureKind: previous?.lastFailureKind,
      lastFailureAt: previous?.lastFailureAt,
    });
    this.failureByCandidate.delete(key);
    if (route.sessionAffinity === true) {
      this.pinnedCandidateByRoute.set(route.key, key);
    }
    return true;
  }

  recordCooldown(
    route: KosongLLMRoute,
    candidate: KosongLLMRouteCandidate,
    failure: ProviderRouteFailure,
  ): boolean {
    const recordedAt = Date.now();
    const next = {
      kind: failure.kind,
      failedAt: recordedAt,
      cooldownUntil: recordedAt + failure.cooldownMs,
    };
    const key = candidateKey(candidate);
    const previous = this.failureByCandidate.get(key);
    this.failureByCandidate.set(key, next);
    this.clearPinnedCandidate(route, key);
    return (
      previous?.kind !== next.kind ||
      previous.failedAt !== next.failedAt ||
      previous.cooldownUntil !== next.cooldownUntil
    );
  }

  recordRateLimits(
    _route: KosongLLMRoute,
    candidate: KosongLLMRouteCandidate,
    rateLimits: readonly ProviderRouteRateLimitStatus[],
  ): boolean {
    const key = candidateKey(candidate);
    if (rateLimits.length === 0) {
      return this.rateLimitsByCandidate.delete(key);
    }
    const next = copyProviderRouteRateLimits(rateLimits);
    const previous = this.rateLimitsByCandidate.get(key);
    this.rateLimitsByCandidate.set(key, next);
    return !sameProviderRouteRateLimits(previous, next);
  }

  recordFailure(
    route: KosongLLMRoute,
    candidate: KosongLLMRouteCandidate,
    failure: ProviderRouteFailure,
  ): boolean {
    const failedAt = Date.now();
    const next = {
      kind: failure.kind,
      failedAt,
      cooldownUntil: failedAt + failure.cooldownMs,
    };
    const key = candidateKey(candidate);
    const previous = this.failureByCandidate.get(key);
    const stats = this.statsByCandidate.get(key);
    this.statsByCandidate.set(key, {
      successCount: stats?.successCount ?? 0,
      failureCount: (stats?.failureCount ?? 0) + 1,
      lastSuccessAt: stats?.lastSuccessAt,
      lastLatencyMs: stats?.lastLatencyMs,
      avgLatencyMs: stats?.avgLatencyMs,
      lastFailureKind: failure.kind,
      lastFailureAt: failedAt,
    });
    this.failureByCandidate.set(key, next);
    this.clearPinnedCandidate(route, key);
    return (
      previous?.kind !== next.kind ||
      previous.failedAt !== next.failedAt ||
      previous.cooldownUntil !== next.cooldownUntil
    );
  }

  snapshot(route: KosongLLMRoute): ProviderRouteStatus {
    return {
      modelAlias: route.key,
      strategy: route.strategy,
      sessionAffinity: route.sessionAffinity === true ? true : undefined,
      preferredCredential: route.preferredCredential,
      candidates: route.candidates.map((candidate): ProviderRouteCandidateStatus => {
        const failure = this.activeFailure(candidate);
        const key = candidateKey(candidate);
        const stats = this.statsByCandidate.get(key);
        const successCount = stats?.successCount ?? 0;
        const failureCount = stats?.failureCount ?? 0;
        const rateLimits = this.candidateRateLimits(candidate);
        return {
          modelAlias: candidate.modelAlias,
          providerName: candidate.providerName,
          credentialLabel: candidate.credentialLabel,
          providerModel: candidate.provider.modelName,
          baseUrl: providerBaseUrl(candidate.provider),
          preferred: matchesPreferredCredential(route.preferredCredential, candidate)
            ? true
            : undefined,
          pinned:
            route.sessionAffinity === true && this.pinnedCandidateByRoute.get(route.key) === key
              ? true
              : undefined,
          weight: candidate.weight,
          rateLimits:
            rateLimits === undefined || rateLimits.length === 0
              ? undefined
              : copyProviderRouteRateLimits(rateLimits),
          rateLimitHeadroom: rateLimitHeadroom(rateLimits),
          cooldownUntil: failure?.cooldownUntil,
          cooldownKind: failure?.kind,
          lastSuccessAt: stats?.lastSuccessAt,
          lastLatencyMs: stats?.lastLatencyMs,
          avgLatencyMs: stats?.avgLatencyMs,
          lastFailureKind: stats?.lastFailureKind,
          lastFailureAt: stats?.lastFailureAt,
          successCount: successCount > 0 ? successCount : undefined,
          failureCount: failureCount > 0 ? failureCount : undefined,
        };
      }),
    };
  }

  private isUnavailable(candidate: KosongLLMRouteCandidate): boolean {
    return this.candidateUnavailableUntil(candidate) !== undefined;
  }

  private candidateUnavailableUntil(candidate: KosongLLMRouteCandidate): number | undefined {
    const activeFailure = this.activeFailure(candidate);
    if (activeFailure !== undefined) return activeFailure.cooldownUntil;
    return this.localLimitUnavailableUntil(candidate);
  }

  private requestCount(candidate: KosongLLMRouteCandidate): number {
    const stats = this.statsByCandidate.get(candidateKey(candidate));
    return (stats?.successCount ?? 0) + (stats?.failureCount ?? 0);
  }

  private avgLatencyMs(candidate: KosongLLMRouteCandidate): number | undefined {
    return this.statsByCandidate.get(candidateKey(candidate))?.avgLatencyMs;
  }

  private rateLimitHeadroom(candidate: KosongLLMRouteCandidate): number | undefined {
    return rateLimitHeadroom(this.candidateRateLimits(candidate));
  }

  private candidateRateLimits(
    candidate: KosongLLMRouteCandidate,
  ): readonly ProviderRouteRateLimitStatus[] | undefined {
    const remote = this.rateLimitsByCandidate.get(candidateKey(candidate));
    const local = this.localRateLimits(candidate);
    if (remote === undefined || remote.length === 0) return local.length === 0 ? undefined : local;
    if (local.length === 0) return remote;
    return [...local, ...remote];
  }

  private localRateLimits(candidate: KosongLLMRouteCandidate): ProviderRouteRateLimitStatus[] {
    const limits = candidate.localLimits;
    if (limits?.rpm === undefined && limits?.tpm === undefined) return [];
    const now = Date.now();
    const record = this.normalizedLocalUsageRecord(candidate, now);
    const windowStartedAt = record?.windowStartedAt ?? now;
    const resetAt = windowStartedAt + LOCAL_LIMIT_WINDOW_MS;
    const out: ProviderRouteRateLimitStatus[] = [];
    if (limits.rpm !== undefined) {
      out.push({
        name: 'local_requests',
        limit: limits.rpm,
        remaining: Math.max(0, limits.rpm - (record?.requestCount ?? 0)),
        resetAt,
      });
    }
    if (limits.tpm !== undefined) {
      out.push({
        name: 'local_tokens',
        limit: limits.tpm,
        remaining: Math.max(0, limits.tpm - (record?.tokenCount ?? 0)),
        resetAt,
      });
    }
    return out;
  }

  private localLimitUnavailableUntil(candidate: KosongLLMRouteCandidate): number | undefined {
    const exhausted = this.localRateLimits(candidate).filter(
      (limit) =>
        limit.remaining !== undefined &&
        limit.remaining <= 0 &&
        limit.resetAt !== undefined &&
        limit.resetAt > Date.now(),
    );
    if (exhausted.length === 0) return undefined;
    return Math.min(...exhausted.map((limit) => limit.resetAt!));
  }

  private recordLocalUsage(
    candidate: KosongLLMRouteCandidate,
    usage: TokenUsage | undefined,
  ): void {
    const limits = candidate.localLimits;
    if (limits?.rpm === undefined && limits?.tpm === undefined) return;
    const key = candidateKey(candidate);
    const now = Date.now();
    const previous = this.normalizedLocalUsageRecord(candidate, now);
    this.localUsageByCandidate.set(key, {
      windowStartedAt: previous?.windowStartedAt ?? now,
      requestCount: (previous?.requestCount ?? 0) + 1,
      tokenCount: (previous?.tokenCount ?? 0) + grandTotal(usage ?? emptyUsage()),
    });
  }

  private normalizedLocalUsageRecord(
    candidate: KosongLLMRouteCandidate,
    now: number,
  ): ProviderRouteLocalUsageRecord | undefined {
    const key = candidateKey(candidate);
    const record = this.localUsageByCandidate.get(key);
    if (record === undefined) return undefined;
    if (record.windowStartedAt + LOCAL_LIMIT_WINDOW_MS > now) return record;
    this.localUsageByCandidate.delete(key);
    return undefined;
  }

  private preferredCandidate(
    route: KosongLLMRoute,
    candidates: readonly KosongLLMRouteCandidate[],
  ): KosongLLMRouteCandidate | undefined {
    const preferredCredential = route.preferredCredential;
    if (preferredCredential === undefined) return undefined;
    const candidate = candidates.find((entry) =>
      matchesPreferredCredential(preferredCredential, entry),
    );
    if (candidate === undefined) return undefined;
    if (this.rateLimitHeadroom(candidate) === 0) return undefined;
    return candidate;
  }

  private pinnedCandidate(
    route: KosongLLMRoute,
    candidates: readonly KosongLLMRouteCandidate[],
  ): KosongLLMRouteCandidate | undefined {
    if (route.sessionAffinity !== true) return undefined;
    const pinnedKey = this.pinnedCandidateByRoute.get(route.key);
    if (pinnedKey === undefined) return undefined;
    const candidate = candidates.find((entry) => candidateKey(entry) === pinnedKey);
    if (candidate === undefined) {
      this.pinnedCandidateByRoute.delete(route.key);
      return undefined;
    }
    if (this.rateLimitHeadroom(candidate) === 0) return undefined;
    return candidate;
  }

  private clearPinnedCandidate(route: KosongLLMRoute, candidateKeyValue: string): void {
    if (this.pinnedCandidateByRoute.get(route.key) === candidateKeyValue) {
      this.pinnedCandidateByRoute.delete(route.key);
    }
  }

  private orderAuto(
    route: KosongLLMRoute,
    candidates: readonly KosongLLMRouteCandidate[],
  ): readonly KosongLLMRouteCandidate[] {
    if (candidates.some((candidate) => this.rateLimitHeadroom(candidate) !== undefined)) {
      return this.orderRateLimitAware(candidates);
    }
    if (candidates.some((candidate) => this.avgLatencyMs(candidate) !== undefined)) {
      return this.orderLowestLatency(candidates);
    }
    if (candidates.some((candidate) => candidate.weight !== undefined)) {
      return this.orderWeightedRoundRobin(route, candidates);
    }
    return this.orderLeadingAliasRoundRobin(route, candidates);
  }

  private orderLowestLatency(
    candidates: readonly KosongLLMRouteCandidate[],
  ): readonly KosongLLMRouteCandidate[] {
    return candidates
      .map((candidate, index) => ({
        candidate,
        index,
        latencyMs: this.avgLatencyMs(candidate),
      }))
      .toSorted(
        (left, right) =>
          (left.latencyMs ?? Number.POSITIVE_INFINITY) -
            (right.latencyMs ?? Number.POSITIVE_INFINITY) ||
          left.index - right.index,
      )
      .map((entry) => entry.candidate);
  }

  private orderRateLimitAware(
    candidates: readonly KosongLLMRouteCandidate[],
  ): readonly KosongLLMRouteCandidate[] {
    return candidates
      .map((candidate, index) => ({
        candidate,
        index,
        headroom: this.rateLimitHeadroom(candidate),
      }))
      .toSorted(compareRateLimitAwareCandidates)
      .map((entry) => entry.candidate);
  }

  private orderLeadingAliasRoundRobin(
    route: KosongLLMRoute,
    candidates: readonly KosongLLMRouteCandidate[],
  ): readonly KosongLLMRouteCandidate[] {
    const leadingModelAlias = candidates[0]?.modelAlias;
    if (leadingModelAlias === undefined) return candidates;
    const leading = candidates.filter((candidate) => candidate.modelAlias === leadingModelAlias);
    if (leading.length <= 1) return candidates;
    const rest = candidates.filter((candidate) => candidate.modelAlias !== leadingModelAlias);
    const key = `${route.key}:${leadingModelAlias}`;
    const start = this.roundRobinIndexByRoute.get(key) ?? 0;
    this.roundRobinIndexByRoute.set(key, (start + 1) % leading.length);
    return [...leading.slice(start), ...leading.slice(0, start), ...rest];
  }

  private activeFailure(candidate: KosongLLMRouteCandidate): ProviderRouteFailureRecord | undefined {
    const key = candidateKey(candidate);
    const failure = this.failureByCandidate.get(key);
    if (failure === undefined) return undefined;
    if (failure.cooldownUntil > Date.now()) return failure;
    this.failureByCandidate.delete(key);
    return undefined;
  }

  private orderWeightedRoundRobin(
    route: KosongLLMRoute,
    candidates: readonly KosongLLMRouteCandidate[],
  ): readonly KosongLLMRouteCandidate[] {
    if (candidates.length <= 1) return candidates;
    const weights = candidates.map(candidateWeight);
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    if (totalWeight <= 0) return candidates;

    const current = this.weightedRoundRobinState(route);
    let selectedIndex = 0;
    let selectedWeight = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index]!;
      const key = candidateKey(candidate);
      const nextWeight = (current.get(key) ?? 0) + weights[index]!;
      current.set(key, nextWeight);
      if (nextWeight > selectedWeight) {
        selectedIndex = index;
        selectedWeight = nextWeight;
      }
    }

    const selected = candidates[selectedIndex]!;
    current.set(candidateKey(selected), (current.get(candidateKey(selected)) ?? 0) - totalWeight);
    return [
      selected,
      ...candidates.slice(0, selectedIndex),
      ...candidates.slice(selectedIndex + 1),
    ];
  }

  private weightedRoundRobinState(route: KosongLLMRoute): Map<string, number> {
    const state = this.weightedRoundRobinByRoute.get(route.key);
    if (state !== undefined) return state;
    const next = new Map<string, number>();
    this.weightedRoundRobinByRoute.set(route.key, next);
    return next;
  }

  private deleteRoundRobinState(routeKey: string): boolean {
    let changed = this.roundRobinIndexByRoute.delete(routeKey);
    const prefix = `${routeKey}:`;
    for (const key of this.roundRobinIndexByRoute.keys()) {
      if (!key.startsWith(prefix)) continue;
      changed = this.roundRobinIndexByRoute.delete(key) || changed;
    }
    return changed;
  }
}

function candidateWeight(candidate: KosongLLMRouteCandidate): number {
  const weight = candidate.weight ?? 1;
  return Number.isInteger(weight) && weight > 0 ? weight : 1;
}

function shuffleCandidates(
  candidates: readonly KosongLLMRouteCandidate[],
): readonly KosongLLMRouteCandidate[] {
  const shuffled = [...candidates];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!];
  }
  return shuffled;
}

interface RateLimitAwareCandidateOrder {
  readonly candidate: KosongLLMRouteCandidate;
  readonly index: number;
  readonly headroom?: number;
}

function compareRateLimitAwareCandidates(
  left: RateLimitAwareCandidateOrder,
  right: RateLimitAwareCandidateOrder,
): number {
  const rankDiff = rateLimitHeadroomRank(left.headroom) - rateLimitHeadroomRank(right.headroom);
  if (rankDiff !== 0) return rankDiff;
  return (right.headroom ?? 0) - (left.headroom ?? 0) || left.index - right.index;
}

function rateLimitHeadroomRank(headroom: number | undefined): number {
  if (headroom === undefined) return 1;
  return headroom > 0 ? 0 : 2;
}

function rateLimitHeadroom(
  rateLimits: readonly ProviderRouteRateLimitStatus[] | undefined,
): number | undefined {
  if (rateLimits === undefined || rateLimits.length === 0) return undefined;
  const headrooms: number[] = [];
  const now = Date.now();
  for (const rateLimit of rateLimits) {
    if (rateLimit.resetAt !== undefined && rateLimit.resetAt <= now) continue;
    if (rateLimit.remaining === undefined) continue;
    const remaining = Math.max(0, rateLimit.remaining);
    if (rateLimit.limit !== undefined && rateLimit.limit > 0) {
      headrooms.push(Math.min(1, remaining / rateLimit.limit));
    } else {
      headrooms.push(remaining > 0 ? 1 : 0);
    }
  }
  return headrooms.length === 0 ? undefined : Math.min(...headrooms);
}

interface ProviderRouteFailureRecord {
  readonly kind: ProviderRouteFailureKind;
  readonly failedAt: number;
  readonly cooldownUntil: number;
}

interface ProviderRouteCandidateStats {
  readonly successCount: number;
  readonly failureCount: number;
  readonly lastSuccessAt?: number;
  readonly lastLatencyMs?: number;
  readonly avgLatencyMs?: number;
  readonly lastFailureKind?: ProviderRouteFailureKind;
  readonly lastFailureAt?: number;
}

interface ProviderRouteLocalUsageRecord {
  readonly windowStartedAt: number;
  readonly requestCount: number;
  readonly tokenCount: number;
}

function normalizeLatencyMs(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value < 0) return undefined;
  return Math.round(value);
}

function classifyProviderRouteFailure(
  error: unknown,
  configuredCooldownMs: number | undefined,
): ProviderRouteFailure | undefined {
  const cooldownMs = (fallbackMs: number): number =>
    retryAfterCooldownMs(error) ?? configuredCooldownMs ?? fallbackMs;

  if (isKimiError(error)) {
    if (
      error.code === ErrorCodes.AUTH_LOGIN_REQUIRED ||
      error.code === ErrorCodes.PROVIDER_AUTH_ERROR
    ) {
      return { kind: 'auth', cooldownMs: cooldownMs(DEFAULT_AUTH_COOLDOWN_MS) };
    }
    if (isProviderQuotaError(error)) {
      return { kind: 'quota', cooldownMs: cooldownMs(DEFAULT_QUOTA_COOLDOWN_MS) };
    }
    if (error.code === ErrorCodes.PROVIDER_RATE_LIMIT) {
      return {
        kind: 'rate_limit',
        cooldownMs: cooldownMs(DEFAULT_RATE_LIMIT_COOLDOWN_MS),
      };
    }
    if (error.code === ErrorCodes.PROVIDER_CONNECTION_ERROR) {
      return {
        kind: 'connection',
        cooldownMs: cooldownMs(DEFAULT_CONNECTION_COOLDOWN_MS),
      };
    }
  }
  if (isProviderQuotaError(error)) {
    return { kind: 'quota', cooldownMs: cooldownMs(DEFAULT_QUOTA_COOLDOWN_MS) };
  }
  if (isProviderRateLimitError(error)) {
    return {
      kind: 'rate_limit',
      cooldownMs: cooldownMs(DEFAULT_RATE_LIMIT_COOLDOWN_MS),
    };
  }
  if (error instanceof APIConnectionError) {
    return {
      kind: 'connection',
      cooldownMs: cooldownMs(DEFAULT_CONNECTION_COOLDOWN_MS),
    };
  }
  if (error instanceof APITimeoutError) {
    return { kind: 'timeout', cooldownMs: cooldownMs(DEFAULT_CONNECTION_COOLDOWN_MS) };
  }
  if (error instanceof APIEmptyResponseError) {
    return { kind: 'empty', cooldownMs: cooldownMs(DEFAULT_EMPTY_COOLDOWN_MS) };
  }
  if (!(error instanceof APIStatusError)) return undefined;

  if (error.statusCode === 401 || error.statusCode === 403) {
    return { kind: 'auth', cooldownMs: cooldownMs(DEFAULT_AUTH_COOLDOWN_MS) };
  }
  if (error.statusCode === 402) {
    return { kind: 'quota', cooldownMs: cooldownMs(DEFAULT_QUOTA_COOLDOWN_MS) };
  }
  if (error.statusCode >= 500 && error.statusCode <= 504) {
    return { kind: 'server', cooldownMs: cooldownMs(DEFAULT_SERVER_COOLDOWN_MS) };
  }
  return undefined;
}

function classifyProviderRouteHeaders(headers: unknown): ProviderRouteFailure | undefined {
  const cooldownMs = exhaustedRateLimitCooldownMs([headers]);
  if (cooldownMs === undefined) return undefined;
  return { kind: 'rate_limit', cooldownMs };
}

function providerRouteRateLimits(headers: unknown): ProviderRouteRateLimitStatus[] {
  const rateLimits: ProviderRouteRateLimitStatus[] = [];
  for (const bucket of RATE_LIMIT_HEADER_BUCKETS) {
    const limit = parseNumericHeader(headerValue(headers, bucket.limit));
    const remaining = parseNumericHeader(headerValue(headers, bucket.remaining));
    const resetMs = parseRateLimitResetMs(headerValue(headers, bucket.reset));
    if (limit === undefined && remaining === undefined && resetMs === undefined) continue;
    rateLimits.push({
      name: bucket.name,
      limit,
      remaining,
      resetAt: resetMs === undefined ? undefined : Date.now() + resetMs,
    });
  }
  return rateLimits;
}

function isProviderQuotaError(error: unknown): boolean {
  const text = errorSignalText(error).toLowerCase();
  return PROVIDER_QUOTA_MESSAGE_PATTERNS.some((pattern) => pattern.test(text));
}

function errorSignalText(value: unknown, depth = 0): string {
  if (depth > 5 || value === undefined || value === null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value instanceof Error) {
    const record = value as unknown as Record<string, unknown>;
    const parts = [value.name, value.message];
    for (const key of ['code', 'type', 'error', 'details', 'body', 'data', 'response']) {
      parts.push(errorSignalText(record[key], depth + 1));
    }
    return parts.filter((part) => part.length > 0).join(' ');
  }
  if (typeof value !== 'object') return '';

  const record = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of ['code', 'type', 'message', 'error', 'details', 'body', 'data', 'response']) {
    parts.push(errorSignalText(record[key], depth + 1));
  }
  return parts.filter((part) => part.length > 0).join(' ');
}

function retryAfterCooldownMs(error: unknown): number | undefined {
  const detailsRetryAfterMs = kimiErrorRetryAfterMs(error);
  if (detailsRetryAfterMs !== undefined) return detailsRetryAfterMs;

  const headerSources = errorHeaderSources(error);
  for (const headers of headerSources) {
    const retryAfterMs =
      headerValue(headers, 'retry-after-ms') ?? headerValue(headers, 'x-retry-after-ms');
    const parsedMs = parseRetryAfterMs(retryAfterMs, 'milliseconds');
    if (parsedMs !== undefined) return parsedMs;

    const retryAfter =
      headerValue(headers, 'retry-after') ??
      headerValue(headers, 'x-retry-after') ??
      headerValue(headers, 'llm_provider-retry-after');
    const parsed = parseRetryAfterMs(retryAfter, 'seconds-or-date');
    if (parsed !== undefined) return parsed;
  }
  return rateLimitResetCooldownMs(headerSources);
}

function rateLimitResetCooldownMs(headerSources: readonly unknown[]): number | undefined {
  const exhaustedResets: number[] = [];
  const fallbackResets: number[] = [];

  for (const headers of headerSources) {
    exhaustedResets.push(...exhaustedRateLimitResetCooldowns(headers));

    for (const resetHeader of RATE_LIMIT_RESET_HEADERS_WITHOUT_REMAINING) {
      const reset = parseRateLimitResetMs(headerValue(headers, resetHeader));
      if (reset !== undefined) fallbackResets.push(reset);
    }
  }

  if (exhaustedResets.length > 0) return Math.max(...exhaustedResets);
  if (fallbackResets.length > 0) return Math.min(...fallbackResets);
  return undefined;
}

function exhaustedRateLimitResetCooldownMs(
  headerSources: readonly unknown[],
): number | undefined {
  const exhaustedResets = headerSources.flatMap((headers) =>
    exhaustedRateLimitResetCooldowns(headers),
  );
  if (exhaustedResets.length === 0) return undefined;
  return Math.max(...exhaustedResets);
}

function exhaustedRateLimitCooldownMs(headerSources: readonly unknown[]): number | undefined {
  const resetCooldownMs = exhaustedRateLimitResetCooldownMs(headerSources);
  if (resetCooldownMs !== undefined) return resetCooldownMs;
  return headerSources.some((headers) => hasExhaustedRateLimitBucket(headers))
    ? DEFAULT_RATE_LIMIT_COOLDOWN_MS
    : undefined;
}

function exhaustedRateLimitResetCooldowns(headers: unknown): number[] {
  const exhaustedResets: number[] = [];
  for (const bucket of RATE_LIMIT_HEADER_BUCKETS) {
    const reset = parseRateLimitResetMs(headerValue(headers, bucket.reset));
    if (reset === undefined) continue;
    const remaining = parseNumericHeader(headerValue(headers, bucket.remaining));
    if (remaining !== undefined && remaining <= 0) {
      exhaustedResets.push(reset);
    }
  }
  return exhaustedResets;
}

function hasExhaustedRateLimitBucket(headers: unknown): boolean {
  return RATE_LIMIT_HEADER_BUCKETS.some((bucket) => {
    const remaining = parseNumericHeader(headerValue(headers, bucket.remaining));
    return remaining !== undefined && remaining <= 0;
  });
}

function kimiErrorRetryAfterMs(error: unknown): number | undefined {
  if (!isKimiError(error)) return undefined;
  const value = error.details?.['retryAfterMs'];
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.min(Math.ceil(value), MAX_RETRY_AFTER_COOLDOWN_MS);
}

function errorHeaderSources(error: unknown): unknown[] {
  if (typeof error !== 'object' || error === null) return [];
  const record = error as Record<string, unknown>;
  const sources: unknown[] = [record['headers']];
  const response = record['response'];
  if (typeof response === 'object' && response !== null) {
    sources.push((response as Record<string, unknown>)['headers']);
  }
  const cause = record['cause'];
  if (typeof cause === 'object' && cause !== null) {
    sources.push((cause as Record<string, unknown>)['headers']);
  }
  return sources.filter((source) => source !== undefined);
}

function headerValue(headers: unknown, name: string): string | undefined {
  if (headers === undefined || headers === null) return undefined;
  if (typeof (headers as { get?: unknown }).get === 'function') {
    const value = (headers as { get(name: string): unknown }).get(name);
    return normalizeHeaderValue(value);
  }
  if (headers instanceof Map) {
    return normalizeHeaderValue(headers.get(name) ?? headers.get(name.toLowerCase()));
  }
  if (typeof headers !== 'object') return undefined;
  const record = headers as Record<string, unknown>;
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(record)) {
    if (key.toLowerCase() === lowerName) return normalizeHeaderValue(value);
  }
  return undefined;
}

function normalizeHeaderValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    const first = value.find((entry) => typeof entry === 'string' || typeof entry === 'number');
    return normalizeHeaderValue(first);
  }
  return undefined;
}

function parseRetryAfterMs(
  value: string | undefined,
  mode: 'milliseconds' | 'seconds-or-date',
): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;

  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && numeric > 0) {
    const ms = mode === 'milliseconds' ? numeric : numeric * 1000;
    return Math.min(Math.ceil(ms), MAX_RETRY_AFTER_COOLDOWN_MS);
  }

  if (mode !== 'seconds-or-date') return undefined;
  const dateMs = Date.parse(trimmed);
  if (!Number.isFinite(dateMs)) return undefined;
  const ms = dateMs - Date.now();
  if (ms <= 0) return undefined;
  return Math.min(Math.ceil(ms), MAX_RETRY_AFTER_COOLDOWN_MS);
}

function parseRateLimitResetMs(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;

  const durationMs = parseDurationMs(trimmed);
  if (durationMs !== undefined) return durationMs;

  const dateMs = Date.parse(trimmed);
  if (Number.isFinite(dateMs)) {
    const ms = dateMs - Date.now();
    if (ms > 0) return Math.min(Math.ceil(ms), MAX_RETRY_AFTER_COOLDOWN_MS);
  }

  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  const nowSeconds = Date.now() / 1000;
  const ms = numeric > nowSeconds ? numeric * 1000 - Date.now() : numeric * 1000;
  if (ms <= 0) return undefined;
  return Math.min(Math.ceil(ms), MAX_RETRY_AFTER_COOLDOWN_MS);
}

function parseDurationMs(value: string): number | undefined {
  const durationPattern = /(\d+(?:\.\d+)?)(ms|s|m|h|d)/gi;
  let total = 0;
  let matched = false;
  let end = 0;
  for (const match of value.matchAll(durationPattern)) {
    if (match.index !== end) return undefined;
    const amount = Number(match[1]);
    const unit = match[2]?.toLowerCase();
    if (!Number.isFinite(amount) || unit === undefined) return undefined;
    matched = true;
    end = match.index + match[0].length;
    switch (unit) {
      case 'ms':
        total += amount;
        break;
      case 's':
        total += amount * 1000;
        break;
      case 'm':
        total += amount * 60_000;
        break;
      case 'h':
        total += amount * 60 * 60_000;
        break;
      case 'd':
        total += amount * 24 * 60 * 60_000;
        break;
    }
  }
  if (!matched || end !== value.length || total <= 0) return undefined;
  return Math.min(Math.ceil(total), MAX_RETRY_AFTER_COOLDOWN_MS);
}

function parseNumericHeader(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function copyProviderRouteRateLimits(
  rateLimits: readonly ProviderRouteRateLimitStatus[],
): ProviderRouteRateLimitStatus[] {
  return rateLimits.map((rateLimit) => ({ ...rateLimit }));
}

function sameProviderRouteRateLimits(
  left: readonly ProviderRouteRateLimitStatus[] | undefined,
  right: readonly ProviderRouteRateLimitStatus[],
): boolean {
  if (left === undefined || left.length !== right.length) return false;
  return left.every((leftLimit, index) => {
    const rightLimit = right[index]!;
    return (
      leftLimit.name === rightLimit.name &&
      leftLimit.limit === rightLimit.limit &&
      leftLimit.remaining === rightLimit.remaining &&
      leftLimit.resetAt === rightLimit.resetAt
    );
  });
}

function candidateKey(candidate: KosongLLMRouteCandidate): string {
  return [
    candidate.modelAlias,
    candidate.providerName,
    candidate.credentialLabel ?? '',
    candidate.provider.modelName,
    providerBaseUrl(candidate.provider) ?? '',
  ].join('\n');
}

function providerBaseUrl(provider: ChatProvider): string | undefined {
  const baseUrl = (provider as { readonly baseUrl?: unknown }).baseUrl;
  return typeof baseUrl === 'string' && baseUrl.trim().length > 0 ? baseUrl.trim() : undefined;
}

function matchesPreferredCredential(
  preferredCredential: string | undefined,
  candidate: KosongLLMRouteCandidate,
): boolean {
  const preferred = preferredCredential?.trim();
  const label = candidate.credentialLabel?.trim();
  if (preferred === undefined || preferred.length === 0 || label === undefined || label.length === 0) {
    return false;
  }
  return (
    preferred === label ||
    preferred === `${candidate.modelAlias}:${label}` ||
    preferred === `${candidate.providerName}:${label}`
  );
}

function maybeStatusCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return typeof statusCode === 'number' ? statusCode : undefined;
}

function buildStreamTiming(
  requestStartedAt: number,
  requestSentAt: number | undefined,
  firstChunkAt: number,
  streamEndedAt: number | undefined,
  decodeStats: StreamDecodeStats | undefined,
): LLMStreamTiming {
  const outputEndedAt = streamEndedAt ?? Date.now();
  const firstTokenLatencyMs = Math.max(0, firstChunkAt - requestStartedAt);
  const timing: {
    -readonly [K in keyof LLMStreamTiming]: LLMStreamTiming[K];
  } = {
    firstTokenLatencyMs,
    streamDurationMs: Math.max(0, outputEndedAt - firstChunkAt),
  };
  if (requestSentAt !== undefined) {
    const sentAt = Math.min(Math.max(requestSentAt, requestStartedAt), firstChunkAt);
    timing.requestBuildMs = sentAt - requestStartedAt;
    timing.serverFirstTokenMs = firstChunkAt - sentAt;
  }
  if (decodeStats !== undefined) {
    timing.serverDecodeMs = Math.max(0, decodeStats.serverDecodeMs);
    timing.clientConsumeMs = Math.max(0, decodeStats.clientConsumeMs);
  }
  return timing;
}

function buildKosongCallbacks(
  params: LLMChatParams,
  markStreamOutput: () => void,
): GenerateCallbacks {
  type ToolCallIdentity = { readonly toolCallId: string; readonly name: string };
  type BufferedToolCallDelta = { readonly argumentsPart?: string | undefined };

  const toolCallIdentities = new Map<number | string, ToolCallIdentity>();
  const pendingIndexedToolCallDeltas = new Map<number | string, BufferedToolCallDelta[]>();
  let lastToolCallIdentity: ToolCallIdentity | undefined;

  const emitToolCallDelta = (delta: {
    toolCallId: string;
    name: string;
    argumentsPart?: string;
  }): void => {
    if (params.onToolCallDelta === undefined) return;
    params.onToolCallDelta(delta);
  };

  return {
    onMessagePart: (part: StreamedMessagePart) => {
      markStreamOutput();
      if (part.type === 'text') {
        if (params.onTextDelta === undefined) return;
        params.onTextDelta(part.text);
        return;
      }
      if (part.type === 'think') {
        if (params.onThinkDelta === undefined) return;
        params.onThinkDelta(part.think);
        return;
      }
      if (part.type === 'function') {
        const identity = { toolCallId: part.id, name: part.name };
        lastToolCallIdentity = identity;
        if (part._streamIndex !== undefined) {
          toolCallIdentities.set(part._streamIndex, identity);
        }
        emitToolCallDelta({
          toolCallId: part.id,
          name: part.name,
          ...(part.arguments !== null ? { argumentsPart: part.arguments } : {}),
        });
        if (part._streamIndex !== undefined) {
          const pendingDeltas = pendingIndexedToolCallDeltas.get(part._streamIndex);
          if (pendingDeltas !== undefined) {
            pendingIndexedToolCallDeltas.delete(part._streamIndex);
            for (const delta of pendingDeltas) {
              emitToolCallDelta({
                toolCallId: identity.toolCallId,
                name: identity.name,
                ...delta,
              });
            }
          }
        }
        return;
      }
      if (part.type === 'tool_call_part') {
        const argumentsPart = part.argumentsPart;
        const delta = argumentsPart !== null ? { argumentsPart } : {};
        if (part.index !== undefined) {
          const identity = toolCallIdentities.get(part.index);
          if (identity === undefined) {
            const pendingDeltas = pendingIndexedToolCallDeltas.get(part.index) ?? [];
            pendingDeltas.push(delta);
            pendingIndexedToolCallDeltas.set(part.index, pendingDeltas);
            return;
          }
          emitToolCallDelta({
            toolCallId: identity.toolCallId,
            name: identity.name,
            ...delta,
          });
          return;
        }
        const identity = lastToolCallIdentity;
        if (identity === undefined) return;
        emitToolCallDelta({
          toolCallId: identity.toolCallId,
          name: identity.name,
          ...delta,
        });
      }
    },
  };
}

export function buildMessagesWithSystem(systemPrompt: string, history: Message[]): Message[] {
  return [
    { role: 'system', content: [{ type: 'text', text: systemPrompt }], toolCalls: [] },
    ...history,
  ];
}
