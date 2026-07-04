/**
 * LLM contract for the model capability used by the stateless loop.
 *
 * The immutable `LLM` object owns provider/model metadata, capability metadata,
 * and the system prompt. Other host concerns are injected through separate
 * surfaces.
 */

import type {
  FinishReason,
  Message,
  ModelCapability,
  ResponseHeaders,
  TextPart,
  ThinkPart,
  TokenUsage,
  Tool,
  ToolCall,
} from '@superliora/kosong';

export interface ToolCallDelta {
  readonly toolCallId: string;
  readonly name?: string | undefined;
  readonly argumentsPart?: string | undefined;
}

export interface LLMRequestLogFields {
  readonly turnStep: string;
  readonly attempt?: string;
}

export interface LLMStreamTiming {
  readonly firstTokenLatencyMs: number;
  readonly streamDurationMs: number;
  /**
   * Portion of `firstTokenLatencyMs` spent in-process before the provider
   * adapter dispatches the network request.
   */
  readonly requestBuildMs?: number;
  /**
   * Portion of `firstTokenLatencyMs` spent waiting on the upstream API after
   * request dispatch.
   */
  readonly serverFirstTokenMs?: number;
  /**
   * Split of `streamDurationMs`: provider wait time vs. local per-part
   * processing time.
   */
  readonly serverDecodeMs?: number;
  readonly clientConsumeMs?: number;
}

export interface LLMProviderRouteSelection {
  readonly modelAlias: string;
  readonly providerName?: string | undefined;
  readonly credentialLabel?: string | undefined;
  readonly providerModel: string;
  readonly baseUrl?: string | undefined;
}

export interface LLMChatParams {
  messages: Message[];
  tools: readonly Tool[];
  signal: AbortSignal;
  requestLogFields?: LLMRequestLogFields;
  onTextDelta?: ((delta: string) => void) | undefined;
  onThinkDelta?: ((delta: string) => void) | undefined;
  onToolCallDelta?: ((delta: ToolCallDelta) => void) | undefined;
  /**
   * Fires once per completed text block. Additive relative to
   * `onTextDelta` — deltas still fire chunk-by-chunk for UI streaming.
   * Returned promises are awaited by the adapter to preserve transcript append
   * order. Durable transcript writes receive completed blocks only.
   */
  onTextPart?: ((part: TextPart) => Promise<void> | void) | undefined;
  /**
   * Fires once per completed thinking block. Additive relative to
   * `onThinkDelta` — deltas still fire chunk-by-chunk for UI streaming.
   * Returned promises are awaited by the adapter to preserve transcript append
   * order. Durable transcript writes receive completed blocks only.
   */
  onThinkPart?: ((part: ThinkPart) => Promise<void> | void) | undefined;
}

export interface LLMChatResponse {
  toolCalls: ToolCall[];
  providerFinishReason?: FinishReason;
  rawFinishReason?: string;
  usage: TokenUsage;
  usageModel?: string;
  providerRouteSelection?: LLMProviderRouteSelection;
  responseHeaders?: ResponseHeaders;
  streamTiming?: LLMStreamTiming;
}

export interface LLM {
  readonly systemPrompt: string;
  readonly modelName: string;
  readonly capability?: ModelCapability | undefined;
  isRetryableError?(error: unknown): boolean;
  chat(params: LLMChatParams): Promise<LLMChatResponse>;
}
