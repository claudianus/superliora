import { APIEmptyResponseError, APITimeoutError } from './errors';
import {
  createGenerateAbortScope,
  createStreamLivenessGuard,
  DEFAULT_LLM_IDLE_TIMEOUT_MS,
  DEFAULT_LLM_OPEN_TIMEOUT_MS,
  openTimeoutError,
  resolveIdleTimeoutMs,
  resolveOpenTimeoutMs,
  withIdleTimeout,
} from './idle-timeout';
import {
  isContentPart,
  isToolCall,
  isToolCallPart,
  mergeInPlace,
  type Message,
  type StreamedMessagePart,
  type ToolCall,
} from './message';
import type {
  ChatProvider,
  FinishReason,
  GenerateOptions,
  ResponseHeaders,
  StreamedMessage,
} from './provider';
import type { Tool } from './tool';
import { parseResponseRateLimits } from './rate-limit-headers';
import type { ResponseRateLimit } from './rate-limit-headers';
import type { TokenUsage } from './usage';

/**
 * Default maximum silence (ms) between streamed parts before the generate
 * loop treats the stream as stalled and aborts. Delegates to the shared
 * idle-timeout default (2 minutes); override per request with
 * `streamIdleTimeoutMs` or globally via `SUPERLIORA_LLM_IDLE_TIMEOUT_MS`.
 */
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = DEFAULT_LLM_IDLE_TIMEOUT_MS;

/**
 * Default maximum wait (ms) for `provider.generate()` to return a stream
 * before the request is treated as hung. Override with `streamOpenTimeoutMs`
 * or `SUPERLIORA_LLM_OPEN_TIMEOUT_MS`.
 */
export const DEFAULT_STREAM_OPEN_TIMEOUT_MS = DEFAULT_LLM_OPEN_TIMEOUT_MS;

/** Snapshot of a ToolCall excluding the internal `_streamIndex` routing field. */
type StoredToolCall = Omit<ToolCall, '_streamIndex'>;

/**
 * The result of a single {@link generate} call.
 *
 * Contains the fully-assembled assistant {@link message}, an optional
 * provider-assigned {@link id}, and token {@link usage} statistics.
 */
export interface GenerateResult {
  /** Provider-assigned response identifier, or `null` if unavailable. */
  readonly id: string | null;
  /** The fully-assembled assistant message with merged content parts and tool calls. */
  readonly message: Message;
  /** Token usage for this generation, or `null` if not reported. */
  readonly usage: TokenUsage | null;
  /**
   * Normalized finish reason reported by the provider, or `null` if no
   * finish_reason was emitted (for example, the stream was interrupted
   * before the final event).
   */
  readonly finishReason: FinishReason | null;
  /**
   * Raw provider-specific finish_reason string preserved verbatim.
   * `null` if the provider did not emit one.
   */
  readonly rawFinishReason: string | null;
  /** Provider response headers, when the transport exposes them. */
  readonly responseHeaders?: ResponseHeaders;
  /** Parsed last-response rate-limit windows. Empty when unknown. */
  readonly rateLimits?: readonly ResponseRateLimit[];
}

export interface GenerateCallbacks {
  onMessagePart?: (part: StreamedMessagePart) => void | Promise<void>;
  /**
   * Fires once per fully-assembled tool call after the stream drains, in the
   * order tool calls appear in the final assistant message.
   *
   * Tool calls are deliberately deferred until after the stream completes:
   * parallel-tool-call streams may interleave argument deltas across calls
   * (e.g. tc0-header → tc1-header → tc0-args → tc1-args), so firing mid-stream
   * would dispatch a tool with half-parsed arguments and trigger toolParseError.
   */
  onToolCall?: (toolCall: ToolCall) => void | Promise<void>;
}

/**
 * Generate one assistant message by streaming from the given provider.
 *
 * Parts of the message are streamed and merged: consecutive compatible parts
 * (e.g. TextPart + TextPart, ToolCall + ToolCallPart) are merged in-place so
 * the returned message always contains fully-assembled parts.
 *
 * **Tool call completion** is inferred from merge boundaries (a non-merging
 * next part flushes the pending tool call into `message.toolCalls`) and from
 * stream end. Provider adapters translate native "done" signals into this
 * unified form; the generate loop never sees a separate done event.
 *
 * @param provider - The chat provider to generate from.
 * @param systemPrompt - System-level instruction prepended to the request.
 * @param tools - Tool definitions the model may invoke.
 * @param history - The conversation history sent as context.
 * @param callbacks - Optional streaming callbacks.
 * @param options - Optional per-call settings (e.g. an {@link AbortSignal}).
 *
 * @throws {DOMException} with name `"AbortError"` when `options.signal` is
 *   aborted before or during streaming.
 * @throws {APIEmptyResponseError} when the response contains no content and
 *   no tool calls, or only thinking content without any text or tool calls.
 */
