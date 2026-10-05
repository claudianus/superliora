import { createHash, randomUUID } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

import { APIContextOverflowError, APIStatusError, ChatProviderError } from '../../errors';
import { type ContentPart, type Message, type StreamedMessagePart } from '../../message';
import type {
  ChatProvider,
  FinishReason,
  GenerateOptions,
  MaxCompletionTokensOptions,
  StreamedMessage,
  ThinkingEffort,
} from '../../provider';
import type { Tool } from '../../tool';
import { emptyUsage, type TokenUsage } from '../../usage';
import {
  DEVIN_DEFAULT_BASE_URL,
  devinCliMetadata,
  devinWireMetadata,
} from './devin-identity';
import { decodeDevinUnaryMessage } from './devin-decode';
import {
  AssignModelRequestSchema,
  AssignModelResponseSchema,
  CacheControlType,
  type ChatMessagePrompt,
  ChatMessagePromptSchema,
  ChatMessageRequestType,
  ChatMessageSource,
  ChatToolCallSchema,
  ChatToolChoiceSchema,
  ChatToolDefinitionSchema,
  CompletionConfigurationSchema,
  ConversationalPlannerMode,
  type GetChatMessageRequest,
  GetChatMessageRequestSchema,
  GetChatMessageResponseSchema,
  GetUserJwtRequestSchema,
  GetUserJwtResponseSchema,
  type ImageData,
  ImageDataSchema,
  type Metadata,
  MetadataSchema,
  type ModelAssignment,
  PromptCacheOptionsSchema,
  StopReason,
} from './devin-proto.generated';
import { create, fromBinary, toBinary } from './protobuf';

/**
 * Devin (Cognition) provider — OAuth CLI session tokens drive the Windsurf
 * Cascade backend over the Connect protocol: protobuf payloads, gzip-compressed
 * request frames, and length-prefixed streaming response frames.
 *
 * Ported from oh-my-pi `packages/ai/src/providers/devin.ts` and adapted to the
 * kosong `ChatProvider` contract (StreamedMessage parts instead of omp's event
 * stream).
 */

const CHAT_MESSAGE_PATH = '/exa.api_server_pb.ApiServerService/GetChatMessage';
const DEVIN_ASSIGN_MODEL_PATH = '/exa.api_server_pb.ApiServerService/AssignModel';
const DEVIN_AUTH_PATH = '/exa.auth_pb.AuthService/GetUserJwt';
const DEVIN_DEFAULT_STOP_PATTERNS = [
  '<|user|>',
  '<|bot|>',
  '<|context_request|>',
  '<|endoftext|>',
  '<|end_of_turn|>',
];

/** Connect streaming framing: flag byte bit 0x01 = gzip payload, 0x02 = end-of-stream JSON trailers. */
const CONNECT_COMPRESSED_FLAG = 0x01;
const CONNECT_END_STREAM_FLAG = 0x02;
/**
 * Hard upper bound on a single Connect frame payload. The 4-byte length prefix
 * is otherwise peer-controlled (up to 2**32 - 1), so a corrupt or malicious
 * frame could force gigabytes of buffering. Well above any legitimate Cascade
 * response but tight enough to fail fast.
 */
function stripTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url.codePointAt(end - 1) === 47) end--;
  return end === url.length ? url : url.slice(0, end);
}

const MAX_CONNECT_FRAME_PAYLOAD = 16 * 1024 * 1024;
const MAX_DEVIN_ERROR_DETAIL_CHARS = 4096;
const HTML_ERROR_BODY_PATTERN = /^\s*(?:<!doctype\s+html\b|<html\b)/i;
/** C0/C1 control characters that mark response bytes as untrustworthy diagnostics. */
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/;

/**
 * Uids that are server-side routers rather than concrete chat models: the
 * router uid is never a legal `chatModelUid`, so these resolve through
 * `AssignModel` and the returned uid + assignment JWT ride the chat request.
 * Mirrors oh-my-pi's `isModelRouter && no harnessUids` configs (`adaptive`,
 * `subagent-default`).
 */
const DEVIN_ROUTER_UIDS: ReadonlySet<string> = new Set(['adaptive', 'subagent-default']);

