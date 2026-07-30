import type { Message } from '#/message';
import type {
  ChatProvider,
  GenerateOptions,
  ProviderRequestAuth,
  StreamedMessage,
  ThinkingEffort,
} from '#/provider';
import type { Tool } from '#/tool';
import { GoogleGenAI as GenAIClient } from '@google/genai';

import { abortPromise, createAbortError } from '#/providers/google/google-genai-abort';
import { convertGoogleGenAIError } from '#/providers/google/google-genai-error';
import { messagesToGoogleGenAIContents } from '#/providers/google/google-genai-messages';
import { GoogleGenAIStreamedMessage } from '#/providers/google/google-genai-stream';
import {
  type GoogleGenAIGenerationKwargs,
  type GoogleGenAIOptions,
  type ThinkingConfig,
  toolToGoogleGenAI,
} from '#/providers/google/google-genai-types';
import { requireProviderApiKey, resolveAuthBackedClient } from '../request-auth';

export { convertGoogleGenAIError };
export { messagesToGoogleGenAIContents };
export { GoogleGenAIStreamedMessage };
export type { GoogleGenAIGenerationKwargs, GoogleGenAIOptions };

export class GoogleGenAIChatProvider implements ChatProvider {
  readonly name: string = 'google_genai';

  private _model: string;
  private _client: GenAIClient | undefined;
  private _generationKwargs: GoogleGenAIGenerationKwargs;
  private _vertexai: boolean;
  private _stream: boolean;
  private _apiKey: string | undefined;
  private _project: string | undefined;
  private _location: string | undefined;
  private _clientFactory: ((auth: ProviderRequestAuth) => GenAIClient) | undefined;

  constructor(options: GoogleGenAIOptions) {
    this._model = options.model;
    this._vertexai = options.vertexai ?? false;
    this._stream = options.stream ?? true;
    this._generationKwargs = {};

    const apiKey = options.apiKey ?? process.env['GOOGLE_API_KEY'];
    this._apiKey = apiKey === undefined || apiKey.length === 0 ? undefined : apiKey;
    this._project = options.project;
    this._location = options.location;
    this._clientFactory = options.clientFactory;
    this._client =
      this._vertexai || this._apiKey !== undefined ? this._buildClient(this._apiKey) : undefined;
  }

  private _buildClient(apiKey: string | undefined): GenAIClient {
    return new GenAIClient({
      apiKey,
      ...(this._vertexai
        ? {
            vertexai: true,
            project: this._project,
            location: this._location,
          }
        : {}),
    });
  }

  get modelName(): string {
    return this._model;
  }

