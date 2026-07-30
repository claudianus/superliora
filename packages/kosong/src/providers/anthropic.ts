import { ChatProviderError } from '#/errors';
import type { Message } from '#/message';
import type {
  ChatProvider,
  GenerateOptions,
  ProviderRequestAuth,
  StreamedMessage,
  ThinkingEffort,
} from '#/provider';
import type { Tool } from '#/tool';
import Anthropic from '@anthropic-ai/sdk';
import type {
  ContentBlockParam,
  MessageCreateParams,
  MessageCreateParamsStreaming,
  TextBlockParam,
} from '@anthropic-ai/sdk/resources/messages/messages.js';

import {
  budgetTokensForEffort,
  clampEffort,
  isFableModel,
  resolveDefaultMaxTokens,
  supportsAdaptiveThinking,
  supportsEffortParam,
} from './anthropic-model';
import {
  CACHE_CONTROL,
  convertMessage,
  injectCacheControlOnLastBlock,
  injectCacheControlOnPenultimateBlock,
  isToolResultOnly,
} from './anthropic-messages';
import { AnthropicStreamedMessage, convertAnthropicError } from './anthropic-stream';
import { convertTool, type AnthropicToolParam } from './anthropic-tools';
import { mergeConsecutiveUserMessages } from './merge-user-messages';
import { mergeRequestHeaders, resolveAuthBackedClient } from './request-auth';
import { awaitWithResponseHeaders } from './response-headers';
import {
  normalizeToolCallIdsForProvider,
  sanitizeToolCallId,
  type ToolCallIdPolicy,
} from './tool-call-id';

export { resolveDefaultMaxTokens };
export { convertAnthropicError };

export interface AnthropicOptions {
  apiKey?: string | undefined;
  baseUrl?: string | undefined;
  model: string;
  defaultMaxTokens?: number | undefined;
  betaFeatures?: string[] | undefined;
  defaultHeaders?: Record<string, string>;
  metadata?: Record<string, string> | undefined;
  /** Use streaming API. Defaults to true. Set to false for non-streaming (test/fallback). */
  stream?: boolean | undefined;
  /**
   * Explicitly declare whether the model supports adaptive thinking
   * (`thinking: { type: 'adaptive' }`), overriding the model-name version
   * inference. Useful for custom-named endpoints whose model name does not
   * encode a parseable Claude version. Leave undefined to infer from the name.
   */
  adaptiveThinking?: boolean | undefined;
  /**
   * Use the Anthropic beta Messages API namespace. Beta features are sent via
   * the request `betas` field in this mode, not the `anthropic-beta` header.
   */
  betaApi?: boolean | undefined;
  clientFactory?: (auth: ProviderRequestAuth) => Anthropic;
}

interface AnthropicGenerationKwargs {
  max_tokens?: number | undefined;
  temperature?: number | undefined;
  top_k?: number | undefined;
  top_p?: number | undefined;
  thinking?: MessageCreateParams['thinking'] | undefined;
  output_config?: MessageCreateParams['output_config'] | undefined;
  betaFeatures?: string[] | undefined;
}

const INTERLEAVED_THINKING_BETA = 'interleaved-thinking-2025-05-14';
const ANTHROPIC_TOOL_CALL_ID_POLICY: ToolCallIdPolicy = {
  normalize: (id) => sanitizeToolCallId(id, 64),
  maxLength: 64,
};

export class AnthropicChatProvider implements ChatProvider {
  name: string;
  readonly contextManagementCapability = {
    toolResultClearing: true,
    thinkingBlockClearing: true,
  } as const;

  private _model: string;
  private _stream: boolean;
  private _client: Anthropic | undefined;
  private _generationKwargs: AnthropicGenerationKwargs;
  private _metadata: Record<string, string> | undefined;
  private _apiKey: string | undefined;
  private _baseUrl: string | undefined;
  private _defaultHeaders: Record<string, string | null> | undefined;
  private _clientFactory: ((auth: ProviderRequestAuth) => Anthropic) | undefined;
  private _adaptiveThinking: boolean | undefined;
  private _betaApi: boolean;
  private _explicitMaxTokens: boolean;