export async function generate(
  provider: ChatProvider,
  systemPrompt: string,
  tools: Tool[],
  history: Message[],
  callbacks?: GenerateCallbacks,
  options?: GenerateOptions,
): Promise<GenerateResult> {
  const message: Message = { role: 'assistant', content: [], toolCalls: [] };
  let pendingPart: StreamedMessagePart | null = null;

  // Map from provider streaming index (e.g. OpenAI Chat `index`, Responses
  // `item_id`) to the position inside `message.toolCalls`. Used to route
  // interleaved argument deltas from parallel tool calls to the correct call.
  const toolCallIndexMap = new Map<number | string, number>();

  // Pre-flight abort check: if the caller's signal is already aborted, we
  // must not issue the provider request at all. Providers that do not
  // themselves honor `signal` would otherwise emit a network call that the
  // caller has explicitly cancelled.
  if (options?.signal?.aborted) {
    throwCallerAbortReason(options.signal);
  }

  const streamLabel = `Provider: ${provider.name}, model: ${provider.modelName}`;
  const openTimeoutMs = resolveOpenTimeoutMs(options?.streamOpenTimeoutMs);
  // One abort scope covers open + stream: caller cancel and the open deadline
  // share a signal so hung create() is cancellable, and Esc during stream still
  // tears down the HTTP body.
  const abortScope = createGenerateAbortScope({
    openMs: openTimeoutMs,
    signal: options?.signal,
    label: streamLabel,
  });
  const activeSignal = abortScope.signal;

  options?.onRequestStart?.();
  let stream: StreamedMessage;
  try {
    // Race open against the abort scope so a provider that ignores `signal`
    // still cannot hang forever — the open timer aborts the scope, and we
    // reject from the abort listener even if generate() never settles.
    stream = await new Promise<StreamedMessage>((resolve, reject) => {
      if (activeSignal.aborted) {
        reject(
          abortScope.openTimedOut()
            ? openTimeoutError(openTimeoutMs, streamLabel)
            : new DOMException('The operation was aborted.', 'AbortError'),
        );
        return;
      }

      let settled = false;
      const rejectOpen = (): void => {
        if (settled) return;
        settled = true;
        reject(
          abortScope.openTimedOut()
            ? openTimeoutError(openTimeoutMs, streamLabel)
            : new DOMException('The operation was aborted.', 'AbortError'),
        );
      };
      const onAbort = (): void => {
        rejectOpen();
      };
      activeSignal.addEventListener('abort', onAbort, { once: true });

      void provider
        .generate(systemPrompt, tools, history, {
          ...options,
          signal: activeSignal,
        })
        .then(
          (value) => {
            activeSignal.removeEventListener('abort', onAbort);
            // Aborted mid-create (or after) still yields a stream — cancel it
            // so the connection is not leaked, then reject.
            if (settled || activeSignal.aborted) {
              void cancelStream(value);
              rejectOpen();
              return;
            }
            settled = true;
            resolve(value);
          },
          (error: unknown) => {
            activeSignal.removeEventListener('abort', onAbort);
            if (settled) return;
            settled = true;
            if (abortScope.openTimedOut()) {
              reject(openTimeoutError(openTimeoutMs, streamLabel));
              return;
            }
            reject(error);
          },
        );
    });
    // Stream object exists — stop the open-phase deadline so a long healthy
    // decode is only governed by the per-chunk idle watchdog.
    abortScope.clearOpenTimer();
  } catch (error: unknown) {
    abortScope.dispose();
    rethrowIfCallerCancelled(options?.signal, abortScope.openTimedOut());
    if (abortScope.openTimedOut() && !(error instanceof APITimeoutError)) {
      throw openTimeoutError(openTimeoutMs, streamLabel);
    }
    throw error;
  }

  // Post-await abort check: `provider.generate()` may have resolved before
  // noticing a mid-flight abort. Reject immediately rather than draining
  // the stream.
  try {
    await throwIfAborted(activeSignal, stream);
  } catch (error: unknown) {
    abortScope.dispose();
    throw error;
  }

  let serverDecodeMs = 0;
  let clientConsumeMs = 0;
  let firstPartAt: number | undefined;
  let lastResumeAt = 0;

  // Idle watchdog: wrap the provider stream so a stalled stream (server
  // stops sending tokens without closing the connection) cannot block the
  // agent loop indefinitely. Empty keepalives do not reset the budget.
  // The per-request `streamIdleTimeoutMs` option wins; otherwise the
  // SUPERLIORA_LLM_IDLE_TIMEOUT_MS env var, then the shared default.
  // Two further budgets ride the same watchdog: a tighter first-token phase
  // (before the first substantive part) and a whole-stream duration cap
  // that catches streams which drip activity forever.
  const idleTimeoutMs = resolveIdleTimeoutMs(options?.streamIdleTimeoutMs);
  const watchedStream = withIdleTimeout(stream, {
    idleMs: idleTimeoutMs,
    firstTokenMs: options?.firstTokenTimeoutMs,
    maxDurationMs: options?.streamMaxDurationMs,
    label: streamLabel,
    signal: activeSignal,
    countsAsActivity: isSubstantiveStreamPart,
  });
  const iterator = watchedStream[Symbol.asyncIterator]();

  // Unlike next()-only timers this remains armed across callback backpressure.
  // It uses the same substantive first-token/idle/total budgets, without pulling
  // ahead or buffering provider parts while the consumer is busy.
  const liveness = createStreamLivenessGuard({
    idleMs: idleTimeoutMs,
    firstTokenMs: options?.firstTokenTimeoutMs,
    maxDurationMs: options?.streamMaxDurationMs,
    label: streamLabel,
    onTimeout: error => { abortScope.abortWith(error); },
  });
  let cancellation: Promise<void> | undefined;
  const cancelRequest = (): Promise<void> => {
    if (cancellation === undefined) {
      cancellation = cancelStream(stream);
      // Returning the actual iterator releases suspended generator resources.
      // Do not await it: a provider ignoring the signal can still have a stuck
      // next(), which would otherwise hide this very timeout during teardown.
      try { void iterator.return?.().catch(() => {}); } catch {}
    }
    return cancellation;
  };
  const onStreamAbort = (): void => {
    liveness.dispose();
    void cancelRequest();
  };
  activeSignal.addEventListener('abort', onStreamAbort, { once: true });
  if (activeSignal.aborted) onStreamAbort();

  try {
    while (true) {
      const iterResult = await awaitWithAbort(iterator.next(), activeSignal);
      if (iterResult.done) { liveness.dispose(); break; }
      const part = iterResult.value;
      if (isSubstantiveStreamPart(part)) liveness.activity();

      const arrivedAt = Date.now();
      if (firstPartAt === undefined) {
        firstPartAt = arrivedAt;
      } else {
        serverDecodeMs += arrivedAt - lastResumeAt;
      }

      try {
        await throwIfAborted(activeSignal);

        // Notify raw part callback (deep copy to avoid aliasing mutations).
        if (callbacks?.onMessagePart !== undefined) {
          await awaitWithAbort(callbacks.onMessagePart(deepCopyPart(part)), activeSignal);
          await throwIfAborted(activeSignal);
        }

        // Index-based routing for parallel tool call argument deltas.
        // When a ToolCallPart arrives with an index referring to a tool call
        // that is NOT the currently-pending one, append it directly to the
        // correct ToolCall in message.toolCalls instead of relying on sequential
        // merging. This prevents argument cross-contamination across parallel calls.
        if (
          isToolCallPart(part) &&
          part.index !== undefined &&
          !isPendingToolCallAtIndex(pendingPart, part.index)
        ) {
          const arrayIdx = toolCallIndexMap.get(part.index);
          if (arrayIdx !== undefined) {
            const target = message.toolCalls[arrayIdx];
            if (target !== undefined && part.argumentsPart !== null) {
              target.arguments =
                target.arguments === null
                  ? part.argumentsPart
                  : target.arguments + part.argumentsPart;
            }
            continue;
          }
          // Unknown index — fall through to the sequential logic as a safety net.
        }

        if (pendingPart === null) {
          pendingPart = part;
        } else if (!mergeInPlace(pendingPart, part)) {
          // Could not merge — flush the pending part and start a new one.
          // For parallel tool calls this happens when a new ToolCall header arrives
          // while a previous ToolCall is still pending; the flush finalizes the
          // previous tool call into `message.toolCalls`.
          flushPart(message, pendingPart, toolCallIndexMap);
          pendingPart = part;
        }
      } finally {
        lastResumeAt = Date.now();
        clientConsumeMs += lastResumeAt - arrivedAt;
      }
    }

    await throwIfAborted(activeSignal);
    if (firstPartAt !== undefined) {
      serverDecodeMs += Date.now() - lastResumeAt;
    }
    options?.onStreamEnd?.(
      firstPartAt === undefined ? undefined : { serverDecodeMs, clientConsumeMs },
    );

    // Flush the last pending part.
    if (pendingPart !== null) {
      flushPart(message, pendingPart, toolCallIndexMap);
    }
    if (message.content.length === 0 && message.toolCalls.length === 0) {
      throw new APIEmptyResponseError(
        'The API returned an empty response (no content, no tool calls).' +
          formatFinishReasonHint(stream) +
          ` Provider: ${provider.name}, model: ${provider.modelName}`,
        {
          finishReason: stream.finishReason,
          rawFinishReason: stream.rawFinishReason,
        },
      );
    }

    // Think-only response (no real text, no tool calls) is treated as incomplete.
    const hasThink = message.content.some((p) => p.type === 'think');
    const hasText = message.content.some((p) => p.type === 'text' && p.text.trim().length > 0);
    const hasToolCalls = message.toolCalls.length > 0;

    if (hasThink && !hasText && !hasToolCalls) {
      throw new APIEmptyResponseError(
        'The API returned a response containing only thinking content ' +
          'without any text or tool calls. This usually indicates the ' +
          'stream was interrupted or the output token budget was exhausted ' +
          'during reasoning.' +
          formatFinishReasonHint(stream) +
          ` Provider: ${provider.name}, model: ${provider.modelName}`,
        {
          finishReason: stream.finishReason,
          rawFinishReason: stream.rawFinishReason,
        },
      );
    }

    // Fire onToolCall for every fully-assembled tool call, in final order.
    if (callbacks?.onToolCall !== undefined) {
      for (const toolCall of message.toolCalls) {
        await throwIfAborted(activeSignal);
        await awaitWithAbort(callbacks.onToolCall(toolCall), activeSignal);
      }
    }

    return {
      id: stream.id,
      message,
      usage: stream.usage,
      finishReason: stream.finishReason,
      rawFinishReason: stream.rawFinishReason,
      responseHeaders: stream.responseHeaders,
      rateLimits: parseResponseRateLimits(stream.responseHeaders),
    };
  } catch (error) {
    // On idle/open timeout — or a caller abort that fired while the chunk wait
    // was stuck — actively cancel the underlying HTTP stream so the
    // connection is released promptly rather than lingering until the OS
    // reclaims it.
    if (
      activeSignal.aborted ||
      error instanceof APITimeoutError ||
      (error instanceof DOMException && error.name === 'AbortError')
    ) {
      if (error instanceof APITimeoutError) abortScope.abortWith(error);
      await cancelRequest();
    }
    // Caller Esc can race the SDK's APIUserAbortError. Coerce back to AbortError
    // so the retry layer does not treat a user cancel as a transport timeout.
    rethrowIfCallerCancelled(options?.signal, abortScope.openTimedOut());
    if (activeSignal.aborted && activeSignal.reason instanceof APITimeoutError) {
      throw activeSignal.reason;
    }
    throw error;
  } finally {
    liveness.dispose();
    activeSignal.removeEventListener('abort', onStreamAbort);
    abortScope.dispose();
  }
}

