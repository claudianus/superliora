import type { Message, StreamedMessagePart, VideoURLPart } from './message';
import type { Tool } from './tool';
import type { TokenUsage } from './usage';

/**
 * Normalized thinking effort level used across providers.
 *
 * Values above `high` are provider/model-specific and may be clamped by the
 * adapter when the native API has no matching level. OpenAI maps `max` to its
 * `xhigh` ceiling; Kimi and Gemini cap `xhigh`/`max` at `high`; Anthropic
 * supports `xhigh`/`max` only on selected models and otherwise clamps to
 * `high`.
 */
export type ThinkingEffort = 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/**
 * Optional context passed to {@link ChatProvider.withMaxCompletionTokens} so a
 * provider can tighten the caller-supplied cap to its own transport
 * constraints.
 */
export interface MaxCompletionTokensOptions {
  /**
   * Tokens already consumed by the current context (API-reported input +
   * output of the latest completed step). Chat-completions providers use it
   * to size the cap to the remaining context window.
   */
  readonly usedContextTokens?: number;
  /** Model context-window size in tokens (`max_context_size`). */
  readonly maxContextTokens?: number;
}

/**
 * Normalized finish-reason signal indicating why a generation stopped.
 *
 * Each provider's native stop value is mapped to one of these, and the
 * unmapped original string is preserved in `rawFinishReason` as an escape
 * hatch. `null` means the provider did not emit a finish_reason (e.g. the
 * stream was cut off before the final event).
 *
 * - `'completed'`: normal completion (OpenAI `'stop'`, Anthropic
 *   `'end_turn'` / `'stop_sequence'`, Gemini `'STOP'`).
 * - `'tool_calls'`: generation paused so the caller can dispatch tool
 *   calls and feed their results back. Note that the OpenAI Responses API
 *   and Google GenAI report `'completed'` here; only the Chat
 *   Completions–style providers and Anthropic surface a dedicated value.
 * - `'truncated'`: token budget exhausted (OpenAI `'length'`, Anthropic
 *   `'max_tokens'`, Gemini `'MAX_TOKENS'`, Responses `'max_output_tokens'`).
 * - `'filtered'`: content filter or safety policy blocked the response.
 * - `'paused'`: Anthropic-specific `'pause_turn'`.
 * - `'other'`: recognized non-null reason that does not fit the categories
 *   above.
 */
export type FinishReason =
  | 'completed'
  | 'tool_calls'
  | 'truncated'
  | 'filtered'
  | 'paused'
  | 'other';

export type ResponseHeaders =
  | Headers
  | Map<string, string | number | readonly (string | number)[]>
  | Record<string, string | number | readonly (string | number)[] | undefined>;

/**
 * An async-iterable stream of message parts produced by a single LLM response.
 *
 * Consumers iterate over the stream with `for await..of` to receive
 * {@link StreamedMessagePart} chunks. After the iteration completes, the
 * {@link id}, {@link usage}, {@link finishReason}, and
 * {@link rawFinishReason} properties reflect the final values reported by
 * the provider.
 */
export interface StreamedMessage {
  [Symbol.asyncIterator](): AsyncIterator<StreamedMessagePart>;
  /** Provider-assigned response identifier, or `null` if not available. */
  readonly id: string | null;
  /** Token usage statistics, populated after the stream completes. */
  readonly usage: TokenUsage | null;
  /**
   * Normalized finish reason, populated after the stream completes.
   *
   * `null` if the provider did not emit a finish_reason (for example, the
   * stream was interrupted before the final event arrived).
   */
  readonly finishReason: FinishReason | null;
  /**
   * Raw provider-specific finish_reason string, preserved verbatim as an
   * escape hatch for callers that need the original wire value.
   *
   * `null` if the provider did not emit a finish_reason.
   */
  readonly rawFinishReason: string | null;
  /**
   * Provider response headers, when the transport exposes them. Routers use
   * rate-limit headers here for proactive credential cooldowns.
   */
  readonly responseHeaders?: ResponseHeaders;
}

/**
 * Options that can be forwarded to a single {@link ChatProvider.generate} call.
 */
export interface ProviderRequestAuth {
  /** Bearer/API token resolved for this specific provider request. */
  apiKey?: string;
  /** Request-scoped headers. These override constructor-level default headers. */
  headers?: Record<string, string>;
}

/**
 * Layered system prompt for cache optimization.
 * Providers that support multi-block system prompts (e.g., Anthropic)
 * can use this to maximize cache hit rates by placing cache_control
 * on the static layer.
 */
export interface LayeredSystemPrompt {
  /** Static core instructions - cacheable across all requests */
  readonly layer1Static: string;
  /** Session-static context - fixed within a session */
  readonly layer2Session: string;
  /** Dynamic context - may change per request */
  readonly layer3Dynamic: string;
  /**
   * Per-agent role/persona text, kept out of the cached layers so parallel
   * workers with distinct roles share one identical system prefix. Emitted as
   * a trailing system block (no cache breakpoint) when non-empty.
   */
  readonly roleAdditional?: string;
}

