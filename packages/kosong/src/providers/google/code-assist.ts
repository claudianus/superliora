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

import { messagesToGoogleGenAIContents } from './google-genai-messages';
import {
  type GoogleGenAIGenerationKwargs,
  type ThinkingConfig,
  toolToGoogleGenAI,
} from './google-genai-types';
import { GoogleGenAIStreamedMessage } from './google-genai-stream';
import { mergeRequestHeaders } from '../request-auth';

export { convertGoogleGenAIError } from './google-genai-error';

export interface CodeAssistOptions {
  readonly model: string;
  /**
   * Static Bearer token fallback. Normal OAuth logins resolve a fresh access
   * token per request via `auth.apiKey`; a static key supports proxied setups
   * that hold their own long-lived credential.
   */
  readonly apiKey?: string;
  /** Code Assist endpoint root (no path), e.g. `https://cloudcode-pa.googleapis.com`. */
  readonly baseUrl?: string;
  /** Cloud Code Assist project id discovered during OAuth login. */
  readonly project?: string;
  readonly stream?: boolean;
  readonly defaultMaxTokens?: number;
  readonly defaultHeaders?: Record<string, string>;
  readonly clientFactory?: (auth: ProviderRequestAuth) => CodeAssistClient;
}

/** Minimal HTTP surface the provider needs; injectable for tests. */
export interface CodeAssistClient {
  readonly baseUrl: string;
  readonly project: string | undefined;
  fetch: typeof fetch;
}

const CODE_ASSIST_DEFAULT_BASE_URL = 'https://cloudcode-pa.googleapis.com';

/**
 * User-Agent the official Gemini CLI sends. The Code Assist endpoint meters
 * CLI traffic on this identity (same shape as the official CLI v0.35+).
 */
export function codeAssistUserAgent(modelId: string): string {
  const platform = process.platform === 'win32' ? 'win32' : process.platform;
  const arch = process.arch === 'x64' ? 'x64' : process.arch;
  return `GeminiCLI/0.58.0/${modelId} (${platform}; ${arch}; terminal)`;
}

/**
 * ChatProvider for the Cloud Code Assist API (`cloudcode-pa.googleapis.com`),
 * the endpoint behind the Gemini CLI OAuth login. Shares the Gemini wire's
 * content/tool shapes (the request carries them in a `{model, project,
 * request}` envelope) and reuses the google-genai converters and stream
 * decoder; transport is plain SSE via fetch because the @google/genai SDK
 * cannot hit the `v1internal` paths.
 */
export class CodeAssistChatProvider implements ChatProvider {
  readonly name: string = 'code_assist';

  private _model: string;
  private _apiKey: string | undefined;
  private _baseUrl: string;
  private _project: string | undefined;
  private _defaultMaxTokens: number;
  private _defaultHeaders: Record<string, string> | undefined;
  private _generationKwargs: GoogleGenAIGenerationKwargs;
  private _clientFactory: ((auth: ProviderRequestAuth) => CodeAssistClient) | undefined;

  constructor(options: CodeAssistOptions) {
    this._model = options.model;
    this._apiKey = options.apiKey;
    this._baseUrl = (options.baseUrl ?? CODE_ASSIST_DEFAULT_BASE_URL).replace(/\/+$/, '');
    this._project = options.project;
    this._defaultMaxTokens = options.defaultMaxTokens ?? 8192;
    this._defaultHeaders = options.defaultHeaders;
    this._generationKwargs = {};
    this._clientFactory = options.clientFactory;
  }

  get modelName(): string {
    return this._model;
  }

