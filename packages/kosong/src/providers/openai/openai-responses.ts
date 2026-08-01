import type { Message } from '#/message';
import type {
  ChatProvider,
  GenerateOptions,
  ProviderRequestAuth,
  StreamedMessage,
  ThinkingEffort,
} from '#/provider';
import type { Tool } from '#/tool';
import OpenAI from 'openai';

import { convertHistoryMessages } from '#/providers/openai/openai-responses-messages';
import { OpenAIResponsesStreamedMessage } from '#/providers/openai/openai-responses-stream';
import { convertTool } from '#/providers/openai/openai-responses-tools';
import {
  convertOpenAIError,
  type ToolMessageConversion,
  reasoningEffortToThinkingEffort,
  thinkingEffortToReasoningEffort,
} from '#/providers/openai/openai-common';
import {
  mergeRequestHeaders,
  requireProviderApiKey,
  resolveAuthBackedClient,
} from '../request-auth';
import { awaitWithResponseHeaders } from '../response-headers';
import {
  normalizeToolCallIdsForProvider,
  sanitizeOpenAIResponsesCallId,
  type ToolCallIdPolicy,
} from '../tool-call-id';

export { OpenAIResponsesStreamedMessage };

const OPENAI_RESPONSES_TOOL_CALL_ID_POLICY: ToolCallIdPolicy = {
  normalize: (id) => sanitizeOpenAIResponsesCallId(id, 64),
  maxLength: 64,
};

export interface OpenAIResponsesOptions {
  apiKey?: string | undefined;
  baseUrl?: string | undefined;
  model: string;
  maxOutputTokens?: number | undefined;
  httpClient?: unknown;
  defaultHeaders?: Record<string, string>;
  toolMessageConversion?: ToolMessageConversion | undefined;
  clientFactory?: (auth: ProviderRequestAuth) => OpenAI;
  generationKwargs?: OpenAIResponsesGenerationKwargs | undefined;
}

export interface OpenAIResponsesGenerationKwargs {
  max_output_tokens?: number | undefined;
  temperature?: number | undefined;
  top_p?: number | undefined;
  reasoning_effort?: string | undefined;
  [key: string]: unknown;
}

export class OpenAIResponsesChatProvider implements ChatProvider {
  readonly name: string = 'openai-responses';
  readonly contextManagementCapability = {
    serverSideCompaction: true,
  } as const;

  private _model: string;
  private _stream: boolean;
  private _apiKey: string | undefined;
  private _baseUrl: string | undefined;
  private _defaultHeaders: Record<string, string> | undefined;
  private _generationKwargs: OpenAIResponsesGenerationKwargs;
  private _toolMessageConversion: ToolMessageConversion;
  private _client: OpenAI | undefined;
  private _httpClient: unknown;
  private _clientFactory: ((auth: ProviderRequestAuth) => OpenAI) | undefined;
  /**
   * Server-side conversation chaining: when store is enabled, the previous
   * response ID is forwarded so the API can reuse its cached prefix instead
   * of re-processing the full input array. Controlled by SUPERLIORA_OPENAI_STORE.
   */
  private _previousResponseId: string | null = null;
  private readonly _storeEnabled: boolean;

  constructor(options: OpenAIResponsesOptions) {
    const apiKey = options.apiKey ?? process.env['OPENAI_API_KEY'];
    this._apiKey = apiKey === undefined || apiKey.length === 0 ? undefined : apiKey;
    this._baseUrl = options.baseUrl ?? 'https://api.openai.com/v1';
    this._defaultHeaders = options.defaultHeaders;
    this._model = options.model;
    this._stream = true; // Responses API always supports streaming
    this._generationKwargs = { ...(options.generationKwargs ?? {}) };
    this._toolMessageConversion = options.toolMessageConversion ?? null;
    this._httpClient = options.httpClient;
    this._clientFactory = options.clientFactory;

    if (options.maxOutputTokens !== undefined) {
      this._generationKwargs.max_output_tokens = options.maxOutputTokens;
    }

    this._client = this._apiKey === undefined ? undefined : this._buildClient(this._apiKey);
    this._storeEnabled = process.env['SUPERLIORA_OPENAI_STORE'] === '1';
  }