export interface GenerateOptions {
  /**
   * An {@link AbortSignal} that, when aborted, requests cancellation of the
   * in-flight generate call. Providers that accept a signal will forward it
   * to their underlying HTTP client; the generate loop in
   * {@link generate | generate()} also checks the signal between streamed
   * parts.
   */
  signal?: AbortSignal;
  /**
   * Request-scoped provider auth. Hosts should resolve this immediately before
   * each request/retry so providers never retain mutable credential state.
   */
  auth?: ProviderRequestAuth;
  /**
   * Host-side instrumentation hook fired immediately before invoking the
   * provider adapter's generate call.
   */
  onRequestStart?: () => void;
  /**
   * Host-side instrumentation hook fired by the provider adapter immediately
   * before it dispatches the network request to the upstream API. The window
   * between `onRequestStart` and this hook is in-process request-building time;
   * the window between this hook and the first streamed part is network +
   * server time.
   */
  onRequestSent?: () => void;
  /**
   * Host-side instrumentation hook fired after the provider stream is fully
   * drained, before post-processing the assembled response. Receives decode
   * accounting when at least one streamed part was observed.
   */
  onStreamEnd?: (stats?: StreamDecodeStats) => void;
  /**
   * Maximum time (ms) to wait for the next streamed part before treating the
   * stream as stalled and aborting with an {@link APITimeoutError}. The timer
   * resets on every received *activity* part (non-empty text/think/tool
   * deltas), so a healthy slow stream is never killed — only a completely
   * silent one. Empty keepalives do not reset the budget.
   *
   * When omitted, falls back to the `SUPERLIORA_LLM_IDLE_TIMEOUT_MS`
   * environment variable, then to {@link DEFAULT_STREAM_IDLE_TIMEOUT_MS}
   * (2 minutes). Set to `0` to disable the watchdog entirely.
   */
  streamIdleTimeoutMs?: number;
  /**
   * Maximum time (ms) to wait for `provider.generate()` to return a stream
   * object before treating the request as hung (TCP/TLS handshake or a
   * create() that never resolves). This is separate from
   * {@link streamIdleTimeoutMs}, which only runs after the stream exists.
   *
   * When omitted, falls back to `SUPERLIORA_LLM_OPEN_TIMEOUT_MS`, then to
   * {@link DEFAULT_STREAM_OPEN_TIMEOUT_MS} (2 minutes). Set to `0` to disable.
   */
  streamOpenTimeoutMs?: number;
  /**
   * Layered system prompt for cache-optimized providers.
   * When provided, providers that support multi-block system prompts
   * (e.g., Anthropic) will use this instead of the string systemPrompt
   * to maximize cache hit rates.
   */
  layeredSystemPrompt?: LayeredSystemPrompt;
}

export interface ContextManagementCapability {
  readonly serverSideCompaction?: boolean;
  readonly toolResultClearing?: boolean;
  readonly thinkingBlockClearing?: boolean;
}

/**
 * Decode-phase accounting for a streamed generation. Splits the window after
 * the first streamed part into provider wait time and local per-part processing
 * time.
 */
export interface StreamDecodeStats {
  /** Cumulative time spent awaiting the next streamed part. */
  readonly serverDecodeMs: number;
  /** Cumulative time spent processing streamed parts in-process. */
  readonly clientConsumeMs: number;
}

/**
 * In-memory video bytes for providers that require an uploaded file
 * reference instead of an inline data URL.
 */
export interface VideoUploadInput {
  readonly data: Uint8Array;
  readonly mimeType: string;
  readonly filename?: string | undefined;
}

/**
 * Unified interface for an LLM chat provider.
 *
 * Each provider implementation (Kimi, OpenAI, Anthropic, Google GenAI, etc.)
 * converts the common {@link Message} / {@link Tool} types into the
 * provider-specific wire format, streams back a {@link StreamedMessage}, and
 * exposes configuration helpers such as {@link withThinking}.
 */
export interface ChatProvider {
  /** Short identifier for the provider backend (e.g. `"kimi"`, `"anthropic"`). */
  readonly name: string;
  /** Model name passed to the upstream API (e.g. `"moonshot-v1-auto"`). */
  readonly modelName: string;
  /** Provider-native context management surfaces that callers may opt into. */
  readonly contextManagementCapability?: ContextManagementCapability;
  /** Current thinking-effort level, or `null` if thinking is not configured. */
  readonly thinkingEffort: ThinkingEffort | null;
  /**
   * Send a conversation to the LLM and return a streamed response.
   *
   * @param systemPrompt - System-level instruction prepended to the request.
   * @param tools - Tool definitions the model may invoke.
   * @param history - The conversation history (user, assistant, tool messages).
   * @param options - Optional per-call settings such as an {@link AbortSignal}.
   */
  generate(
    systemPrompt: string,
    tools: Tool[],
    history: Message[],
    options?: GenerateOptions,
  ): Promise<StreamedMessage>;
  /** Return a shallow copy of this provider with the given thinking effort. */
  withThinking(effort: ThinkingEffort): ChatProvider;
  /**
   * Return a shallow copy of this provider with the per-request completion
   * budget clamped to `maxCompletionTokens`. Optional because not every
   * backend benefits from a client-computed cap.
   *
   * When `options` are provided, implementations may further tighten the cap
   * based on their own transport constraints — e.g. chat-completions
   * endpoints size the cap to the remaining context window
   * (`maxContextTokens - usedContextTokens`) and/or clamp to a fixed ceiling.
   *
   * Implementations MUST NOT mutate or replace internal HTTP clients on the
   * returned clone — the clone is expected to share transport state with the
   * original. See `KimiChatProvider._clone()` for the rationale.
   */
  withMaxCompletionTokens?(
    maxCompletionTokens: number,
    options?: MaxCompletionTokensOptions,
  ): ChatProvider;
  /** Upload a video and return a content part that can be sent to this provider. */
  uploadVideo?(input: string | VideoUploadInput, options?: GenerateOptions): Promise<VideoURLPart>;
}
