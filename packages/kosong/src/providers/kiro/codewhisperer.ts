import type { Message, StreamedMessagePart, ToolCall } from '#/message';
import type {
  ChatProvider,
  FinishReason,
  GenerateOptions,
  MaxCompletionTokensOptions,
  ProviderRequestAuth,
  StreamedMessage,
  ThinkingEffort,
} from '#/provider';
import type { Tool } from '#/tool';
import type { TokenUsage } from '#/usage';

import {
  decodeAmazonEventStream,
  type EventStreamMessage,
} from './kiro-eventstream';

export interface KiroCodeWhispererOptions {
  readonly model: string;
  /** CodeWhisperer endpoint host, e.g. `https://codewhisperer.us-east-1.amazonaws.com`. */
  readonly baseUrl?: string;
  /** Static bearer token fallback (OAuth resolves a fresh token per request). */
  readonly apiKey?: string;
  /** Profile ARN for enterprise IAM Identity Center accounts. */
  readonly profileArn?: string;
  readonly defaultMaxTokens?: number;
  readonly defaultHeaders?: Record<string, string>;
  readonly clientFactory?: (auth: ProviderRequestAuth) => KiroClient;
}

/** Minimal HTTP surface the provider needs; injectable for tests. */
export interface KiroClient {
  readonly url: string;
  fetch: typeof fetch;
}

interface KiroToolSpec {
  readonly toolSpecification: {
    readonly name: string;
    readonly description?: string;
    readonly inputSchema: { readonly json: unknown };
  };
}

interface KiroToolResult {
  readonly toolResultMessage: {
    readonly content: string;
    readonly toolUseId: string;
    readonly status: 'success' | 'error';
  };
}

const KIRO_STREAMING_SERVICE = 'codewhisperer';
const KIRO_DEFAULT_REGION = 'us-east-1';

/** Translates `claude-sonnet-4-6` style ids to the wire's `claude-sonnet-4.6`. */
export function toKiroModelId(modelId: string): string {
  return modelId.replaceAll(/(\d)-(\d)/g, '$1.$2');
}

interface KiroUserInputMessageContext {
  readonly tools?: { readonly tools: KiroToolSpec[] };
  readonly toolResults?: { readonly toolResults: KiroToolResult[][] };
}

interface KiroUserInputMessage {
  readonly content: string;
  readonly modelId: string;
  readonly userInputMessageContext?: KiroUserInputMessageContext;
  readonly origin?: string;
}

interface KiroAssistantResponseMessage {
  readonly content: string;
}

type KiroHistoryMessage =
  | { readonly userInputMessage: KiroUserInputMessage }
  | { readonly assistantResponseMessage: KiroAssistantResponseMessage };

interface KiroConversationState {
  readonly chatTriggerType: 'MANUAL';
  readonly currentMessage: { readonly userInputMessage: KiroUserInputMessage };
  readonly history?: KiroHistoryMessage[];
  readonly profileArn?: string;
}

function kiroUserAgent(): string {
  const mid = globalThis.crypto.randomUUID().replaceAll('-', '');
  return `aws-sdk-rust/1.0.0 ua/2.1 os/other lang/rust api/codewhispererstreaming#1.28.3 m/E app/AmazonQ-For-CLI md/appVersion-1.28.3-${mid}`;
}

interface KiroStreamedState {
  readonly parts: StreamedMessagePart[];
  readonly usage: TokenUsage;
  finishReason: string | null;
  id: string | null;
}

class KiroStreamedMessage implements StreamedMessage {
  private readonly _state: KiroStreamedState;

  readonly _iter: AsyncGenerator<StreamedMessagePart>;

  constructor(state: KiroStreamedState, iter: AsyncGenerator<StreamedMessagePart>) {
    this._state = state;
    this._iter = iter;
  }

  get id(): string | null {
    return this._state.id;
  }

  get usage(): TokenUsage | null {
    return this._state.usage;
  }

  get finishReason(): FinishReason | null {
    switch (this._state.finishReason) {
      case 'tool_use':
        return 'tool_calls';
      case 'max_tokens':
        return 'truncated';
      case null:
        return null;
      default:
        return 'completed';
    }
  }

  get rawFinishReason(): string | null {
    return this._state.finishReason;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<StreamedMessagePart> {
    yield* this._iter;
  }
}

/**
 * ChatProvider for Kiro / Amazon Q Developer via the CodeWhisperer streaming
 * service. Requests are `GenerateAssistantResponse` JSON with a conversation
 * state; responses are `application/vnd.amazon.eventstream` frames carrying
 * `assistantResponseEvent` text deltas and `toolUseEvent` tool calls.
 */
export class KiroCodeWhispererChatProvider implements ChatProvider {
  readonly name: string = 'codewhisperer';

  private readonly _model: string;
  private readonly _apiKey: string | undefined;
  private readonly _profileArn: string | undefined;
  private readonly _defaultMaxTokens: number;
  private readonly _defaultHeaders: Record<string, string> | undefined;
  private readonly _clientFactory: ((auth: ProviderRequestAuth) => KiroClient) | undefined;
  private readonly _region: string;