  get modelName(): string {
    return this._model;
  }

  get thinkingEffort(): ThinkingEffort | null {
    return reasoningEffortToThinkingEffort(this._generationKwargs.reasoning_effort);
  }

  get modelParameters(): Record<string, unknown> {
    return {
      model: this._model,
      baseUrl: this._baseUrl,
      ...this._generationKwargs,
    };
  }

  async generate(
    systemPrompt: string,
    tools: Tool[],
    history: Message[],
    options?: GenerateOptions,
  ): Promise<StreamedMessage> {
    const input: unknown[] = [];

    const normalizedHistory = normalizeToolCallIdsForProvider(
      history,
      OPENAI_RESPONSES_TOOL_CALL_ID_POLICY,
    );
    input.push(
      ...convertHistoryMessages(normalizedHistory, this._model, this._toolMessageConversion),
    );

    const kwargs: Record<string, unknown> = { ...this._generationKwargs };
    const reasoningEffort = kwargs['reasoning_effort'] as string | undefined;
    delete kwargs['reasoning_effort'];

    if (reasoningEffort !== undefined) {
      kwargs['reasoning'] = {
        effort: reasoningEffort,
        summary: 'auto',
      };
      kwargs['include'] = ['reasoning.encrypted_content'];
    }

    // Remove undefined values
    for (const key of Object.keys(kwargs)) {
      if (kwargs[key] === undefined) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete kwargs[key];
      }
    }

    try {
      const client = this._createClient(options?.auth);
      const createParams: Record<string, unknown> = {
        model: this._model,
        input,
        tools: tools.map((t) => convertTool(t)),
        store: this._storeEnabled,
        stream: this._stream,
        ...kwargs,
      };
      if (systemPrompt) {
        createParams['instructions'] = systemPrompt;
      }
      // Server-side prefix caching: chain to the previous response so the API
      // reuses its cached context instead of re-processing the full input.
      if (this._storeEnabled && this._previousResponseId !== null) {
        createParams['previous_response_id'] = this._previousResponseId;
      }

      if (
        !('responses' in client) ||
        typeof (client as { responses?: { create?: unknown } }).responses?.create !== 'function'
      ) {
        throw new Error(
          'OpenAI SDK version does not support Responses API. Upgrade to >=4.x with responses support.',
        );
      }

      options?.onRequestSent?.();
      const create = (
        client.responses as {
          create(params: unknown, opts?: unknown): unknown;
        }
      ).create.bind(client.responses);
      const { data, responseHeaders } = await awaitWithResponseHeaders(
        create(createParams, options?.signal ? { signal: options.signal } : undefined),
      );
      const streamed = new OpenAIResponsesStreamedMessage(data, this._stream, responseHeaders);
      // Capture the response ID for next-request chaining (store mode).
      if (this._storeEnabled) {
        const responseId = streamed.id;
        if (responseId !== null) {
          this._previousResponseId = responseId;
        }
      }
      return streamed;
    } catch (error: unknown) {
      throw convertOpenAIError(error);
    }
  }

  withThinking(effort: ThinkingEffort): OpenAIResponsesChatProvider {
    const reasoningEffort = thinkingEffortToReasoningEffort(effort);
    const clone = this._clone();
    clone._generationKwargs = {
      ...clone._generationKwargs,
      reasoning_effort: reasoningEffort,
    };
    return clone;
  }

  withGenerationKwargs(kwargs: OpenAIResponsesGenerationKwargs): OpenAIResponsesChatProvider {
    const clone = this._clone();
    clone._generationKwargs = { ...clone._generationKwargs, ...kwargs };
    return clone;
  }

  withMaxCompletionTokens(maxCompletionTokens: number): OpenAIResponsesChatProvider {
    return this.withGenerationKwargs({ max_output_tokens: maxCompletionTokens });
  }

  private _clone(): OpenAIResponsesChatProvider {
    const clone = Object.assign(
      Object.create(Object.getPrototypeOf(this) as object) as OpenAIResponsesChatProvider,
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
        this._buildClient(requireProviderApiKey('OpenAIResponsesChatProvider', a, this._apiKey), a),
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