  constructor(options: AnthropicOptions) {
    this.name = 'anthropic';
    this._model = options.model;
    this._stream = options.stream ?? true;
    this._metadata = options.metadata;
    this._adaptiveThinking = options.adaptiveThinking;
    this._betaApi = options.betaApi ?? false;
    this._apiKey =
      options.apiKey === undefined || options.apiKey.length === 0 ? undefined : options.apiKey;
    this._baseUrl = options.baseUrl;
    this._defaultHeaders = options.defaultHeaders;
    this._clientFactory = options.clientFactory;
    this._client = this._apiKey === undefined ? undefined : this._buildClient(this._apiKey);
    this._explicitMaxTokens = options.defaultMaxTokens !== undefined;
    this._generationKwargs = {
      max_tokens: resolveDefaultMaxTokens(options.model, options.defaultMaxTokens),
      betaFeatures: options.betaFeatures ?? [INTERLEAVED_THINKING_BETA],
    };
  }

  get modelName(): string {
    return this._model;
  }

  get thinkingEffort(): ThinkingEffort | null {
    const thinkingConfig = this._generationKwargs.thinking;
    if (thinkingConfig === undefined || thinkingConfig === null) {
      return null;
    }
    if (thinkingConfig.type === 'disabled') {
      return 'off';
    }
    if (thinkingConfig.type === 'adaptive') {
      const effort = this._generationKwargs.output_config?.effort;
      if (effort === undefined || effort === null) {
        return 'high';
      }
      switch (effort) {
        case 'low':
        case 'medium':
        case 'high':
        case 'xhigh':
        case 'max':
          return effort;
      }
    }
    // budget-based
    const budget = (thinkingConfig as { budget_tokens?: number }).budget_tokens ?? 0;
    if (budget <= 1024) {
      return 'low';
    }
    if (budget <= 4096) {
      return 'medium';
    }
    return 'high';
  }

  get modelParameters(): Record<string, unknown> {
    return {
      model: this._model,
      ...this._generationKwargs,
    };
  }