/** Preserve callback backpressure, but do not let it hide transport cancellation. */
function awaitWithAbort<T>(pending: T | Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener('abort', onAbort);
      // One microtask later: a callback that already settled (e.g. it aborted
      // synchronously and then returned) keeps its result; only a callback
      // still pending is cut off.
      queueMicrotask(() => {
        reject(signal.reason instanceof Error ? signal.reason : new DOMException('The operation was aborted.', 'AbortError'));
      });
    };
    signal.addEventListener('abort', onAbort, { once: true });
    // Attach both handlers even after abort so a late callback rejection is
    // consumed; it cannot resume merging or deliver subsequent parts.
    Promise.resolve(pending).then(
      value => { signal.removeEventListener('abort', onAbort); resolve(value); },
      error => { signal.removeEventListener('abort', onAbort); reject(error); },
    );
    if (signal.aborted) onAbort();
  });
}

/** True when a streamed part should reset the idle silence budget. */
export function isSubstantiveStreamPart(part: StreamedMessagePart): boolean {
  if (part.type === 'text') return part.text.length > 0;
  if (part.type === 'think') {
    return part.think.length > 0 || (part.encrypted !== undefined && part.encrypted.length > 0);
  }
  if (part.type === 'function') return true;
  if (part.type === 'tool_call_part') {
    return part.argumentsPart !== null && part.argumentsPart.length > 0;
  }
  // image/audio/video content parts count as activity when present.
  return true;
}