  constructor(options: KiroCodeWhispererOptions) {
    this._model = toKiroModelId(options.model);
    this._apiKey = options.apiKey;
    this._profileArn = options.profileArn;
    this._defaultMaxTokens = options.defaultMaxTokens ?? 8192;
    this._defaultHeaders = options.defaultHeaders;
    this._clientFactory = options.clientFactory;
    this._region = parseRegion(options.baseUrl) ?? KIRO_DEFAULT_REGION;
  }

  get modelName(): string {
    return this._model;
  }

  get thinkingEffort(): ThinkingEffort | null {
    // The CodeWhisperer wire has no effort knob.
    return null;
  }

  get modelParameters(): Record<string, unknown> {
    return { model: this._model, region: this._region };
  }

  async generate(
    systemPrompt: string,
    tools: Tool[],
    history: Message[],
    options?: GenerateOptions,
  ): Promise<StreamedMessage> {
    const apiKey = options?.auth?.apiKey ?? this._apiKey ?? '';
    if (apiKey.length === 0) {
      throw new Error(
        'KiroCodeWhispererChatProvider: a Kiro OAuth access token is required. Provide it via options.auth.apiKey on each request.',
      );
    }

    const conversationState = buildConversationState(
      this._model,
      systemPrompt,
      tools,
      history,
      this._profileArn,
    );
    const client = this._createClient(options?.auth);
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/vnd.amazon.eventstream',
      authorization: `Bearer ${apiKey}`,
      'amzn-X-amz-target': 'AmazonCodeWhispererService.GenerateAssistantResponse',
      'user-agent': kiroUserAgent(),
      ...(this._defaultHeaders),
      ...(options?.auth?.headers),
    };
    if (this._profileArn !== undefined) {
      headers['x-amzn-codewhisperer-proflearn'] = this._profileArn;
    }

    options?.onRequestSent?.();
    let response: Response;
    try {
      response = await client.fetch(client.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ conversationState }),
        redirect: 'error',
        ...(options?.signal !== undefined ? { signal: options.signal } : {}),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      throw error;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Kiro CodeWhisperer HTTP ${String(response.status)}: ${text.slice(0, 1000)}`);
    }
    const responseBody = response.body;
    if (responseBody === null) {
      throw new Error('Kiro CodeWhisperer response has no body');
    }

    const state: KiroStreamedState = {
      parts: [],
      usage: { inputOther: 0, output: 0, inputCacheRead: 0, inputCacheCreation: 0 },
      finishReason: null,
      id: null,
    };
    const iter = this._consumeStream(decodeAmazonEventStream(responseBody), state, options?.signal);
    return new KiroStreamedMessage(state, iter);
  }

  private async *_consumeStream(
    messages: AsyncGenerator<EventStreamMessage>,
    state: KiroStreamedState,
    signal: AbortSignal | undefined,
  ): AsyncGenerator<StreamedMessagePart> {
    const decoder = new TextDecoder();
    for await (const message of messages) {
      if (signal?.aborted) throw new Error('Request was aborted');

      const messageType = message.headers[':message-type'];
      const eventType = message.headers[':event-type'];

      if (messageType === 'exception') {
        const exceptionType = message.headers[':exception-type'] ?? 'Exception';
        const payload = safeParsePayload(message.payload, decoder) as { message?: string } | undefined;
        const errorMessage = payload?.message ?? decoder.decode(message.payload);
        throw new Error(`${exceptionType}: ${errorMessage}`);
      }
      if (messageType === 'error') {
        const code = message.headers[':error-code'] ?? 'UnknownError';
        const errorMessage = message.headers[':error-message'] ?? decoder.decode(message.payload);
        throw new Error(`${code}: ${errorMessage}`);
      }
      if (messageType !== 'event') continue;

      const payload = safeParsePayload(message.payload, decoder);
      if (payload === undefined) continue;

      if (eventType === 'assistantResponseEvent') {
        const event = payload as { assistantResponseEvent?: { content?: string } };
        const content = event.assistantResponseEvent?.content;
        if (content !== undefined && content.length > 0) {
          const part: StreamedMessagePart = { type: 'text', text: content };
          state.parts.push(part);
          yield part;
        }
        continue;
      }
      if (eventType === 'toolUseEvent') {
        const event = payload as {
          toolUseEvent?: { toolUseId?: string; name?: string; input?: unknown; stop?: { stopReason?: string } };
        };
        const toolEvent = event.toolUseEvent;
        if (toolEvent === undefined) continue;
        if (toolEvent.stop?.stopReason !== undefined) {
          state.finishReason = toolEvent.stop.stopReason;
        }
        if (toolEvent.input === undefined && toolEvent.name === undefined) continue;
        let args: string | null;
        if (toolEvent.input === undefined || toolEvent.input === null) {
          args = null;
        } else if (typeof toolEvent.input === 'string') {
          args = toolEvent.input;
        } else {
          args = JSON.stringify(toolEvent.input);
        }
        const toolCall: ToolCall = {
          type: 'function',
          id: toolEvent.toolUseId ?? '',
          name: toolEvent.name ?? '',
          arguments: args,
          _streamIndex: state.parts.length,
        };
        state.parts.push(toolCall);
        yield toolCall;
        continue;
      }
      if (eventType === 'messageMetadataEvent') {
        const event = payload as { messageMetadataEvent?: { conversationId?: string } };
        const conversationId = event.messageMetadataEvent?.conversationId;
        if (conversationId !== undefined) state.id = conversationId;
        continue;
      }
      const errorPayload = payload as { error?: { message?: string } };
      if (errorPayload.error?.message !== undefined) {
        throw new Error(`Kiro CodeWhisperer stream error: ${errorPayload.error.message}`);
      }
      // Known-but-unhandled events (codeReferenceEvent, citationEvent, …) and
      // unknown event types are ignored for forward compatibility.
    }
  }

  withThinking(_effort: ThinkingEffort): KiroCodeWhispererChatProvider {
    // No effort knob on the CodeWhisperer wire — return the same provider.
    return this;
  }

  withMaxCompletionTokens(
    maxCompletionTokens: number,
    _options?: MaxCompletionTokensOptions,
  ): KiroCodeWhispererChatProvider {
    void maxCompletionTokens;
    return this;
  }

  private _createClient(auth: ProviderRequestAuth | undefined): KiroClient {
    if (this._clientFactory !== undefined) return this._clientFactory(auth ?? {});
    const baseUrl = (auth?.baseUrl ?? `https://${KIRO_STREAMING_SERVICE}.${this._region}.amazonaws.com`).replace(/\/+$/, '');
    return { url: `${baseUrl}/`, fetch };
  }
}