  async generate(
    systemPrompt: string,
    tools: Tool[],
    history: Message[],
    options?: GenerateOptions,
  ): Promise<StreamedMessage> {
    // Build system param - use layered prompt if available for cache optimization
    const layered = options?.layeredSystemPrompt;
    let system: TextBlockParam[] | undefined;

    if (layered !== undefined) {
      // Multi-block system with cache_control on static layer
      system = [
        {
          type: 'text',
          text: layered.layer1Static,
          cache_control: CACHE_CONTROL,
        } as TextBlockParam,
        {
          type: 'text',
          text: layered.layer2Session,
        } as TextBlockParam,
        {
          type: 'text',
          text: layered.layer3Dynamic,
        } as TextBlockParam,
      ];
    } else if (systemPrompt) {
      // Fallback to single-block system
      system = [
        {
          type: 'text',
          text: systemPrompt,
          cache_control: CACHE_CONTROL,
        } as TextBlockParam,
      ];
    }

    // Convert messages, then merge consecutive user-role wire turns. Strict
    // Anthropic-compatible backends reject adjacent user messages, while native
    // Anthropic concatenates them anyway.
    const messages = mergeConsecutiveUserMessages(
      normalizeToolCallIdsForProvider(history, ANTHROPIC_TOOL_CALL_ID_POLICY).map((msg) =>
        convertMessage(msg, this._model),
      ),
      {
        isUser: (message) => message.role === 'user',
        isToolResultOnly,
        merge: (last, next) => ({
          ...last,
          content: [
            ...(last.content as ContentBlockParam[]),
            ...(next.content as ContentBlockParam[]),
          ],
        }),
      },
    );

    // Inject cache_control on the penultimate message (stable conversation
    // prefix) and the last message (current turn boundary). The penultimate
    // breakpoint keeps all prior turns cached; the last breakpoint caches the
    // full request up to the newest content for retry/follow-up hits.
    injectCacheControlOnPenultimateBlock(messages);
    injectCacheControlOnLastBlock(messages);

    // Build generation kwargs (excluding betaFeatures)
    const kwargs: Record<string, unknown> = {};
    if (this._generationKwargs.max_tokens !== undefined) {
      kwargs['max_tokens'] = this._generationKwargs.max_tokens;
    }
    if (this._generationKwargs.temperature !== undefined) {
      kwargs['temperature'] = this._generationKwargs.temperature;
    }
    if (this._generationKwargs.top_k !== undefined) {
      kwargs['top_k'] = this._generationKwargs.top_k;
    }
    if (this._generationKwargs.top_p !== undefined) {
      kwargs['top_p'] = this._generationKwargs.top_p;
    }
    // Fable rejects an explicit `disabled` thinking config (HTTP 400, unlike
    // Opus 4.7/4.8 which accept it), so omit the field instead. Note thinking
    // cannot actually be turned off on Fable: adaptive thinking is always on,
    // and an omitted `thinking` field still runs with it.
    const thinking = this._generationKwargs.thinking;
    if (thinking !== undefined && !(thinking.type === 'disabled' && isFableModel(this._model))) {
      kwargs['thinking'] = thinking;
    }
    if (this._generationKwargs.output_config !== undefined) {
      kwargs['output_config'] = this._generationKwargs.output_config;
    }

    // Build beta headers
    const betas = this._generationKwargs.betaFeatures ?? [];
    const extraHeaders: Record<string, string> = {};
    if (!this._betaApi && betas.length > 0) {
      extraHeaders['anthropic-beta'] = betas.join(',');
    }

    // Convert tools
    const anthropicTools: AnthropicToolParam[] = tools.map((t) => convertTool(t));
    if (anthropicTools.length > 0) {
      const lastTool = anthropicTools.at(-1);
      if (lastTool !== undefined) {
        lastTool.cache_control = CACHE_CONTROL;
      }
    }

    // Build the create params
    const createParams: Record<string, unknown> = {
      model: this._model,
      messages,
      ...kwargs,
    };

    if (system !== undefined) {
      createParams['system'] = system;
    }

    if (anthropicTools.length > 0) {
      createParams['tools'] = anthropicTools;
    }

    if (this._metadata !== undefined) {
      createParams['metadata'] = this._metadata;
    }

    if (this._betaApi && betas.length > 0) {
      createParams['betas'] = betas;
    }

    const requestOptions: Record<string, unknown> = {};
    const headers = mergeRequestHeaders(extraHeaders, options?.auth?.headers);
    if (headers !== undefined) {
      requestOptions['headers'] = headers;
    }
    if (options?.signal) {
      requestOptions['signal'] = options.signal;
    }
    const finalRequestOptions = Object.keys(requestOptions).length > 0 ? requestOptions : undefined;
    const client = this._createClient(options?.auth);
    options?.onRequestSent?.();

    if (this._stream) {
      // Use the raw Messages stream instead of the SDK MessageStream helper.
      // The helper reparses accumulated input_json_delta buffers on every chunk,
      // which becomes synchronous O(n^2) work for large streamed tool arguments.
      try {
        const { data: stream, responseHeaders } = await awaitWithResponseHeaders(
          this._betaApi
            ? client.beta.messages.create(
                { ...createParams, stream: true } as unknown as MessageCreateParamsStreaming,
                finalRequestOptions,
              )
            : client.messages.create(
                { ...createParams, stream: true } as unknown as MessageCreateParamsStreaming,
                finalRequestOptions,
              ),
        );
        return new AnthropicStreamedMessage(stream, true, responseHeaders);
      } catch (error: unknown) {
        throw convertAnthropicError(error);
      }
    }

    // Non-streaming fallback
    try {
      const { data: response, responseHeaders } = await awaitWithResponseHeaders(
        this._betaApi
          ? client.beta.messages.create(
              { ...createParams, stream: false } as unknown as MessageCreateParams,
              finalRequestOptions,
            )
          : client.messages.create(
              { ...createParams, stream: false } as unknown as MessageCreateParams,
              finalRequestOptions,
            ),
      );
      return new AnthropicStreamedMessage(response, false, responseHeaders);
    } catch (error: unknown) {
      throw convertAnthropicError(error);
    }
  }

  private _createClient(auth: ProviderRequestAuth | undefined): Anthropic {
    return resolveAuthBackedClient(
      { cachedClient: this._client, clientFactory: this._clientFactory },
      auth,
      (a) => this._buildClient(this._requireApiKey(a)),
    );
  }

  private _requireApiKey(auth: ProviderRequestAuth | undefined): string {
    const apiKey = auth?.apiKey ?? this._apiKey;
    if (apiKey === undefined || apiKey.length === 0) {
      throw new ChatProviderError(
        'AnthropicChatProvider: apiKey is required. Provide it via constructor options, options.auth.apiKey on each request, or an OAuth login. The Anthropic adapter does not read shell API-key environment variables.',
      );
    }
    return apiKey;
  }

  private _anthropicCustomHeaderEnvNames(): string[] {
    const customHeaders = process.env['ANTHROPIC_CUSTOM_HEADERS'];
    if (customHeaders === undefined || customHeaders.length === 0) return [];

    const names: string[] = [];
    for (const line of customHeaders.split('\n')) {
      const colonIndex = line.indexOf(':');
      if (colonIndex < 0) continue;

      const name = line.slice(0, colonIndex).trim().toLowerCase();
      if (name.length > 0) names.push(name);
    }
    return names;
  }

