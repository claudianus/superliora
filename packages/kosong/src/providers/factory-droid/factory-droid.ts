/**
 * Factory Droid (`factory.ai`) provider — a multiplex adapter over the
 * Factory LLM proxy. The WorkOS access token authorizes every request; the
 * proxy dispatches each model to one upstream router selected by the
 * `x-api-provider` header and speaks one of four wire dialects
 * ({@link resolveFactoryDroidRoute}):
 *
 *   anthropic-messages  → {host}/api/llm/a         (Anthropic Messages)
 *   openai-responses    → {host}/api/llm/o/v1      (OpenAI Responses)
 *   openai-completions  → {host}/api/llm/o/v1      (OpenAI Chat Completions)
 *   google-generate     → {host}/api/llm/g/v1      (Gemini generateContent)
 *
 * Every call carries the Factory client identity set (`User-Agent`,
 * `X-Client-Version`, `X-Factory-Client`, `X-Factory-Org-Id`) plus the
 * per-request routing markers (`x-api-provider`, `x-provider-routing-source`,
 * `x-session-id`, `x-assistant-message-id`) the native CLI emits.
 */

import type { Message } from '../../message';
import type { Tool } from '../../tool';
import type {
  ChatProvider,
  GenerateOptions,
  MaxCompletionTokensOptions,
  StreamedMessage,
  ThinkingEffort,
} from '../../provider';
import { ChatProviderError } from '../../errors';
import { AnthropicChatProvider } from '../anthropic';
import { GoogleGenAIChatProvider } from '../google-genai';
import { OpenAILegacyChatProvider } from '../openai-legacy';
import { OpenAIResponsesChatProvider } from '../openai-responses';
import {
  FACTORY_DROID_MODELS,
  resolveFactoryDroidRoute,
  type FactoryDroidModelRoute,
  type FactoryDroidWire,
} from './factory-droid-registry';

/** Client version reported to Factory's API (matches the native CLI build the registry was captured from). */
export const FACTORY_DROID_CLIENT_VERSION = '0.230.0';
export const FACTORY_DROID_PROVIDER = 'factory-droid';
export const FACTORY_DROID_DEFAULT_MODEL = 'kimi-k3';

export interface FactoryDroidOptions {
  /** WorkOS access token; may also arrive per-request via `options.auth.apiKey`. */
  readonly apiKey?: string | undefined;
  /**
   * Account residency region. `eu` selects `api.eu.factory.ai`; `global`/`us`
   * and undefined use `api.factory.ai`. Persisted from the OAuth whoami
   * exchange (`TokenInfo.region`).
   */
  readonly region?: string | undefined;
  /**
   * Factory external org id (`X-Factory-Org-Id`) resolved at login from the
   * WorkOS `external_org_id` claim / whoami. Org-scoped accounts need it.
   */
  readonly orgId?: string | undefined;
  /** Full host override (custom/enterprise gateways) — wins over `region`. */
  readonly baseUrl?: string | undefined;
  readonly model: string;
  /** Extra static headers merged under the Factory identity set. */
  readonly defaultHeaders?: Record<string, string> | undefined;
}

/** API host for an account residency region. */
export function factoryDroidApiHost(region: string | undefined): string {
  return region === 'eu' ? 'https://api.eu.factory.ai' : 'https://api.factory.ai';
}

function stripTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url.codePointAt(end - 1) === 47) end--;
  return end === url.length ? url : url.slice(0, end);
}

function wireBaseUrl(host: string, wire: FactoryDroidWire): string {
  switch (wire) {
    case 'anthropic-messages':
      return `${host}/api/llm/a`;
    case 'openai-completions':
    case 'openai-responses':
      return `${host}/api/llm/o/v1`;
    case 'google-generate':
      return `${host}/api/llm/g/v1`;
  }
}

interface FactoryDroidState {
  readonly model: string;
  readonly apiKey: string | undefined;
  readonly host: string;
  readonly orgId: string | undefined;
  readonly defaultHeaders: Record<string, string> | undefined;
  readonly route: FactoryDroidModelRoute;
  readonly sessionId: string;
  readonly delegates: Map<FactoryDroidWire, ChatProvider>;
  thinkingEffort: ThinkingEffort | null;
  maxCompletionTokens: number | undefined;
}

export class FactoryDroidChatProvider implements ChatProvider {
  readonly name = FACTORY_DROID_PROVIDER;

  private readonly _s: FactoryDroidState;

  constructor(options: FactoryDroidOptions) {
    const route = resolveFactoryDroidRoute(options.model);
    if (route === undefined) {
      throw new ChatProviderError(`factory-droid: unknown model "${options.model}"`);
    }
    this._s = {
      model: options.model,
      apiKey: options.apiKey,
      orgId: options.orgId,
      defaultHeaders: options.defaultHeaders,
      host: stripTrailingSlashes(options.baseUrl ?? factoryDroidApiHost(options.region)),
      route,
      sessionId: globalThis.crypto.randomUUID(),
      delegates: new Map(),
      thinkingEffort: null,
      maxCompletionTokens: undefined,
    };
  }

