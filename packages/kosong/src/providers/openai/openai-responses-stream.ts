import { ChatProviderError } from '#/errors';
import type { StreamedMessagePart, ToolCall } from '#/message';
import type { FinishReason, ResponseHeaders, StreamedMessage } from '#/provider';
import type { TokenUsage } from '#/usage';

import { convertOpenAIError } from '#/providers/openai/openai-common';
import {
  errorFromOpenAIResponsesEvent,
  failResponsesDecode,
  formatResponseStreamIndex,
  formatResponsesFailedResponse,
  functionCallId,
  hasOwn,
  malformedStreamErrorEvent,
  normalizeResponsesFinishReason,
  readNullableStringField,
  readNumberField,
  readObjectArrayField,
  readObjectField,
  readResponseOutputItem,
  readResponsesFailedResponseError,
  readStringField,
  requireFunctionCallName,
  requireObjectField,
  requireStringField,
  responseStreamIndex,
  type RawObject,
} from '#/providers/openai/openai-responses-decode';

export class OpenAIResponsesStreamedMessage implements StreamedMessage {
  private _id: string | null = null;
  private _usage: TokenUsage | null = null;
  private _finishReason: FinishReason | null = null;
  private _rawFinishReason: string | null = null;
  private readonly _iter: AsyncGenerator<StreamedMessagePart>;

  constructor(
    response: unknown,
    isStream: boolean,
    readonly responseHeaders?: ResponseHeaders,
  ) {
    if (isStream) {
      this._iter = this._convertStreamResponse(response as AsyncIterable<RawObject>);
    } else {
      this._iter = this._convertNonStreamResponse(response as RawObject);
    }
  }

  get id(): string | null {
    return this._id;
  }

  get usage(): TokenUsage | null {
    return this._usage;
  }

  get finishReason(): FinishReason | null {
    return this._finishReason;
  }