  private _buildDefaultHeaders(apiKey: string): Record<string, string | null> {
    const defaultHeaders: Record<string, string | null> = { authorization: null };
    for (const name of this._anthropicCustomHeaderEnvNames()) {
      defaultHeaders[name] = null;
    }
    for (const [name, value] of Object.entries(this._defaultHeaders ?? {})) {
      defaultHeaders[name.toLowerCase()] = value;
    }
    defaultHeaders['x-api-key'] = apiKey;
    return defaultHeaders;
  }

  // We use the Anthropic SDK purely as a transport to arbitrary
  // anthropic-compatible endpoints (`baseUrl` may point anywhere). Left to its
  // defaults the SDK auto-discovers credentials from the shell environment
  // (ANTHROPIC_AUTH_TOKEN, ANTHROPIC_BASE_URL, ANTHROPIC_CUSTOM_HEADERS), which
  // would leak an out-of-band bearer/headers to a third-party endpoint even when
  // an explicit apiKey is set. So we hard-disable every auto-discovery channel.
  // These `null`s — and the nulled headers in _buildDefaultHeaders — are NOT
  // redundant: removing them reintroduces credential leakage. Regression cover:
  // test/e2e/anthropic-adapter.test.ts.
  private _buildClient(apiKey: string): Anthropic {
    return new Anthropic({
      apiKey,
      authToken: null,
      baseURL: this._baseUrl ?? null,
      defaultHeaders: this._buildDefaultHeaders(apiKey),
    });
  }

  withThinking(effort: ThinkingEffort): AnthropicChatProvider {
    // Resolve once: an explicit `adaptiveThinking` option overrides the
    // model-name version inference, so custom-named endpoints can opt in/out.
    const adaptive = this._adaptiveThinking ?? supportsAdaptiveThinking(this._model);

    if (effort === 'off') {
      let newBetas = [...(this._generationKwargs.betaFeatures ?? [])];
      if (adaptive) {
        newBetas = newBetas.filter((b) => b !== INTERLEAVED_THINKING_BETA);
      }
      const clone = this._withGenerationKwargs({
        thinking: { type: 'disabled' },
        betaFeatures: newBetas,
      });
      delete clone._generationKwargs.output_config;
      return clone;
    }

    const effectiveEffort = clampEffort(effort, this._model, adaptive);
    if (effectiveEffort === 'off') {
      throw new Error('Non-off thinking effort unexpectedly clamped to off.');
    }

    let newBetas = [...(this._generationKwargs.betaFeatures ?? [])];

    if (adaptive) {
      newBetas = newBetas.filter((b) => b !== INTERLEAVED_THINKING_BETA);
      return this._withGenerationKwargs({
        thinking: { type: 'adaptive', display: 'summarized' },
        output_config: { effort: effectiveEffort },
        betaFeatures: newBetas,
      });
    }

    const kwargs: Partial<AnthropicGenerationKwargs> = {
      thinking: { type: 'enabled', budget_tokens: budgetTokensForEffort(effectiveEffort) },
      betaFeatures: newBetas,
    };
    if (supportsEffortParam(this._model, adaptive)) {
      kwargs.output_config = { effort: effectiveEffort };
    } else {
      kwargs.output_config = undefined;
    }
    const clone = this._withGenerationKwargs(kwargs);
    if (!supportsEffortParam(this._model, adaptive)) {
      delete clone._generationKwargs.output_config;
    }
    return clone;
  }

  withGenerationKwargs(kwargs: Partial<AnthropicGenerationKwargs>): AnthropicChatProvider {
    return this._withGenerationKwargs(kwargs);
  }

  withMaxCompletionTokens(maxCompletionTokens: number): AnthropicChatProvider {
    const requestedCap = resolveDefaultMaxTokens(this._model, maxCompletionTokens);
    const existingCap = this._generationKwargs.max_tokens;
    const clone = this._withGenerationKwargs({
      max_tokens:
        existingCap === undefined || this._explicitMaxTokens
          ? existingCap ?? requestedCap
          : Math.min(existingCap, requestedCap),
    });
    clone._explicitMaxTokens = this._explicitMaxTokens;
    return clone;
  }

  private _withGenerationKwargs(kwargs: Partial<AnthropicGenerationKwargs>): AnthropicChatProvider {
    const clone = this._clone();
    clone._generationKwargs = { ...clone._generationKwargs, ...kwargs };
    if ('max_tokens' in kwargs) {
      clone._explicitMaxTokens = kwargs.max_tokens !== undefined;
    }
    return clone;
  }

  private _clone(): AnthropicChatProvider {
    const clone = Object.assign(
      Object.create(Object.getPrototypeOf(this) as object) as AnthropicChatProvider,
      this,
    );
    clone._generationKwargs = { ...this._generationKwargs };
    return clone;
  }
}