  get thinkingEffort(): ThinkingEffort | null {
    const thinkingConfig = this._generationKwargs.thinkingConfig;
    if (thinkingConfig === undefined) return null;

    // For gemini-3 models that use thinkingLevel
    if (thinkingConfig.thinkingLevel !== undefined) {
      switch (thinkingConfig.thinkingLevel) {
        case 'MINIMAL':
          // MINIMAL + suppressed thoughts is how 'off' is encoded for Gemini 3,
          // which has no true "disabled" level.
          return thinkingConfig.includeThoughts === false ? 'off' : 'low';
        case 'LOW':
          return 'low';
        case 'MEDIUM':
          return 'medium';
        case 'HIGH':
          return 'high';
        default:
          return null;
      }
    }

    // For other models that use thinkingBudget
    if (thinkingConfig.thinkingBudget !== undefined) {
      if (thinkingConfig.thinkingBudget === 0) return 'off';
      if (thinkingConfig.thinkingBudget <= 1024) return 'low';
      if (thinkingConfig.thinkingBudget <= 4096) return 'medium';
      return 'high';
    }

    return null;
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
    // Short-circuit if the caller has already aborted — the Google GenAI
    // SDK will not honor the signal natively, so we must check manually.
    if (options?.signal?.aborted === true) {
      throw createAbortError();
    }

    const contents = messagesToGoogleGenAIContents(history);

    const config: Record<string, unknown> = {
      ...this._generationKwargs,
      systemInstruction: systemPrompt,
      ...(tools.length > 0 ? { tools: tools.map((t) => toolToGoogleGenAI(t)) } : {}),
    };

    try {
      const client = this._createClient(options?.auth);
      const models = client.models as unknown as {
        generateContent(params: Record<string, unknown>): Promise<unknown>;
        generateContentStream(params: Record<string, unknown>): Promise<AsyncGenerator>;
      };

      const params = { model: this._model, contents, config };

      // The Google GenAI SDK does not accept an AbortSignal, so we must race
      // the initial SDK request against the caller's abort signal ourselves.
      // Once we have a response/stream object, the wrapper below continues to
      // check the signal at each chunk boundary.
      options?.onRequestSent?.();
      if (this._stream) {
        const stream = await Promise.race([
          models.generateContentStream(params),
          abortPromise(options?.signal),
        ]);
        return new GoogleGenAIStreamedMessage(
          stream as AsyncIterable<Record<string, unknown>>,
          true,
          options?.signal,
        );
      }

      const response = await Promise.race([
        models.generateContent(params),
        abortPromise(options?.signal),
      ]);
      return new GoogleGenAIStreamedMessage(
        response as Record<string, unknown>,
        false,
        options?.signal,
      );
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error;
      }
      throw convertGoogleGenAIError(error);
    }
  }

  private _createClient(auth: ProviderRequestAuth | undefined): GenAIClient {
    return resolveAuthBackedClient(
      { cachedClient: this._client, clientFactory: this._clientFactory },
      auth,
      (a) => {
        // Vertex AI auth flows through google-auth-library service credentials,
        // not a request-scoped apiKey, and the @google/genai SDK has no
        // perRequest header channel — so neither `auth.apiKey` nor
        // `auth.headers` is propagated in vertexai mode. Callers that need
        // request-scoped credentials should instead point their service
        // account at the right principal.
        if (this._vertexai) return this._buildClient(this._apiKey);
        return this._buildClient(requireProviderApiKey('GoogleGenAIChatProvider', a, this._apiKey));
      },
    );
  }

  withThinking(effort: ThinkingEffort): GoogleGenAIChatProvider {
    const thinkingConfig: ThinkingConfig = { includeThoughts: true };

    if (this._model.includes('gemini-3')) {
      // Gemini 3 models use thinkingLevel (MINIMAL/LOW/MEDIUM/HIGH). The SDK
      // does not expose a "disabled" level, so 'off' maps to MINIMAL with
      // thought output suppressed — the lowest thinking intensity available.
      switch (effort) {
        case 'off':
          thinkingConfig.thinkingLevel = 'MINIMAL';
          thinkingConfig.includeThoughts = false;
          break;
        case 'low':
          thinkingConfig.thinkingLevel = 'LOW';
          break;
        case 'medium':
          thinkingConfig.thinkingLevel = 'MEDIUM';
          break;
        case 'high':
        case 'xhigh':
        case 'max':
          thinkingConfig.thinkingLevel = 'HIGH';
          break;
      }
    } else {
      switch (effort) {
        case 'off':
          thinkingConfig.thinkingBudget = 0;
          thinkingConfig.includeThoughts = false;
          break;
        case 'low':
          thinkingConfig.thinkingBudget = 1024;
          thinkingConfig.includeThoughts = true;
          break;
        case 'medium':
          thinkingConfig.thinkingBudget = 4096;
          thinkingConfig.includeThoughts = true;
          break;
        case 'high':
        case 'xhigh':
        case 'max':
          thinkingConfig.thinkingBudget = 32_000;
          thinkingConfig.includeThoughts = true;
          break;
      }
    }

    return this.withGenerationKwargs({ thinkingConfig });
  }

  withGenerationKwargs(kwargs: GoogleGenAIGenerationKwargs): GoogleGenAIChatProvider {
    const clone = this._clone();
    clone._generationKwargs = { ...clone._generationKwargs, ...kwargs };
    return clone;
  }

  withMaxCompletionTokens(maxCompletionTokens: number): GoogleGenAIChatProvider {
    return this.withGenerationKwargs({ maxOutputTokens: maxCompletionTokens });
  }

  private _clone(): GoogleGenAIChatProvider {
    const clone = Object.assign(
      Object.create(Object.getPrototypeOf(this) as object) as GoogleGenAIChatProvider,
      this,
    );
    clone._generationKwargs = { ...this._generationKwargs };
    return clone;
  }
}
