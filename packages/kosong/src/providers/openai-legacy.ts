import type { Message } from '#/message';
import type {
  ChatProvider,
  GenerateOptions,
  MaxCompletionTokensOptions,
  ProviderRequestAuth,
  StreamedMessage,
  ThinkingEffort,
} from '#/provider';
import type { Tool } from '#/tool';
import OpenAI from 'openai';

import {
  convertOpenAIError,
  reasoningEffortToThinkingEffort,
  thinkingEffortToReasoningEffort,
  toolToOpenAI,
  type ToolMessageConversion,
} from './openai-common';
import {
  mergeRequestHeaders,
  requireProviderApiKey,
  resolveAuthBackedClient,
} from './request-auth';
import { awaitWithResponseHeaders } from './response-headers';
import { supportsCacheBoundaries, markQwenCacheBoundaries } from './qwen-cache';
import { normalizeToolCallIdsForProvider } from './tool-call-id';
import {
  CHAT_COMPLETIONS_MAX_OUTPUT_TOKENS_CEILING,
  OPENAI_CHAT_TOOL_CALL_ID_POLICY,
  type OpenAILegacyGenerationKwargs,
  type OpenAILegacyOptions,
  type OpenAIMessage,
} from './openai-legacy-types';
import { completionTokenKwargs, normalizeGenerationKwargs } from './openai-legacy-kwargs';
import { convertHistoryMessages } from './openai-legacy-messages';
import { isQwenTokenPlanEndpoint, qwenHarnessToolsForModel } from './openai-legacy-qwen';
import { modelRejectsReasoningEffortParam } from './openai-legacy-reasoning';
import { OpenAILegacyStreamedMessage } from './openai-legacy-stream';

export type { OpenAILegacyGenerationKwargs, OpenAILegacyOptions } from './openai-legacy-types';
export { modelRejectsReasoningEffortParam } from './openai-legacy-reasoning';
export { OpenAILegacyStreamedMessage } from './openai-legacy-stream';

export class OpenAILegacyChatProvider implements ChatProvider {
  readonly name: string = 'openai';

  private _model: string;
  private _stream: boolean;
  private _apiKey: string | undefined;
  private _baseUrl: string | undefined;
  private _defaultHeaders: Record<string, string> | undefined;
  private _reasoningKey: string | undefined;
  private _reasoningEffort: string | undefined;
  private _generationKwargs: OpenAILegacyGenerationKwargs;
  private _toolMessageConversion: ToolMessageConversion;
  private _client: OpenAI | undefined;
  private _httpClient: unknown;
  private _clientFactory: ((auth: ProviderRequestAuth) => OpenAI) | undefined;

  constructor(options: OpenAILegacyOptions) {
    const apiKey = options.apiKey ?? process.env['OPENAI_API_KEY'];
    this._apiKey = apiKey === undefined || apiKey.length === 0 ? undefined : apiKey;
    this._baseUrl = options.baseUrl ?? 'https://api.openai.com/v1';
    this._defaultHeaders = options.defaultHeaders;
    this._model = options.model;
    this._stream = options.stream ?? true;
    // Normalize blank/whitespace reasoningKey to unset. ModelAliasSchema
    // accepts `z.string().optional()`, so `reasoning_key = ""` in config.toml
    // would otherwise disable the default field scan and route reads/writes
    // through an empty property name.
    const normalizedReasoningKey = options.reasoningKey?.trim();
    this._reasoningKey =
      normalizedReasoningKey !== undefined && normalizedReasoningKey.length > 0
        ? normalizedReasoningKey
        : undefined;
    this._reasoningEffort = undefined;
    this._generationKwargs =
      options.maxTokens !== undefined ? completionTokenKwargs(this._model, options.maxTokens) : {};
    this._toolMessageConversion = options.toolMessageConversion ?? null;
    this._httpClient = options.httpClient;
    this._clientFactory = options.clientFactory;

    this._client = this._apiKey === undefined ? undefined : this._buildClient(this._apiKey);
  }

  get modelName(): string {
    return this._model;
  }

  get thinkingEffort(): ThinkingEffort | null {
    return reasoningEffortToThinkingEffort(this._reasoningEffort);
  }

  get modelParameters(): Record<string, unknown> {
    return {
      model: this._model,
      baseUrl: this._baseUrl,
      ...normalizeGenerationKwargs(this._model, this._generationKwargs),
    };
  }

  async generate(
    systemPrompt: string,
    tools: Tool[],
    history: Message[],
    options?: GenerateOptions,
  ): Promise<StreamedMessage> {
    const messages: OpenAIMessage[] = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    const normalizedHistory = normalizeToolCallIdsForProvider(
      history,
      OPENAI_CHAT_TOOL_CALL_ID_POLICY,
    );
    messages.push(
      ...convertHistoryMessages(normalizedHistory, this._reasoningKey, this._toolMessageConversion),
    );

    const kwargs: Record<string, unknown> = normalizeGenerationKwargs(
      this._model,
      this._generationKwargs,
    );

    // Determine reasoning_effort
    let reasoningEffort: string | undefined = this._reasoningEffort;
    const rejectsReasoningEffort = modelRejectsReasoningEffortParam(this._model);

    // Auto-enable reasoning_effort when the history contains ThinkPart but reasoning
    // was not explicitly configured. This prevents server validation errors from APIs
    // (e.g. One API) that require reasoning_effort when messages contain reasoning_content.
    // Skip when the caller already pinned reasoning_effort via withGenerationKwargs —
    // their value would otherwise be silently overwritten below.
    // Skip entirely for models/gateways that 400 on the parameter (e.g. grok-build).
    // See: https://github.com/MoonshotAI/kimi-code/issues/1616
    if (
      !rejectsReasoningEffort &&
      reasoningEffort === undefined &&
      kwargs['reasoning_effort'] === undefined &&
      kwargs['reasoningEffort'] === undefined
    ) {
      const hasThinkPart = history.some((message) =>
        message.content.some((part) => part.type === 'think'),
      );
      if (hasThinkPart) {
        reasoningEffort = 'medium';
      }
    }

    // Remove undefined values from kwargs
    for (const key of Object.keys(kwargs)) {
      if (kwargs[key] === undefined) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete kwargs[key];
      }
    }

