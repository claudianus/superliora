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

/**
 * GPT-5.6 family supports `reasoning.context = all_turns` (and defaults to it).
 * Earlier models only accept current_turn / omit the field.
 */
export function supportsReasoningAllTurnsContext(model: string): boolean {
  const id = model.trim().toLowerCase();
  return id.includes('gpt-5.6') || id.startsWith('gpt-5.6');
}

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
   * Server-side conversation chaining state (shared with clones): when store
   * is enabled, the previous response ID is forwarded together with ONLY the
   * appended history delta so the API can reuse its stored conversation
   * instead of re-processing the full input array. Clones created by
   * `withGenerationKwargs`/`withMaxCompletionTokens` must share this holder,
   * otherwise per-step clones drop the chain after every request.
   * Controlled by SUPERLIORA_OPENAI_STORE.
   */
  private readonly _chainState: {
    previousResponseId: string | null;
    lastHistory: readonly Message[] | null;
  };
  private readonly _storeEnabled: boolean;

  constructor(options: OpenAIResponsesOptions) {
    const apiKey = options.apiKey ?? process.env['OPENAI_API_KEY'];
    this._apiKey = apiKey === undefined || apiKey.length === 0 ? undefined : apiKey;
    this._baseUrl = options.baseUrl ?? 'https://api.openai.com/v1';
    this._defaultHeaders = options.defaultHeaders;
    this._model = options.model;
    this._stream = true; // Responses API always supports streaming
    this._generationKwargs = { ...options.generationKwargs };
    this._toolMessageConversion = options.toolMessageConversion ?? null;
    this._httpClient = options.httpClient;
    this._clientFactory = options.clientFactory;

    if (options.maxOutputTokens !== undefined) {
      this._generationKwargs.max_output_tokens = options.maxOutputTokens;
    }

    this._client = this._apiKey === undefined ? undefined : this._buildClient(this._apiKey);
    this._chainState = { previousResponseId: null, lastHistory: null };
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

    // Chaining sends only the appended delta on top of the stored previous
    // response. It is only valid when the new history is a strict extension
    // of the previously sent one (same message objects); any rewrite
    // (compaction/undo) falls back to the full input and resets the chain.
    let chainableDelta: unknown[] | undefined;
    if (this._storeEnabled && this._chainState.previousResponseId !== null) {
      const last = this._chainState.lastHistory;
      if (last !== null && history.length > last.length) {
        let prefixUnchanged = true;
        for (let i = 0; i < last.length; i++) {
          if (history[i] !== last[i]) {
            prefixUnchanged = false;
            break;
          }
        }
        if (prefixUnchanged) {
          const deltaItems = convertHistoryMessages(
            normalizedHistory.slice(last.length),
            this._model,
            this._toolMessageConversion,
          );
          if (deltaItems.length > 0) {
            chainableDelta = deltaItems;
          }
        }
      }
    }

    const kwargs: Record<string, unknown> = { ...this._generationKwargs };
    const reasoningEffort = kwargs['reasoning_effort'] as string | undefined;
    delete kwargs['reasoning_effort'];

    if (reasoningEffort !== undefined) {
      // GPT-5.6 defaults to all_turns (render prior reasoning into the next
      // sample). Set it explicitly so multi-step tool loops keep continuity and
      // avoid re-deriving the same chain. Older models reject unknown values.
      const reasoning: Record<string, unknown> = {
        effort: reasoningEffort,
        summary: 'auto',
      };
      if (supportsReasoningAllTurnsContext(this._model)) {
        reasoning['context'] = 'all_turns';
      }
      kwargs['reasoning'] = reasoning;
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
        input: chainableDelta ?? input,
        tools: tools.map((t) => convertTool(t)),
        store: this._storeEnabled,
        stream: this._stream,
        ...kwargs,
      };
      if (systemPrompt) {
        createParams['instructions'] = systemPrompt;
      }
      // Server-side prefix caching: chain to the previous response so the API
      // reuses its stored conversation. Only sent with a delta input —
      // pairing it with the full history would duplicate the conversation.
      if (chainableDelta !== undefined && this._chainState.previousResponseId !== null) {
        createParams['previous_response_id'] = this._chainState.previousResponseId;
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
          this._chainState.previousResponseId = responseId;
          this._chainState.lastHistory = history;
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