  get rawFinishReason(): string | null {
    return this._rawFinishReason;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<StreamedMessagePart> {
    yield* this._iter;
  }

  private _captureFinishReasonFromResponse(response: RawObject): void {
    const status = readNullableStringField(response, 'status');
    const incomplete = readObjectField(response, 'incomplete_details');
    const incompleteReason = incomplete ? readStringField(incomplete, 'reason') : null;
    const normalized = normalizeResponsesFinishReason(status, incompleteReason);
    this._finishReason = normalized.finishReason;
    this._rawFinishReason = normalized.rawFinishReason;
  }

  private _extractUsage(usage: RawObject): void {
    const inputTokens = readNumberField(usage, 'input_tokens') ?? 0;
    const outputTokens = readNumberField(usage, 'output_tokens') ?? 0;
    const details = readObjectField(usage, 'input_tokens_details');
    const cached = details ? (readNumberField(details, 'cached_tokens') ?? 0) : 0;
    this._usage = {
      inputOther: inputTokens - cached,
      output: outputTokens,
      inputCacheRead: cached,
      inputCacheCreation: 0,
    };
  }

  private async *_convertNonStreamResponse(
    response: RawObject,
  ): AsyncGenerator<StreamedMessagePart> {
    this._id = readStringField(response, 'id') ?? null;
    const usage = readObjectField(response, 'usage');
    if (usage !== undefined) {
      this._extractUsage(usage);
    }
    this._captureFinishReasonFromResponse(response);

    const output = readObjectArrayField(response, 'output');
    if (output === undefined) return;

    for (const item of output) {
      const outputItem = readResponseOutputItem(item, 'response.output item');

      if (outputItem.type === 'message') {
        for (const contentItem of outputItem.content) {
          if (contentItem['type'] === 'output_text') {
            const text = readStringField(contentItem, 'text');
            if (text !== undefined) {
              yield { type: 'text', text };
            }
          }
        }
      } else if (outputItem.type === 'function_call') {
        yield {
          type: 'function',
          id: functionCallId(outputItem.callId),
          name: requireFunctionCallName(outputItem),
          arguments: outputItem.arguments ?? null,
        } satisfies ToolCall;
      } else if (outputItem.type === 'reasoning') {
        for (const summary of outputItem.summary) {
          const text = readStringField(summary, 'text');
          if (text === undefined) continue;
          const thinkPart: StreamedMessagePart = {
            type: 'think',
            think: text,
          };
          if (outputItem.encryptedContent !== undefined) {
            (thinkPart as { encrypted: string }).encrypted = outputItem.encryptedContent;
          }
          yield thinkPart;
        }
      }
    }
  }

  private async *_convertStreamResponse(
    response: AsyncIterable<RawObject>,
  ): AsyncGenerator<StreamedMessagePart> {
    const functionCallArgumentsByIndex = new Map<number | string, string>();
    let unindexedFunctionCallArguments: string | undefined;

    const hasFunctionCallArguments = (streamIndex: number | string | undefined): boolean =>
      streamIndex === undefined
        ? unindexedFunctionCallArguments !== undefined
        : functionCallArgumentsByIndex.has(streamIndex);

    const getFunctionCallArguments = (streamIndex: number | string | undefined): string =>
      streamIndex === undefined
        ? (unindexedFunctionCallArguments as string)
        : functionCallArgumentsByIndex.get(streamIndex)!;

    const setFunctionCallArguments = (
      streamIndex: number | string | undefined,
      argumentsValue: string,
    ): void => {
      if (streamIndex === undefined) {
        unindexedFunctionCallArguments = argumentsValue;
      } else {
        functionCallArgumentsByIndex.set(streamIndex, argumentsValue);
      }
    };

    const appendFunctionCallArguments = (
      streamIndex: number | string | undefined,
      argumentsPart: string,
      context: string,
    ): void => {
      if (!hasFunctionCallArguments(streamIndex)) {
        failResponsesDecode(
          context,
          `received function-call arguments for unknown stream index ${formatResponseStreamIndex(streamIndex)}.`,
        );
      }
      setFunctionCallArguments(
        streamIndex,
        getFunctionCallArguments(streamIndex) + argumentsPart,
      );
    };

    const yieldFinalArgumentsSuffix = function* (
      streamIndex: number | string | undefined,
      finalArguments: string,
      context: string,
    ): Generator<StreamedMessagePart> {
      if (!hasFunctionCallArguments(streamIndex)) {
        failResponsesDecode(
          context,
          `received final function-call arguments for unknown stream index ${formatResponseStreamIndex(streamIndex)}.`,
        );
      }

      const accumulatedArguments = getFunctionCallArguments(streamIndex);
      if (finalArguments === accumulatedArguments) {
        return;
      }

      if (!finalArguments.startsWith(accumulatedArguments)) {
        throw new ChatProviderError(
          `OpenAI Responses final function-call arguments for stream index ${formatResponseStreamIndex(
            streamIndex,
          )} do not match the streamed argument deltas.`,
        );
      }

      const suffix = finalArguments.slice(accumulatedArguments.length);
      setFunctionCallArguments(streamIndex, finalArguments);
      if (suffix.length === 0) {
        return;
      }

      const part: StreamedMessagePart = {
        type: 'tool_call_part',
        argumentsPart: suffix,
      };
      if (streamIndex !== undefined) {
        (part as { index: number | string }).index = streamIndex;
      }
      yield part;
    };

    try {
      for await (const chunk of response) {
        const type = readStringField(chunk, 'type');
        if (type === undefined) {
          if (!hasOwn(chunk, 'type')) {
            const message = readStringField(chunk, 'message');
            if (message !== undefined) {
              throw malformedStreamErrorEvent(message);
            }
          }
          failResponsesDecode('stream event.type', 'must be a string.');
        }

        switch (type) {
          case 'response.output_text.delta':
            yield { type: 'text', text: requireStringField(chunk, 'delta', type) };
            break;
          case 'response.created':
          case 'response.in_progress': {
            const responseObject = requireObjectField(chunk, 'response', type);
            // Initial events carry the Responses API `response.id`. Record it
            // here so callers that inspect `stream.id` before the stream
            // completes see the actual response id rather than a later
            // output-item identifier.
            const respId = readStringField(responseObject, 'id');
            if (respId !== undefined) {
              this._id = respId;
            }
            break;
          }
          case 'response.output_item.added': {
            const item = readResponseOutputItem(chunk['item'], `${type}.item`);
            const outputIndex = readNumberField(chunk, 'output_index');
            // NOTE: `item.id` here is an output-item identifier, not the
            // Responses API `response.id`. Do NOT overwrite `this._id` — it
            // would clobber the real response id (or leave it undefined for
            // tool-call items that have no `item.id`).
            if (item.type === 'function_call') {
              // The Responses API routes streaming argument deltas via
              // `item_id`, which matches `item.id` on output_item.added.
              // Preserve it so the generate loop can dispatch interleaved
              // deltas across parallel function calls correctly.
              const streamIndex = responseStreamIndex(item.itemId, outputIndex);
              setFunctionCallArguments(streamIndex, item.arguments ?? '');
              const tc: ToolCall = {
                type: 'function',
                id: functionCallId(item.callId),
                name: requireFunctionCallName(item),
                arguments: item.arguments ?? null,
              };
              if (streamIndex !== undefined) {
                tc._streamIndex = streamIndex;
              }
              yield tc;
            }
            break;
          }
          case 'response.output_item.done': {
            const item = readResponseOutputItem(chunk['item'], `${type}.item`);
            const outputIndex = readNumberField(chunk, 'output_index');
            // Same as output_item.added: `item.id` is not the response id.
            if (item.type === 'reasoning') {
              const thinkPart: StreamedMessagePart = { type: 'think', think: '' };
              if (item.encryptedContent !== undefined) {
                (thinkPart as { encrypted: string }).encrypted = item.encryptedContent;
              }
              yield thinkPart;
            } else if (item.type === 'function_call' && typeof item.arguments === 'string') {
              const streamIndex = responseStreamIndex(item.itemId, outputIndex);
              yield* yieldFinalArgumentsSuffix(streamIndex, item.arguments, type);
            }
            break;
          }
          case 'response.function_call_arguments.delta': {
            // `item_id` uniquely identifies the function_call output item this
            // delta belongs to; use it as the streaming index.
            const streamIndex = responseStreamIndex(
              readStringField(chunk, 'item_id'),
              readNumberField(chunk, 'output_index'),
            );
            const argumentsPart = requireStringField(chunk, 'delta', type);
            const part: StreamedMessagePart = {
              type: 'tool_call_part',
              argumentsPart,
            };
            appendFunctionCallArguments(streamIndex, argumentsPart, type);
            if (streamIndex !== undefined) {
              (part as { index: number | string }).index = streamIndex;
            }
            yield part;
            break;
          }
          case 'response.function_call_arguments.done': {
            const functionArguments = requireStringField(chunk, 'arguments', type);
            const streamIndex = responseStreamIndex(
              readStringField(chunk, 'item_id'),
              readNumberField(chunk, 'output_index'),
            );
            yield* yieldFinalArgumentsSuffix(streamIndex, functionArguments, type);
            break;
          }
          case 'response.reasoning_summary_part.added':
            yield { type: 'think', think: '' };
            break;
          case 'response.reasoning_summary_text.delta':
            yield { type: 'think', think: requireStringField(chunk, 'delta', type) };
            break;
          case 'response.completed':
          case 'response.incomplete': {
            const responseObject = requireObjectField(chunk, 'response', type);
            // Final event confirms the Responses API `response.id`. Prefer
            // it over any earlier value in case the API refines it.
            const respId = readStringField(responseObject, 'id');
            if (respId !== undefined) {
              this._id = respId;
            }
            const usage = readObjectField(responseObject, 'usage');
            if (usage !== undefined) {
              this._extractUsage(usage);
            }
            this._captureFinishReasonFromResponse(responseObject);
            break;
          }
          case 'error': {
            const message = requireStringField(chunk, 'message', type);
            throw errorFromOpenAIResponsesEvent(
              'OpenAI Responses stream error',
              readNullableStringField(chunk, 'code') ?? null,
              message,
              readNullableStringField(chunk, 'param') ?? null,
            );
          }
          case 'response.failed': {
            const responseObject = requireObjectField(chunk, 'response', type);
            const error = readResponsesFailedResponseError(responseObject);
            if (error !== undefined) {
              throw errorFromOpenAIResponsesEvent(
                'OpenAI Responses response.failed',
                error.code,
                error.message,
                null,
              );
            }
            throw new ChatProviderError(
              `OpenAI Responses response.failed: ${formatResponsesFailedResponse(responseObject)}`,
            );
          }
          default:
            // Unknown future event types carry no data we currently consume.
            break;
        }
      }
    } catch (error: unknown) {
      throw convertOpenAIError(error);
    }
  }
}
