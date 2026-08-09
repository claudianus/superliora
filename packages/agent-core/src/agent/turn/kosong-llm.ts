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
 *
 * Route state and failure classification live in sibling modules:
 * `provider-route-state.ts` and `provider-route-classify.ts`.
 */

import {
  emptyUsage,
  generate as kosongGenerate,
  isRetryableGenerateError,
  type ChatProvider,
  type GenerateCallbacks,
  type LayeredSystemPrompt,
  type Message,
  type ModelCapability,
  type StreamDecodeStats,
  type StreamedMessagePart,
} from '@superliora/kosong';
import { sharedCredentialHealthStore } from '@superliora/oauth';

import { ErrorCodes, LioraError } from '../../errors';
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
import type { GenerateOptionsWithRequestLogFields } from '../llm-request-logger';
import {
  invalidateLiveProbeSuccess,
  invalidateLiveProbeSuccessForProvider,
} from '../routing/live-probe';
import { unslopText } from '../../utils/unslop';
import {
  classifyProviderRouteFailure,
  classifyProviderRouteHeaders,
  maybeStatusCode,
  providerRouteRateLimits,
} from './provider-route-classify';
import { providerBaseUrl } from './provider-route-state';
import type {
  GenerateFn,
  KosongLLMConfig,
  KosongLLMRoute,
  KosongLLMRouteCandidate,
  ProviderRouteState,
  ProviderRouteUnavailable,
} from './provider-route-types';

export type { Message };

export type {
  GenerateFn,
  KosongLLMConfig,
  KosongLLMLocalLimits,
  KosongLLMRoute,
  KosongLLMRouteCandidate,
  ProviderRouteFailure,
  ProviderRouteFailureKind,
  ProviderRouteState,
  ProviderRouteSuccessMetrics,
  ProviderRouteUnavailable,
} from './provider-route-types';
export { InMemoryProviderRouteState } from './provider-route-state';
export {
  classifyProviderRouteFailure,
} from './provider-route-classify';

export class KosongLLM implements LLM {
  readonly systemPrompt: string;
  readonly layeredSystemPrompt: LayeredSystemPrompt | undefined;
  readonly modelName: string;
  readonly capability?: ModelCapability | undefined;

  private readonly provider: ChatProvider;
  private readonly generate: GenerateFn;
  private readonly completionBudgetConfig: CompletionBudgetConfig | undefined;
  private readonly usedContextTokens: (() => number) | undefined;
  private readonly route: KosongLLMRoute | undefined;
  private readonly routeState: ProviderRouteState | undefined;
  private readonly onRouteStatusChanged: (() => void) | undefined;
  private readonly circuitObserver: KosongLLMConfig['circuitObserver'];
  private readonly log: Logger | undefined;

  constructor(config: KosongLLMConfig) {
    this.provider = config.provider;
    this.modelName = config.provider.modelName;
    this.systemPrompt = config.systemPrompt;
    this.layeredSystemPrompt = config.layeredSystemPrompt;
    this.capability = config.capability;
    this.generate = config.generate ?? kosongGenerate;
    this.completionBudgetConfig = config.completionBudgetConfig;
    this.usedContextTokens = config.usedContextTokens;
    this.route = config.route;
    this.routeState = config.routeState;
    this.onRouteStatusChanged = config.onRouteStatusChanged;
    this.circuitObserver = config.circuitObserver;
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
        dominantFailureKind: unavailable.dominantFailureKind,
      });
      throw routeUnavailableError(route.key, unavailable);
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
        this.circuitObserver?.onSuccess({ route, candidate });
        return response;
      } catch (error) {
        lastError = error;
        const failure = classifyProviderRouteFailure(error, route.cooldownMs);
        // Always cool down classified failures — including mid-stream — so the
        // next outer retry skips this candidate. In-route hop stays disabled
        // once stream output was already pushed to the UI.
        if (failure !== undefined) {
          if (this.routeState?.recordFailure(route, candidate, failure) === true) {
            this.onRouteStatusChanged?.();
          }
          this.circuitObserver?.onFailure({ route, candidate, failure, error });
          invalidateLiveProbeSuccess(candidate.modelAlias);
          invalidateLiveProbeSuccessForProvider(candidate.providerName);
          if (failure.kind === 'auth') {
            sharedCredentialHealthStore.markAuthRejected(candidate.providerName, {
              credentialKey: candidate.credentialLabel,
              failureReason:
                error instanceof Error ? error.message : 'provider auth failure',
              cooldownMs: failure.cooldownMs,
            });
          } else if (
            failure.kind === 'quota' ||
            failure.kind === 'rate_limit' ||
            failure.kind === 'server' ||
            failure.kind === 'connection' ||
            failure.kind === 'timeout'
          ) {
            sharedCredentialHealthStore.markRateLimited(candidate.providerName, {
              credentialKey: candidate.credentialLabel,
              failureReason:
                error instanceof Error ? error.message : `provider ${failure.kind} failure`,
              cooldownMs: failure.cooldownMs,
            });
          }
        }
        if (failure === undefined || attempt.sawStreamOutput) {
          throw error;
        }
        if (index === orderedCandidates.length - 1) {
          throw error;
        }
        const next = orderedCandidates[index + 1]!;
        this.log?.warn('provider_route_switch', {
          event: 'provider_route_switch',
          route: route.key,
          from: {
            model: candidate.modelAlias,
            provider: candidate.providerName,
            credential: candidate.credentialLabel,
          },
          to: {
            model: next.modelAlias,
            provider: next.providerName,
            credential: next.credentialLabel,
          },
          reason: failure.kind,
          cooldownMs: failure.cooldownMs,
          errorMessage: error instanceof Error ? error.message : String(error),
          statusCode: maybeStatusCode(error),
        });
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
      layeredSystemPrompt: this.layeredSystemPrompt,
    };

    const result = await this.generate(
      effectiveProvider,
      this.systemPrompt,
      [...params.tools],
      params.messages,
      callbacks,
      options,
    );

    // Apply unslop post-processing on the generated message content text parts to filter out AI slop
    if (result.message?.content) {
      for (const part of result.message.content) {
        if (part.type === 'text') {
          part.text = unslopText(part.text);
        }
      }
    }

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

function routeUnavailableError(routeKey: string, unavailable: ProviderRouteUnavailable): LioraError {
  const seconds = Math.ceil(unavailable.retryAfterMs / 1000);
  const details = {
    route: routeKey,
    retryAfterMs: unavailable.retryAfterMs,
    retryAt: unavailable.retryAt,
    routeUnavailable: true,
    dominantFailureKind: unavailable.dominantFailureKind,
  };

  if (unavailable.dominantFailureKind === 'auth') {
    return new LioraError(
      ErrorCodes.PROVIDER_AUTH_ERROR,
      `All provider route candidates for "${routeKey}" failed authentication and are cooling down. Try again in ${seconds}s or switch accounts.`,
      { details },
    );
  }

  if (unavailable.dominantFailureKind === 'quota') {
    return new LioraError(
      ErrorCodes.PROVIDER_API_ERROR,
      `All provider route candidates for "${routeKey}" are unavailable due to quota or billing limits. Try again in ${seconds}s or switch models.`,
      {
        details: {
          ...details,
          permanentQuota: true,
        },
      },
    );
  }

  return new LioraError(
    ErrorCodes.PROVIDER_RATE_LIMIT,
    `All provider route candidates for "${routeKey}" are cooling down or locally rate-limited. Try again in ${seconds}s.`,
    { details },
  );
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