type CancelableStream = StreamedMessage & {
  cancel?: () => unknown;
  return?: () => unknown;
};

function throwAbortError(): never {
  throw new DOMException('The operation was aborted.', 'AbortError');
}

/**
 * Rethrow the abort signal's own reason instead of a synthetic AbortError.
 * Preserving the reason lets downstream classification tell a caller cancel
 * (Esc, session close) apart from a transport timeout, so cancellations are
 * never recorded as provider cooldowns.
 */
function throwCallerAbortReason(signal: AbortSignal): never {
  const reason: unknown = signal.reason;
  if (reason instanceof Error) {
    throw reason;
  }
  throwAbortError();
}

function rethrowIfCallerCancelled(
  signal: AbortSignal | undefined,
  openTimedOut: boolean,
): void {
  if (signal?.aborted === true && !openTimedOut) {
    throwCallerAbortReason(signal);
  }
}

async function cancelStream(stream: StreamedMessage): Promise<void> {
  const cancelable = stream as CancelableStream;

  // Teardown is best-effort and must not surface: this only runs on the abort
  // path, where the caller is about to receive the caller's abort reason.
  // Rethrowing here would replace a meaningful AbortError with a provider
  // teardown failure (a closed socket, an already-destroyed reader), which is
  // both less accurate and noisier for the user.
  try {
    await cancelable.cancel?.();
  } catch {}

  try {
    await cancelable.return?.();
  } catch {}
}