  get thinkingEffort(): ThinkingEffort | null {
    const thinkingConfig = this._generationKwargs.thinkingConfig;
    if (thinkingConfig === undefined) return null;
    if (thinkingConfig.thinkingLevel !== undefined) {
      switch (thinkingConfig.thinkingLevel) {
        case 'MINIMAL':
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
    const budget = thinkingConfig.thinkingBudget;
    if (budget === undefined) return null;
    if (budget === 0) return 'off';
    if (budget <= 1024) return 'low';
    if (budget <= 4096) return 'medium';
    return 'high';
  }

  get modelParameters(): Record<string, unknown> {
    return {
      model: this._model,
      ...(this._project === undefined ? {} : { project: this._project }),
      ...this._generationKwargs,
    };
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
        'CodeAssistChatProvider: a Google OAuth access token is required. Provide it via options.auth.apiKey on each request.',
      );
    }

    const request: Record<string, unknown> = {
      contents: messagesToGoogleGenAIContents(history),
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: {
        maxOutputTokens: this._defaultMaxTokens,
        ...this._generationKwargs,
      },
    };
    if (tools.length > 0) {
      request['tools'] = tools.map((tool) => toolToGoogleGenAI(tool));
    }

    const client = this._createClient(options?.auth);
    const body: Record<string, unknown> = {
      model: this._model,
      request,
      ...(client.project === undefined ? {} : { project: client.project }),
    };

    const url = `${client.baseUrl}/v1internal:streamGenerateContent?alt=sse`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'User-Agent': codeAssistUserAgent(this._model),
      'Client-Metadata': 'ideType=IDE_UNSPECIFIED,platform=PLATFORM_UNSPECIFIED,pluginType=GEMINI',
      ...mergeRequestHeaders(this._defaultHeaders, options?.auth?.headers),
    };

    options?.onRequestSent?.();
    let response: Response;
    try {
      response = await client.fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        ...(options?.signal !== undefined ? { signal: options.signal } : {}),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      throw error;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `Code Assist request failed (HTTP ${String(response.status)}): ${text.slice(0, 500)}`,
      );
    }
    const responseBody = response.body;
    if (responseBody === null) {
      throw new Error('Code Assist stream returned an empty body.');
    }

    return new GoogleGenAIStreamedMessage(readSseDataEvents(responseBody), true, options?.signal);
  }

  withThinking(effort: ThinkingEffort): CodeAssistChatProvider {
    const thinkingConfig: ThinkingConfig = { includeThoughts: true };
    if (this._model.includes('gemini-3')) {
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
          thinkingConfig.thinkingLevel = 'HIGH';
          break;
        case 'xhigh':
        case 'max':
          thinkingConfig.thinkingLevel = 'HIGH';
          break;
      }
    } else {
      const budgets: Record<ThinkingEffort, number> = {
        off: 0,
        low: 1024,
        medium: 4096,
        high: 8192,
        xhigh: 16384,
        max: 24576,
      };
      thinkingConfig.thinkingBudget = budgets[effort];
    }
    const clone = this._clone();
    clone._generationKwargs = { ...this._generationKwargs, thinkingConfig };
    return clone;
  }

  withMaxCompletionTokens(
    maxCompletionTokens: number,
    _options?: MaxCompletionTokensOptions,
  ): CodeAssistChatProvider {
    const clone = this._clone();
    clone._defaultMaxTokens = maxCompletionTokens;
    return clone;
  }

  private _clone(): CodeAssistChatProvider {
    const clone = new CodeAssistChatProvider({
      model: this._model,
      ...(this._apiKey === undefined ? {} : { apiKey: this._apiKey }),
      baseUrl: this._baseUrl,
      project: this._project,
      defaultMaxTokens: this._defaultMaxTokens,
      ...(this._defaultHeaders === undefined ? {} : { defaultHeaders: this._defaultHeaders }),
      ...(this._clientFactory === undefined ? {} : { clientFactory: this._clientFactory }),
    });
    clone._generationKwargs = this._generationKwargs;
    return clone;
  }

  private _createClient(auth: ProviderRequestAuth | undefined): CodeAssistClient {
    if (this._clientFactory !== undefined) return this._clientFactory(auth ?? {});
    return {
      baseUrl: auth?.baseUrl ?? this._baseUrl,
      project: this._project,
      fetch,
    };
  }
}

/** Reads `data:` payload lines from an SSE body as parsed JSON chunks. */
async function* readSseDataEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<Record<string, unknown>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let separatorIndex = buffer.indexOf('\n\n');
      while (separatorIndex >= 0) {
        const block = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
        const payload = extractDataLine(block);
        if (payload !== undefined) yield payload;
        separatorIndex = buffer.indexOf('\n\n');
      }
    }
    const tail = buffer.trim();
    if (tail.startsWith('data:')) {
      const payload = extractDataLine(tail);
      if (payload !== undefined) yield payload;
    }
  } finally {
    reader.releaseLock();
  }
}

function extractDataLine(block: string): Record<string, unknown> | undefined {
  const line = block
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith('data:'));
  if (line === undefined) return undefined;
  const text = line.slice('data:'.length).trim();
  if (text.length === 0 || text === '[DONE]') return undefined;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