    // Strip unsupported reasoning params before they hit the wire (kwargs may
    // carry camelCase reasoningEffort from some callers).
    if (rejectsReasoningEffort) {
      reasoningEffort = undefined;
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete kwargs['reasoning_effort'];
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete kwargs['reasoningEffort'];
    }

    // Qwen/DashScope: mark explicit context-cache boundaries (the static
    // system prompt plus a sliding marker before the last message) so the
    // growing conversation prefix bills at the explicit-cache rate.
    if (supportsCacheBoundaries(this._baseUrl, this._model)) {
      markQwenCacheBoundaries(messages);
    }

    // Build the create params
    const createParams: Record<string, unknown> = {
      model: this._model,
      messages,
      stream: this._stream,
      ...kwargs,
    };

    if (tools.length > 0) {
      createParams['tools'] = tools.map((t) => toolToOpenAI(t));
    }

    // Qwen Token Plan: harness tools (web_search, code_interpreter, …) run
    // server-side and are invoked automatically by qwen3.7/3.8 models — the
    // Chat Completions API does NOT accept harness tool entries in the tools
    // array (that format is Responses API only; injecting it yields a 400
    // "'function' is a required property"). Web search is enabled here via
    // `enable_search`; the harness tool list only gates capability.
    if (isQwenTokenPlanEndpoint(this._baseUrl)) {
      const harnessTools = qwenHarnessToolsForModel(this._model);
      if (harnessTools.length > 0) {
        createParams['enable_search'] = true;
      }
    }

    if (this._stream) {
      createParams['stream_options'] = { include_usage: true };
    }

    if (reasoningEffort !== undefined && !rejectsReasoningEffort) {
      createParams['reasoning_effort'] = reasoningEffort;
    }
    // Final guard: never send reasoningEffort/reasoning_effort to rejecting models
    if (rejectsReasoningEffort) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete createParams['reasoning_effort'];
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete createParams['reasoningEffort'];
    }

    try {
      const client = this._createClient(options?.auth);
      options?.onRequestSent?.();
      const { data, responseHeaders } = await awaitWithResponseHeaders(
        client.chat.completions.create(
          createParams as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
          options?.signal ? { signal: options.signal } : undefined,
        ),
      );
      const response = data as unknown as
        | OpenAI.Chat.ChatCompletion
        | AsyncIterable<OpenAI.Chat.ChatCompletionChunk>;
      return new OpenAILegacyStreamedMessage(
        response,
        this._stream,
        this._reasoningKey,
        responseHeaders,
      );
    } catch (error: unknown) {
      throw convertOpenAIError(error);
    }
  }

  withThinking(effort: ThinkingEffort): OpenAILegacyChatProvider {
    const reasoningEffort = thinkingEffortToReasoningEffort(effort);
    const clone = this._clone();
    clone._reasoningEffort = reasoningEffort;
    return clone;
  }

  withGenerationKwargs(kwargs: OpenAILegacyGenerationKwargs): OpenAILegacyChatProvider {
    const clone = this._clone();
    clone._generationKwargs = { ...clone._generationKwargs, ...kwargs };
    return clone;
  }

  withMaxCompletionTokens(
    maxCompletionTokens: number,
    options?: MaxCompletionTokensOptions,
  ): OpenAILegacyChatProvider {
    let cap = maxCompletionTokens;
    if (
      options?.usedContextTokens !== undefined &&
      options?.maxContextTokens !== undefined &&
      options.maxContextTokens > 0
    ) {
      cap = Math.min(cap, options.maxContextTokens - options.usedContextTokens);
    }
    cap = Math.min(cap, CHAT_COMPLETIONS_MAX_OUTPUT_TOKENS_CEILING);
    return this.withGenerationKwargs(completionTokenKwargs(this._model, Math.max(1, cap)));
  }

  private _clone(): OpenAILegacyChatProvider {
    const clone = Object.assign(
      Object.create(Object.getPrototypeOf(this) as object) as OpenAILegacyChatProvider,
      this,
    );
    clone._generationKwargs = { ...this._generationKwargs };
    return clone;
  }

  private _createClient(auth: ProviderRequestAuth | undefined): OpenAI {
    return resolveAuthBackedClient(
      { cachedClient: this._client, clientFactory: this._clientFactory },
      auth,
      (a) =>
        this._buildClient(requireProviderApiKey('OpenAILegacyChatProvider', a, this._apiKey), a),
    );
  }

  private _buildClient(apiKey: string, auth?: ProviderRequestAuth): OpenAI {
    const clientOpts: Record<string, unknown> = {
      apiKey,
      baseURL: this._baseUrl,
    };
    const defaultHeaders = mergeRequestHeaders(this._defaultHeaders, auth?.headers);
    if (defaultHeaders !== undefined) {
      clientOpts['defaultHeaders'] = defaultHeaders;
    }
    if (this._httpClient !== undefined) {
      clientOpts['httpClient'] = this._httpClient;
    }
    return new OpenAI(clientOpts as ConstructorParameters<typeof OpenAI>[0]);
  }
}