export interface DevinOptions {
  /** Wire model uid (`swe-1-6`, `adaptive`, …). */
  readonly model: string;
  /** Devin OAuth session token (raw or `devin-session-token$` prefixed). */
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly defaultMaxTokens?: number;
  /** Cascade conversation id; reused as `cascade_id` so the server threads turns. */
  readonly conversationId?: string;
  /** Extra completion knobs: `temperature`, `topP`, `maxTokens`, `stopSequences`. */
  readonly generationKwargs?: Record<string, unknown>;
}

interface DevinTurn {
  apiKey: string;
  userJwt: string;
  /** Cascade thread id; assignment and chat must agree on it or the JWT is rejected. */
  cascadeId: string;
  messages: Message[];
}

/** Format the leading 128 bits of `seed`'s SHA-256 digest as a UUID-shaped string. */
function deterministicUuid(seed: string): string {
  const hex = createHash('sha256').update(seed).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** Extract a bounded human error without leaking proxy HTML or binary protobuf. */
function devinErrorDetail(response: Response, payload: Uint8Array): string | undefined {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(payload).trim();
  } catch {
    return undefined;
  }
  if (response.headers.get('content-type')?.toLowerCase().includes('text/html')) return undefined;
  try {
    const decoded: unknown = JSON.parse(text);
    if (typeof decoded === 'object' && decoded !== null) {
      const record = decoded as Record<string, unknown>;
      const error = record['error'];
      if (typeof error === 'object' && error !== null) {
        const message = (error as Record<string, unknown>)['message'];
        if (typeof message === 'string') text = message.trim();
      } else if (typeof error === 'string') {
        text = error.trim();
      } else if (typeof record['message'] === 'string') {
        text = record['message'].trim();
      }
    }
  } catch {
    // Not JSON — use the raw text when it is clean.
  }
  const normalized = text.replaceAll(/\s+/g, ' ').trim();
  if (
    normalized.length === 0 ||
    HTML_ERROR_BODY_PATTERN.test(normalized) ||
    CONTROL_CHARS.test(normalized)
  ) {
    return undefined;
  }
  return normalized.length <= MAX_DEVIN_ERROR_DETAIL_CHARS
    ? normalized
    : normalized.slice(0, MAX_DEVIN_ERROR_DETAIL_CHARS);
}

function createDevinHttpError(operation: string, response: Response, payload: Uint8Array): Error {
  const status = `${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
  const detail = devinErrorDetail(response, payload);
  const message = `Devin ${operation} error ${status}${detail ? `: ${detail}` : ''}`;
  return new APIStatusError(response.status, message, null, response.headers);
}

interface ConnectTrailerError {
  code: string;
  message: string;
  formatted: string;
}

/**
 * Parse a Connect end-of-stream JSON trailer and return its structured error
 * when it carries `{ error: { code, message } }`, else `null`.
 */
function readConnectTrailerError(text: string): ConnectTrailerError | null {
  if (text.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || !('error' in parsed)) return null;
  const err = (parsed as Record<string, unknown>)['error'];
  if (typeof err !== 'object' || err === null) return null;
  const record = err as Record<string, unknown>;
  const code = typeof record['code'] === 'string' ? record['code'] : '';
  const message = typeof record['message'] === 'string' ? record['message'] : '';
  if (!code && !message) return null;
  return { code, message, formatted: `Devin stream error${code ? ` ${code}` : ''}: ${message}` };
}

interface DevinAuthAttempt {
  response: Response;
  payload: Uint8Array;
}

async function requestDevinAuth(
  metadata: Metadata,
  baseUrl: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal | undefined,
): Promise<DevinAuthAttempt> {
  const request = create(GetUserJwtRequestSchema, { metadata });
  const response = await fetchImpl(`${baseUrl}${DEVIN_AUTH_PATH}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/proto',
      'connect-protocol-version': '1',
      accept: '*/*',
    },
    body: toBinary(GetUserJwtRequestSchema, request),
    signal,
  });
  return { response, payload: new Uint8Array(await response.arrayBuffer()) };
}