function parseRegion(baseUrl: string | undefined): string | undefined {
  if (baseUrl === undefined) return undefined;
  const match = /codewhisperer\.([a-z0-9-]+)\.amazonaws\.com/.exec(baseUrl);
  return match?.[1];
}

function buildConversationState(
  modelId: string,
  systemPrompt: string,
  tools: Tool[],
  history: Message[],
  profileArn: string | undefined,
): KiroConversationState {
  const toolContext: { tools: { tools: KiroToolSpec[] } } | undefined =
    tools.length > 0
      ? {
          tools: {
            tools: tools.map((tool) => ({
              toolSpecification: {
                name: tool.name,
                description: tool.description ?? '',
                inputSchema: { json: tool.parameters },
              },
            })),
          },
        }
      : undefined;

  const historyMessages: KiroHistoryMessage[] = [];
  for (const [index, message] of history.entries()) {
    const systemPrefix = index === 0 && systemPrompt.length > 0 ? `${systemPrompt}\n\n` : '';
    if (message.role === 'assistant') {
      const text = messageText(message);
      const toolCalls = message.toolCalls
        .map((call) => JSON.stringify({ toolUseId: call.id, name: call.name, input: parseMaybeJson(call.arguments) }))
        .join('\n');
      const content = [text, toolCalls].filter((entry) => entry.length > 0).join('\n');
      historyMessages.push({ assistantResponseMessage: { content } });
      continue;
    }
    if (message.role === 'tool') {
      historyMessages.push({
        userInputMessage: {
          content: systemPrefix + messageText(message),
          modelId,
          ...(toolContext === undefined
            ? {}
            : {
                userInputMessageContext: {
                  ...toolContext,
                  toolResults: {
                    toolResults: [
                      [
                        {
                          toolResultMessage: {
                            content: messageText(message),
                            toolUseId: message.toolCallId ?? '',
                            status: 'success' as const,
                          },
                        },
                      ],
                    ],
                  },
                },
              }),
        },
      });
      continue;
    }
    historyMessages.push({
      userInputMessage: {
        content: systemPrefix + messageText(message),
        modelId,
        ...(toolContext === undefined ? {} : { userInputMessageContext: toolContext }),
      },
    });
  }

  const lastEntry = historyMessages.at(-1);
  const currentMessage =
    lastEntry !== undefined && 'userInputMessage' in lastEntry
      ? lastEntry.userInputMessage
      : { content: '', modelId };

  return {
    chatTriggerType: 'MANUAL',
    currentMessage: { userInputMessage: currentMessage },
    history: historyMessages.slice(0, -1),
    ...(profileArn === undefined ? {} : { profileArn }),
  };
}

function messageText(message: Message): string {
  return message.content
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('');
}

function parseMaybeJson(raw: string | null): unknown {
  if (raw === null || raw.length === 0) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function safeParsePayload(
  payload: Uint8Array,
  decoder: { decode(bytes: Uint8Array): string },
): Record<string, unknown> | undefined {
  if (payload.length === 0) return undefined;
  try {
    return JSON.parse(decoder.decode(payload)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