async function throwIfAborted(signal?: AbortSignal, stream?: StreamedMessage): Promise<void> {
  if (!signal?.aborted) {
    return;
  }

  if (stream !== undefined) {
    await cancelStream(stream);
  }

  throwCallerAbortReason(signal);
}

/** True when `pending` is a ToolCall whose _streamIndex equals `index`. */
function isPendingToolCallAtIndex(
  pending: StreamedMessagePart | null,
  index: number | string,
): pending is ToolCall {
  return pending !== null && isToolCall(pending) && pending._streamIndex === index;
}

/**
 * Append a fully-merged part to the message.
 *
 * - ContentPart -> message.content
 * - ToolCall    -> message.toolCalls (the `_streamIndex` routing key is
 *                  registered in the map and stripped before storage).
 * - ToolCallPart -> ignored (orphaned delta without a matching pending call)
 */
function flushPart(
  message: Message,
  part: StreamedMessagePart,
  toolCallIndexMap: Map<number | string, number>,
): void {
  if (isContentPart(part)) {
    message.content.push(part);
    return;
  }
  if (isToolCall(part)) {
    const streamIndex = part._streamIndex;
    const stored: StoredToolCall = {
      type: 'function',
      id: part.id,
      name: part.name,
      arguments: part.arguments,
      extras: part.extras,
    };
    const ordinal = message.toolCalls.length;
    message.toolCalls.push(stored as ToolCall);
    if (streamIndex !== undefined) {
      toolCallIndexMap.set(streamIndex, ordinal);
    }
  }
  // ToolCallPart: orphaned delta — silently ignore.
}

function formatFinishReasonHint(stream: StreamedMessage): string {
  if (stream.finishReason === null && stream.rawFinishReason === null) return '';

  const raw =
    stream.rawFinishReason === null ? '' : `, rawFinishReason=${stream.rawFinishReason}`;
  const filteredHint =
    stream.finishReason === 'filtered'
      ? ' The provider filtered the response before visible output was emitted.'
      : '';

  return ` Provider stop details: finishReason=${stream.finishReason ?? 'unknown'}${raw}.${filteredHint}`;
}

/**
 * Produce a shallow-ish copy of a StreamedMessagePart.
 *
 * This is intentionally minimal: we only need isolation for the mutable
 * string fields that `mergeInPlace` mutates (text, think, arguments).
 */
function deepCopyPart(part: StreamedMessagePart): StreamedMessagePart {
  return structuredClone(part);
}