/**
 * Exchange the session token for a short-lived user JWT. The released-CLI
 * identity goes first; a 401 retries with the raw API-key metadata shape for
 * seats that only accept the legacy form.
 */
async function fetchDevinAuthMetadata(
  apiKey: string | undefined,
  baseUrl: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal | undefined,
): Promise<{ userJwt: string; apiKey: string; baseUrl?: string }> {
  const sessionMetadata = create(MetadataSchema, devinCliMetadata(apiKey));
  let wireApiKey = sessionMetadata.apiKey;
  let attempt = await requestDevinAuth(sessionMetadata, baseUrl, fetchImpl, signal);

  if (attempt.response.status === 401) {
    const apiKeyMetadata = create(MetadataSchema, devinWireMetadata(apiKey));
    if (apiKeyMetadata.apiKey !== sessionMetadata.apiKey) {
      attempt = await requestDevinAuth(apiKeyMetadata, baseUrl, fetchImpl, signal);
      wireApiKey = apiKeyMetadata.apiKey;
    }
  }

  if (!attempt.response.ok) throw createDevinHttpError('auth', attempt.response, attempt.payload);
  const decoded = decodeDevinUnaryMessage(GetUserJwtResponseSchema, attempt.payload);
  if (!decoded?.userJwt) {
    throw new ChatProviderError('Devin auth error: GetUserJwt returned an empty user JWT');
  }
  const customBaseUrl = decoded.customApiServerUrl.trim();
  return {
    userJwt: decoded.userJwt,
    apiKey: wireApiKey,
    ...(customBaseUrl ? { baseUrl: stripTrailingSlashes(customBaseUrl) } : {}),
  };
}

/**
 * Resolve a server-side router (`adaptive`) into the concrete model uid plus
 * the assignment JWT that authorizes it. A failed assignment must fail the
 * turn rather than send the router uid to `GetChatMessage`.
 */