  private static _from(state: FactoryDroidState): FactoryDroidChatProvider {
    const provider = Object.create(FactoryDroidChatProvider.prototype) as FactoryDroidChatProvider;
    Object.defineProperty(provider, '_s', { value: state });
    return provider;
  }

  get modelName(): string {
    return this._s.model;
  }

  get thinkingEffort(): ThinkingEffort | null {
    return this._s.thinkingEffort;
  }

  withThinking(effort: ThinkingEffort): ChatProvider {
    // Shares session id and the delegate cache with the original — clones only
    // swap the effort the delegates are re-parameterized with per request.
    return FactoryDroidChatProvider._from({ ...this._s, thinkingEffort: effort });
  }

  withMaxCompletionTokens(
    maxCompletionTokens: number,
    _options?: MaxCompletionTokensOptions,
  ): ChatProvider {
    return FactoryDroidChatProvider._from({ ...this._s, maxCompletionTokens });
  }

  async generate(
    systemPrompt: string,
    tools: Tool[],
    history: Message[],
    options?: GenerateOptions,
  ): Promise<StreamedMessage> {
    const apiKey = options?.auth?.apiKey ?? this._s.apiKey;
    if (apiKey === undefined || apiKey.length === 0) {
      throw new ChatProviderError(
        'factory-droid: apiKey is required (WorkOS access token from /connect).',
      );
    }
    let delegate = this._delegate();
    if (this._s.thinkingEffort !== null) {
      delegate = delegate.withThinking(this._s.thinkingEffort);
    }
    if (this._s.maxCompletionTokens !== undefined && delegate.withMaxCompletionTokens !== undefined) {
      delegate = delegate.withMaxCompletionTokens(this._s.maxCompletionTokens);
    }
    const auth = {
      apiKey,
      headers: this._requestHeaders(apiKey, options?.auth?.headers),
    };
    return delegate.generate(systemPrompt, tools, history, { ...options, auth });
  }

  private _requestHeaders(
    apiKey: string,
    extra: Record<string, string> | undefined,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent': `factory-cli/${FACTORY_DROID_CLIENT_VERSION}`,
      'X-Client-Version': FACTORY_DROID_CLIENT_VERSION,
      'X-Factory-Client': 'cli',
      'x-api-provider': this._s.route.upstream,
      'x-provider-routing-source': 'registry_default',
      'x-session-id': this._s.sessionId,
      'x-assistant-message-id': globalThis.crypto.randomUUID(),
    };
    if (this._s.route.wire === 'openai-completions' || this._s.route.wire === 'openai-responses') {
      headers['Accept'] = 'application/json';
    }
    // The proxy authenticates on Authorization alone; the Anthropic SDK still
    // requires an x-api-key value so the native CLI sends a placeholder.
    if (this._s.route.wire === 'anthropic-messages') {
      headers['Authorization'] = `Bearer ${apiKey}`;
      headers['x-api-key'] = 'placeholder';
    }
    if (this._s.orgId !== undefined && this._s.orgId.length > 0) {
      headers['X-Factory-Org-Id'] = this._s.orgId;
    }
    return { ...headers, ...extra };
  }

  /** Lazily constructs the inner wire adapter for this model's route. */
  private _delegate(): ChatProvider {
    const wire = this._s.route.wire;
    const cached = this._s.delegates.get(wire);
    if (cached !== undefined) return cached;
    const baseUrl = wireBaseUrl(this._s.host, wire);
    const route = this._s.route;
    const delegate = ((): ChatProvider => {
      switch (wire) {
        case 'anthropic-messages':
          return new AnthropicChatProvider({
            apiKey: 'placeholder',
            baseUrl,
            model: this._s.model,
            defaultMaxTokens: route.maxTokens > 0 ? route.maxTokens : undefined,
            defaultHeaders: this._s.defaultHeaders,
          });
        case 'openai-responses':
          return new OpenAIResponsesChatProvider({
            apiKey: this._s.apiKey,
            baseUrl,
            model: this._s.model,
            maxOutputTokens: route.maxTokens > 0 ? route.maxTokens : undefined,
            defaultHeaders: this._s.defaultHeaders,
          });
        case 'openai-completions':
          return new OpenAILegacyChatProvider({
            apiKey: this._s.apiKey,
            baseUrl,
            model: this._s.model,
            maxTokens: route.maxTokens > 0 ? route.maxTokens : undefined,
            defaultHeaders: this._s.defaultHeaders,
          });
        case 'google-generate':
          return new GoogleGenAIChatProvider({
            apiKey: this._s.apiKey,
            baseUrl,
            model: this._s.model,
            defaultHeaders: this._s.defaultHeaders,
          });
      }
    })();
    this._s.delegates.set(wire, delegate);
    return delegate;
  }
}

/** Static roster for picker/discovery — Factory exposes no listing endpoint. */
export function factoryDroidModels(): Readonly<Record<string, FactoryDroidModelRoute>> {
  return FACTORY_DROID_MODELS;
}