async function assignDevinModel(
  modelUid: string,
  turn: DevinTurn,
  baseUrl: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal | undefined,
): Promise<ModelAssignment> {
  const request = create(AssignModelRequestSchema, {
    metadata: create(MetadataSchema, devinWireMetadata(turn.apiKey)),
    modelRouterUid: modelUid,
    cascadeId: turn.cascadeId,
    chatMessagePrompt: buildRouterPrompt(turn.messages),
  });
  const response = await fetchImpl(`${baseUrl}${DEVIN_ASSIGN_MODEL_PATH}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/proto',
      'connect-protocol-version': '1',
      accept: '*/*',
    },
    body: toBinary(AssignModelRequestSchema, request),
    signal,
  });
  const payload = new Uint8Array(await response.arrayBuffer());
  if (!response.ok) throw createDevinHttpError('AssignModel', response, payload);
  const assignment = decodeDevinUnaryMessage(AssignModelResponseSchema, payload)?.assignment;
  if (!assignment?.assignmentJwt || !assignment.modelUid) {
    throw new ChatProviderError(
      'Devin AssignModel error: response carried no assignment JWT and model uid',
    );
  }
  return assignment;
}

/** The prompt the router scores: the current user turn on its own. */
function buildRouterPrompt(messages: Message[]): ChatMessagePrompt | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const msg = messages[index];
    if (msg !== undefined && (msg.role === 'user' || msg.role === 'system')) {
      return buildUserPrompt(msg, '');
    }
  }
  return undefined;
}

/** Parse a `data:` URL into base64 + mimeType for Cascade `ImageData`. */
function imagePartToImageData(part: ContentPart): ImageData | undefined {
  if (part.type !== 'image_url') return undefined;
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(part.imageUrl.url);
  if (match === null) return undefined;
  return create(ImageDataSchema, {
    base64Data: match[3] ?? '',
    mimeType: match[1] ?? 'image/png',
  });
}

/** Flatten one user/system turn into a Cascade USER prompt with inline images. */
function buildUserPrompt(msg: Message, messageId: string): ChatMessagePrompt {
  let prompt = '';
  const images: ImageData[] = [];
  for (const part of msg.content) {
    if (part.type === 'text') {
      prompt += part.text;
    } else {
      const image = imagePartToImageData(part);
      if (image !== undefined) images.push(image);
    }
  }
  return create(ChatMessagePromptSchema, {
    messageId,
    source: ChatMessageSource.USER,
    prompt,
    images,
  });
}

/** Map kosong `Message` history onto Cascade `ChatMessagePrompt`s (USER / SYSTEM / TOOL channels). */
function buildChatMessagePrompts(messages: Message[], cascadeId: string): ChatMessagePrompt[] {
  const prompts: ChatMessagePrompt[] = [];
  // messageId seeds are `cascadeId\0index\0role[...]` — prompt text is excluded
  // so ids stay stable across content edits / history rebuilds.
  for (const [index, msg] of messages.entries()) {
    if (msg.role === 'user' || msg.role === 'system') {
      prompts.push(buildUserPrompt(msg, deterministicUuid(`${cascadeId}${index}${msg.role}`)));
    } else if (msg.role === 'assistant') {
      let promptText = '';
      let thinkingText = '';
      let signature = '';
      for (const part of msg.content) {
        if (part.type === 'text') {
          promptText += part.text;
        } else if (part.type === 'think') {
          thinkingText += part.think;
          if (!signature && part.encrypted !== undefined) signature = part.encrypted;
        }
      }
      const toolCalls = msg.toolCalls.map((toolCall) =>
        create(ChatToolCallSchema, {
          id: toolCall.id,
          name: toolCall.name,
          argumentsJson: toolCall.arguments ?? '{}',
        }),
      );
      if (!promptText && !thinkingText && !signature && toolCalls.length === 0) continue;
      prompts.push(
        create(ChatMessagePromptSchema, {
          messageId: `bot-${deterministicUuid(`${cascadeId}${index}assistant`)}`,
          source: ChatMessageSource.SYSTEM,
          prompt: promptText,
          thinking: thinkingText,
          signature,
          signatureType: '',
          toolCalls,
        }),
      );
    } else {
      let resultText = '';
      const images: ImageData[] = [];
      for (const part of msg.content) {
        if (part.type === 'text') {
          resultText += part.text;
        } else {
          const image = imagePartToImageData(part);
          if (image !== undefined) images.push(image);
        }
      }
      prompts.push(
        create(ChatMessagePromptSchema, {
          messageId: deterministicUuid(`${cascadeId}${index}tool${msg.toolCallId ?? ''}`),
          source: ChatMessageSource.TOOL,
          toolCallId: msg.toolCallId ?? '',
          prompt: resultText,
          images,
        }),
      );
    }
  }
  return prompts;
}

/**
 * Gemini-routed Cascade uids reject JSON Schema type arrays (`["number",
 * "null"]`) as an opaque `invalid_argument`. Collapse them recursively into
 * `nullable`/`anyOf` shapes Gemini accepts.
 */
function normalizeSchemaForDevinGemini(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeSchemaForDevinGemini);
  if (typeof value !== 'object' || value === null) return value;
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(record)) {
    if (key === 'type' && Array.isArray(item)) {
      const types = item.filter((entry): entry is string => typeof entry === 'string');
      const nonNull = types.filter((entry) => entry !== 'null');
      if (nonNull.length === 1 && types.length !== nonNull.length) {
        out['type'] = nonNull[0];
        out['nullable'] = true;
        continue;
      }
      out['anyOf'] = types.map((entry) => ({ type: entry }));
      continue;
    }
    out[key] = normalizeSchemaForDevinGemini(item);
  }
  return out;
}

interface DevinStreamedState {
  usage: TokenUsage;
  finishReason: string | null;
  id: string | null;
}

class DevinStreamedMessage implements StreamedMessage {
  private readonly _state: DevinStreamedState;
  readonly _iter: AsyncGenerator<StreamedMessagePart>;

  constructor(state: DevinStreamedState, iter: AsyncGenerator<StreamedMessagePart>) {
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
      case 'function_call':
        return 'tool_calls';
      case 'max_tokens':
        return 'truncated';
      case 'content_filter':
        return 'filtered';
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

export class DevinChatProvider implements ChatProvider {
  readonly name: string = 'devin';

  private readonly _model: string;
  private readonly _apiKey: string | undefined;
  private readonly _baseUrl: string;
  private readonly _defaultMaxTokens: number;
  private readonly _conversationId: string | undefined;
  private readonly _generationKwargs: Record<string, unknown> | undefined;

  constructor(options: DevinOptions) {
    this._model = options.model;
    this._apiKey = options.apiKey;
    this._baseUrl = stripTrailingSlashes(options.baseUrl ?? DEVIN_DEFAULT_BASE_URL);
    this._defaultMaxTokens = options.defaultMaxTokens ?? 64_000;
    this._conversationId = options.conversationId;
    this._generationKwargs = options.generationKwargs;
  }

  get modelName(): string {
    return this._model;
  }

  get thinkingEffort(): ThinkingEffort | null {
    return null;
  }

  async generate(
    systemPrompt: string,
    tools: Tool[],
    history: Message[],
    options?: GenerateOptions,
  ): Promise<StreamedMessage> {
    const sessionToken = options?.auth?.apiKey ?? this._apiKey ?? '';
    if (sessionToken.length === 0) {
      throw new Error(
        'DevinChatProvider: a Devin OAuth session token is required. Provide it via options.auth.apiKey on each request.',
      );
    }
    const fetchImpl = fetch;
    const baseUrl = stripTrailingSlashes(options?.auth?.baseUrl ?? this._baseUrl);
    const auth = await fetchDevinAuthMetadata(sessionToken, baseUrl, fetchImpl, options?.signal);
    const chatBaseUrl = auth.baseUrl ?? baseUrl;
    const turn: DevinTurn = {
      apiKey: auth.apiKey,
      userJwt: auth.userJwt,
      cascadeId: this._conversationId ?? randomUUID(),
      messages: history,
    };

    // Router models (`adaptive`) are not valid chat model uids: the server
    // resolves them through AssignModel and expects the returned uid plus
    // assignment JWT on the chat request that shares the cascade id.
    let assignment: ModelAssignment | undefined;
    if (DEVIN_ROUTER_UIDS.has(this._model)) {
      assignment = await assignDevinModel(
        this._model,
        turn,
        chatBaseUrl,
        fetchImpl,
        options?.signal,
      );
    }

    const request = this._buildChatRequest(systemPrompt, tools, turn, assignment);
    const reqBytes = toBinary(GetChatMessageRequestSchema, request);
    const gz = gzipSync(reqBytes);
    const frame = Buffer.alloc(5 + gz.length);
    frame[0] = CONNECT_COMPRESSED_FLAG;
    frame.writeUInt32BE(gz.length, 1);
    frame.set(gz, 5);

    options?.onRequestSent?.();
    const response = await fetchImpl(chatBaseUrl + CHAT_MESSAGE_PATH, {
      method: 'POST',
      headers: {
        'content-type': 'application/connect+proto',
        'connect-protocol-version': '1',
        'connect-content-encoding': 'gzip',
        'accept-encoding': 'identity',
        'user-agent': 'connect-go/1.18.1 (go1.26.3)',
        'connect-accept-encoding': 'gzip',
        ...options?.auth?.headers,
      },
      body: frame,
      signal: options?.signal,
    });

    if (!response.ok) {
      const payload = new Uint8Array(await response.arrayBuffer());
      throw createDevinHttpError('API', response, payload);
    }
    if (response.body === null) {
      throw new ChatProviderError('Devin API error: response body is empty');
    }

    const state: DevinStreamedState = { usage: emptyUsage(), finishReason: null, id: null };
    const iter = this._consumeStream(response.body, state, reqBytes.byteLength);
    return new DevinStreamedMessage(state, iter);
  }

  withThinking(_effort: ThinkingEffort): ChatProvider {
    return this;
  }

  withMaxCompletionTokens(
    maxCompletionTokens: number,
    _options?: MaxCompletionTokensOptions,
  ): ChatProvider {
    const clone = new DevinChatProvider({
      model: this._model,
      apiKey: this._apiKey,
      baseUrl: this._baseUrl,
      defaultMaxTokens: maxCompletionTokens,
      conversationId: this._conversationId,
      generationKwargs: this._generationKwargs,
    });
    return clone;
  }

  private _buildChatRequest(
    systemPrompt: string,
    tools: Tool[],
    turn: DevinTurn,
    assignment: ModelAssignment | undefined,
  ) {
    const kwargs = this._generationKwargs ?? {};
    const stopSequences = Array.isArray(kwargs['stopSequences'])
      ? (kwargs['stopSequences'] as unknown[]).filter((v): v is string => typeof v === 'string')
      : [];
    const stopPatterns =
      stopSequences.length > 0
        ? [...DEVIN_DEFAULT_STOP_PATTERNS, ...stopSequences]
        : DEVIN_DEFAULT_STOP_PATTERNS;
    const chatModelUid = assignment?.modelUid ?? this._model;
    // Devin routes multiple provider families through one Cascade envelope. Its
    // Gemini backend rejects JSON Schema type arrays as an opaque
    // `invalid_argument`; normalize Gemini uids before serializing tools.
    const googleToolSchema =
      this._model.toLowerCase().includes('gemini') ||
      chatModelUid.startsWith('MODEL_GOOGLE_GEMINI_');
    const temperature = typeof kwargs['temperature'] === 'number' ? kwargs['temperature'] : 0.4;
    const topP = typeof kwargs['topP'] === 'number' ? kwargs['topP'] : 1;
    const maxTokens =
      typeof kwargs['maxTokens'] === 'number' ? kwargs['maxTokens'] : this._defaultMaxTokens;
    const wireTools = tools.map((tool) => {
      const schema = tool.parameters;
      return create(ChatToolDefinitionSchema, {
        name: tool.name,
        description: tool.description,
        jsonSchemaString: JSON.stringify(
          googleToolSchema ? normalizeSchemaForDevinGemini(schema) : schema,
        ),
        strict: false,
      });
    });
    return create(GetChatMessageRequestSchema, {
      metadata: create(MetadataSchema, devinWireMetadata(turn.apiKey, turn.userJwt)),
      prompt: systemPrompt,
      chatMessagePrompts: buildChatMessagePrompts(turn.messages, turn.cascadeId),
      chatModelUid,
      ...(assignment ? { modelAssignmentJwt: assignment.assignmentJwt } : {}),
      requestType: ChatMessageRequestType.CASCADE,
      plannerMode: ConversationalPlannerMode.DEFAULT,
      toolChoice: create(ChatToolChoiceSchema, { choice: { case: 'optionName', value: 'auto' } }),
      systemPromptCacheOptions: create(PromptCacheOptionsSchema, {
        type: CacheControlType.EPHEMERAL,
      }),
      disableParallelToolCalls: false,
      cascadeId: turn.cascadeId,
      executionId: randomUUID(),
      configuration: create(CompletionConfigurationSchema, {
        numCompletions: 1n,
        maxTokens: BigInt(Math.trunc(maxTokens)),
        maxNewlines: 200n,
        temperature,
        firstTemperature: temperature,
        topK: 50n,
        topP,
        stopPatterns,
        fimEotProbThreshold: 1,
      }),
      tools: wireTools,
    });
  }

  private async *_consumeStream(
    body: ReadableStream<Uint8Array>,
    state: DevinStreamedState,
    requestBytes: number,
  ): AsyncGenerator<StreamedMessagePart> {
    const reader = body.getReader();
    let pending = Buffer.alloc(0);
    let latestStopReason = StopReason.UNSPECIFIED;
    const openToolCalls = new Set<string>();
    const toolPartialJson = new Map<string, string>();
    let activeToolCallId: string | undefined;
    let firstTokenSeen = false;
    const markFirstToken = (): void => {
      firstTokenSeen = true;
    };

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (value !== undefined && value.length > 0) {
          // Steady state drains fully per chunk; view the fresh reader chunk
          // instead of copying it through Buffer.concat.
          pending =
            pending.length === 0
              ? Buffer.from(value.buffer as ArrayBuffer, value.byteOffset, value.byteLength)
              : Buffer.concat([pending, value]);
        }

        while (pending.length >= 5) {
          const flag = pending[0] ?? 0;
          const len = pending.readUInt32BE(1);
          if (len > MAX_CONNECT_FRAME_PAYLOAD) {
            throw new ChatProviderError(
              `Devin Connect frame length ${String(len)} exceeds ${String(MAX_CONNECT_FRAME_PAYLOAD)}-byte cap`,
            );
          }
          if (pending.length < 5 + len) break;
          const payload = pending.subarray(5, 5 + len);
          pending = pending.subarray(5 + len);

          if ((flag & CONNECT_END_STREAM_FLAG) !== 0) {
            const trailerBytes =
              (flag & CONNECT_COMPRESSED_FLAG) !== 0 ? gunzipSync(payload) : payload;
            const trailerError = readConnectTrailerError(trailerBytes.toString('utf8').trim());
            if (trailerError !== null) {
              // The trailer carries the only server-side evidence for these
              // rejections; a large history with `invalid_argument`/`internal
              // error` is treated as context overflow so callers can compact.
              if (
                !firstTokenSeen &&
                trailerError.code.toLowerCase() === 'invalid_argument' &&
                /\binternal error\b/i.test(trailerError.message) &&
                requestBytes >= 512 * 1024
              ) {
                throw new APIContextOverflowError(400, trailerError.formatted);
              }
              throw new ChatProviderError(trailerError.formatted);
            }
            continue;
          }

          const raw = (flag & CONNECT_COMPRESSED_FLAG) !== 0 ? gunzipSync(payload) : payload;
          const msg = fromBinary(GetChatMessageResponseSchema, raw);
          if (msg.messageId && !state.id) state.id = msg.messageId;

          if (msg.deltaThinking) {
            markFirstToken();
            yield { type: 'think', think: msg.deltaThinking };
          }
          if (msg.deltaSignature) {
            // Empty think merges into the pending ThinkPart and stamps
            // `encrypted` without splitting the block.
            yield { type: 'think', think: '', encrypted: msg.deltaSignature };
          }

          if (msg.deltaText) {
            markFirstToken();
            yield { type: 'text', text: msg.deltaText };
          }

          for (const tc of msg.deltaToolCalls) {
            const toolCallId = tc.id || activeToolCallId;
            if (!toolCallId) continue;
            markFirstToken();
            if (!openToolCalls.has(toolCallId)) {
              openToolCalls.add(toolCallId);
              toolPartialJson.set(toolCallId, '');
              yield {
                type: 'function',
                id: toolCallId,
                name: tc.name,
                arguments: null,
                _streamIndex: toolCallId,
              };
            }
            activeToolCallId = toolCallId;
            if (!tc.argumentsJson) continue;
            // `argumentsJson` may be a cumulative snapshot or an append chunk:
            // emit only the suffix beyond what was already yielded.
            const previousJson = toolPartialJson.get(toolCallId) ?? '';
            const accumulated = tc.argumentsJson.startsWith(previousJson)
              ? tc.argumentsJson
              : previousJson + tc.argumentsJson;
            const delta = accumulated.slice(previousJson.length);
            toolPartialJson.set(toolCallId, accumulated);
            if (delta.length > 0) {
              yield { type: 'tool_call_part', argumentsPart: delta, index: toolCallId };
            }
          }

          if (msg.stopReason !== StopReason.UNSPECIFIED) {
            latestStopReason = msg.stopReason;
          }

          if (msg.usage) {
            state.usage = {
              inputOther: Number(msg.usage.inputTokens),
              output: Number(msg.usage.outputTokens),
              inputCacheRead: Number(msg.usage.cacheReadTokens),
              inputCacheCreation: Number(msg.usage.cacheWriteTokens),
            };
          }
        }

        if (done) break;
      }
    } finally {
      reader.releaseLock();
    }

    if (openToolCalls.size > 0) {
      state.finishReason = 'tool_use';
    } else if (latestStopReason === StopReason.MAX_TOKENS) {
      state.finishReason = 'max_tokens';
    } else {
      state.finishReason = StopReason[latestStopReason]?.toLowerCase() ?? 'stop';
    }
  }
}
