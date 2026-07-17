import { describe, expect, it } from 'vitest';

import type { LioraConfig, OAuthRef } from '../../src/config';
import { ErrorCodes, LioraError } from '../../src/errors';
import { ProviderManager } from '../../src/session/provider-manager';
import { resolveThinkingLevel } from '../../src/agent/config/thinking';

// Thin wrapper that adapts the legacy `resolveRuntimeProvider(input)` shape to
// the current ProviderManager API. Kept local so the existing test bodies do
// not need to change.
function resolveRuntimeProvider(input: {
  readonly config: LioraConfig;
  readonly model?: string;
  readonly kimiRequestHeaders?: Record<string, string>;
  readonly promptCacheKey?: string;
}): ReturnType<ProviderManager['resolveProviderConfig']> {
  const manager = new ProviderManager({
    config: input.config,
    kimiRequestHeaders: input.kimiRequestHeaders,
    promptCacheKey: input.promptCacheKey,
  });
  const model = input.model ?? input.config.defaultModel;
  if (model === undefined) {
    throw new LioraError(
      ErrorCodes.CONFIG_INVALID,
      'No model is selected. Set default_model in config.toml or pass a configured model alias.',
    );
  }
  return manager.resolveProviderConfig(model);
}

const BASE_CONFIG: LioraConfig = {
  defaultModel: 'kimi-code/kimi-for-coding',
  providers: {
    'managed:kimi-code': {
      type: 'kimi',
      apiKey: 'test-key',
      baseUrl: 'https://api.example/v1',
    },
  },
  models: {
    'kimi-code/kimi-for-coding': {
      provider: 'managed:kimi-code',
      model: 'kimi-for-coding',
      maxContextSize: 1_000_000,
      capabilities: ['thinking', 'image_in', 'video_in', 'tool_use'],
    },
  },
};

const TEST_KIMI_HEADERS = {
  'User-Agent': 'kimi-code-cli/0.0.0-test',
  'X-Msh-Platform': 'kimi_code_cli',
  'X-Msh-Version': '0.0.0-test',
};

describe('resolveRuntimeProvider model metadata', () => {
  it('uses config model metadata as the source of truth', () => {
    const resolved = resolveRuntimeProvider({
      config: BASE_CONFIG,
    });

    expect(resolved.modelCapabilities).toMatchObject({
      image_in: true,
      video_in: true,
      thinking: true,
      tool_use: true,
      max_context_tokens: 1_000_000,
    });
    expect(resolved.provider.model).toBe('kimi-for-coding');
  });

  it('resolves requested aliases to the configured provider and provider model', () => {
    const resolved = resolveRuntimeProvider({
      config: {
        ...BASE_CONFIG,
        providers: {
          ...BASE_CONFIG.providers,
          openai: {
            type: 'openai',
            apiKey: 'sk-openai',
            baseUrl: 'https://openai.example/v1',
          },
        },
        models: {
          ...BASE_CONFIG.models!,
          'gpt-alias': {
            provider: 'openai',
            model: 'gpt-runtime',
            maxContextSize: 200000,
            capabilities: ['tool_use'],
          },
        },
      },
      model: 'gpt-alias',
    });

    expect(resolved.providerName).toBe('openai');
    expect(resolved.provider).toMatchObject({
      type: 'openai',
      model: 'gpt-runtime',
      apiKey: 'sk-openai',
      baseUrl: 'https://openai.example/v1',
    });
    expect(resolved.modelCapabilities).toMatchObject({
      tool_use: true,
      max_context_tokens: 200000,
    });
  });

  it('uses config Kimi capabilities without requiring an api key during OAuth setup', () => {
    const resolved = resolveRuntimeProvider({
      config: {
        ...BASE_CONFIG,
        providers: {
          'managed:kimi-code': {
            type: 'kimi',
            apiKey: '',
            baseUrl: 'https://api.example/v1',
            oauth: { storage: 'file', key: 'oauth/kimi-code' },
          },
        },
      },
    });

    expect(resolved.modelCapabilities).toMatchObject({
      image_in: true,
      video_in: true,
      thinking: true,
      tool_use: true,
      max_context_tokens: 1_000_000,
    });
  });

  it('does not infer Kimi capabilities from the provider model name', () => {
    const resolved = resolveRuntimeProvider({
      config: {
        ...BASE_CONFIG,
        models: {
          'kimi-code/kimi-for-coding': {
            provider: 'managed:kimi-code',
            model: 'kimi-for-coding',
            maxContextSize: 1_000_000,
          },
        },
      },
    });

    expect(resolved.modelCapabilities).toMatchObject({
      image_in: false,
      video_in: false,
      thinking: false,
      tool_use: false,
      max_context_tokens: 1_000_000,
    });
  });

  it('rejects provider model names that are not configured aliases', () => {
    expect(() =>
      resolveRuntimeProvider({
        config: BASE_CONFIG,
        model: 'kimi-for-coding',
      }),
    ).toThrow(/not configured in config.toml/);
  });

  it('throws when no model is selected', () => {
    expect(() =>
      resolveRuntimeProvider({
        config: {
          providers: {},
        },
      }),
    ).toThrow(/No model is selected/);
  });

  it('throws when the selected model is not configured as an alias', () => {
    expect(() =>
      resolveRuntimeProvider({
        config: BASE_CONFIG,
        model: 'kimi-code',
      }),
    ).toThrow(LioraError);
  });

  it('allows vertexai providers without an apiKey', () => {
    const resolved = resolveRuntimeProvider({
      config: {
        defaultModel: 'gemini',
        providers: {
          vertex: {
            type: 'vertexai',
          },
        },
        models: {
          gemini: {
            provider: 'vertex',
            model: 'gemini-1.5-pro',
            maxContextSize: 1_000_000,
          },
        },
      },
    });

    expect(resolved.provider).toMatchObject({ type: 'vertexai' });
  });

  it('throws when the selected model alias has no maxContextSize', () => {
    const config = {
      ...BASE_CONFIG,
      models: {
        broken: {
          provider: 'managed:kimi-code',
          model: 'kimi-for-coding',
          capabilities: ['thinking'],
        },
      },
    } as unknown as LioraConfig;

    expect(() =>
      resolveRuntimeProvider({
        config,
        model: 'broken',
      }),
    ).toThrow(/max_context_size/);
  });
});

describe('resolveRuntimeProvider maxOutputSize forwarding', () => {
  it('returns alias.maxOutputSize for request completion budgeting', () => {
    const resolved = resolveRuntimeProvider({
      config: {
        ...BASE_CONFIG,
        providers: {
          ...BASE_CONFIG.providers,
          openai: {
            type: 'openai',
            apiKey: 'sk-openai',
            baseUrl: 'https://openai.example/v1',
          },
        },
        models: {
          ...BASE_CONFIG.models!,
          'deepseek-alias': {
            provider: 'openai',
            model: 'deepseek-v4-flash',
            maxContextSize: 1_000_000,
            maxOutputSize: 384000,
          },
        },
      },
      model: 'deepseek-alias',
    });

    expect(resolved.maxOutputSize).toBe(384000);
  });

  it('forwards alias.maxOutputSize to the anthropic provider config as defaultMaxTokens', () => {
    const resolved = resolveRuntimeProvider({
      config: {
        ...BASE_CONFIG,
        providers: {
          ...BASE_CONFIG.providers,
          anthropic: { type: 'anthropic', apiKey: 'sk-anthropic' },
        },
        models: {
          ...BASE_CONFIG.models!,
          'opus-alias': {
            provider: 'anthropic',
            model: 'claude-opus-4-7',
            maxContextSize: 200000,
            maxOutputSize: 24000,
          },
        },
      },
      model: 'opus-alias',
    });

    expect(resolved.provider).toMatchObject({
      type: 'anthropic',
      model: 'claude-opus-4-7',
      defaultMaxTokens: 24000,
    });
  });

  it('omits defaultMaxTokens when alias.maxOutputSize is unset', () => {
    const resolved = resolveRuntimeProvider({
      config: {
        ...BASE_CONFIG,
        providers: {
          ...BASE_CONFIG.providers,
          anthropic: { type: 'anthropic', apiKey: 'sk-anthropic' },
        },
        models: {
          ...BASE_CONFIG.models!,
          'opus-alias': {
            provider: 'anthropic',
            model: 'claude-opus-4-7',
            maxContextSize: 200000,
          },
        },
      },
      model: 'opus-alias',
    });

    expect(resolved.provider).toMatchObject({
      type: 'anthropic',
      model: 'claude-opus-4-7',
    });
    expect('defaultMaxTokens' in resolved.provider).toBe(false);
  });

  it('forwards alias.adaptiveThinking to the anthropic provider config', () => {
    const resolved = resolveRuntimeProvider({
      config: {
        ...BASE_CONFIG,
        providers: {
          ...BASE_CONFIG.providers,
          anthropic: { type: 'anthropic', apiKey: 'sk-anthropic' },
        },
        models: {
          ...BASE_CONFIG.models!,
          'okapi-alias': {
            provider: 'anthropic',
            model: 'coding-model-okapi-0527-vibe',
            maxContextSize: 200000,
            adaptiveThinking: true,
          },
        },
      },
      model: 'okapi-alias',
    });

    expect(resolved.provider).toMatchObject({
      type: 'anthropic',
      model: 'coding-model-okapi-0527-vibe',
      adaptiveThinking: true,
    });
  });

  it('omits adaptiveThinking when alias.adaptiveThinking is unset', () => {
    const resolved = resolveRuntimeProvider({
      config: {
        ...BASE_CONFIG,
        providers: {
          ...BASE_CONFIG.providers,
          anthropic: { type: 'anthropic', apiKey: 'sk-anthropic' },
        },
        models: {
          ...BASE_CONFIG.models!,
          'opus-alias': {
            provider: 'anthropic',
            model: 'claude-opus-4-7',
            maxContextSize: 200000,
          },
        },
      },
      model: 'opus-alias',
    });

    expect('adaptiveThinking' in resolved.provider).toBe(false);
  });

  it('routes Kimi aliases with anthropic protocol through the Anthropic provider', () => {
    const resolved = resolveRuntimeProvider({
      config: {
        ...BASE_CONFIG,
        models: {
          'kimi-code/kimi-for-coding': {
            provider: 'managed:kimi-code',
            model: 'kimi-for-coding',
            maxContextSize: 1_000_000,
            capabilities: ['thinking', 'tool_use'],
            protocol: 'anthropic',
            betaApi: true,
            adaptiveThinking: true,
          },
        },
      },
      kimiRequestHeaders: TEST_KIMI_HEADERS,
      promptCacheKey: 'session-test',
    });

    expect(resolved.providerName).toBe('managed:kimi-code');
    expect(resolved.provider).toMatchObject({
      type: 'anthropic',
      model: 'kimi-for-coding',
      baseUrl: 'https://api.example',
      apiKey: 'test-key',
      betaApi: true,
      adaptiveThinking: true,
      metadata: { user_id: 'session-test' },
      defaultHeaders: TEST_KIMI_HEADERS,
    });
  });
});

describe('resolveRuntimeProvider Kimi request headers', () => {
  it('does not set defaultHeaders when no kimiRequestHeaders or customHeaders exist', () => {
    const resolved = resolveRuntimeProvider({ config: BASE_CONFIG });

    expect(resolved.provider).toMatchObject({
      type: 'kimi',
      model: 'kimi-for-coding',
    });
    expect('defaultHeaders' in resolved.provider).toBe(false);
  });

  it('uses only customHeaders when kimiRequestHeaders are missing', () => {
    const resolved = resolveRuntimeProvider({
      config: {
        ...BASE_CONFIG,
        providers: {
          'managed:kimi-code': {
            type: 'kimi',
            apiKey: 'test-key',
            baseUrl: 'https://api.example/v1',
            customHeaders: {
              'User-Agent': 'Custom/1',
            },
          },
        },
      },
    });

    expect(resolved.provider).toMatchObject({
      type: 'kimi',
      defaultHeaders: {
        'User-Agent': 'Custom/1',
      },
    });
  });

  it('passes kimiRequestHeaders through to Kimi provider defaultHeaders', () => {
    const resolved = resolveRuntimeProvider({
      config: BASE_CONFIG,
      kimiRequestHeaders: TEST_KIMI_HEADERS,
    });

    expect(resolved.provider).toMatchObject({
      type: 'kimi',
      defaultHeaders: TEST_KIMI_HEADERS,
    });
  });

  it('passes the prompt cache key to Kimi generation kwargs', () => {
    const resolved = resolveRuntimeProvider({
      config: BASE_CONFIG,
      promptCacheKey: 'session-test',
    });

    expect(resolved.provider).toMatchObject({
      type: 'kimi',
      generationKwargs: {
        prompt_cache_key: 'session-test',
      },
    });
  });

  it('lets provider customHeaders override kimiRequestHeaders', () => {
    const resolved = resolveRuntimeProvider({
      config: {
        ...BASE_CONFIG,
        providers: {
          'managed:kimi-code': {
            type: 'kimi',
            apiKey: 'test-key',
            baseUrl: 'https://api.example/v1',
            customHeaders: {
              'User-Agent': 'Custom/1',
              'X-Msh-Version': 'override-version',
            },
          },
        },
      },
      kimiRequestHeaders: TEST_KIMI_HEADERS,
    });

    expect(resolved.provider).toMatchObject({
      type: 'kimi',
      defaultHeaders: {
        'User-Agent': 'Custom/1',
        'X-Msh-Platform': 'kimi_code_cli',
        'X-Msh-Version': 'override-version',
      },
    });
  });

  it('does not apply kimiRequestHeaders to non-Kimi providers', () => {
    const resolved = resolveRuntimeProvider({
      config: {
        defaultModel: 'gpt-alias',
        providers: {
          openai: {
            type: 'openai',
            apiKey: 'sk-openai',
          },
        },
        models: {
          'gpt-alias': {
            provider: 'openai',
            model: 'gpt-runtime',
            maxContextSize: 200000,
          },
        },
      },
      kimiRequestHeaders: TEST_KIMI_HEADERS,
      promptCacheKey: 'session-test',
    });

    expect(resolved.provider).toMatchObject({
      type: 'openai',
      model: 'gpt-runtime',
      apiKey: 'sk-openai',
    });
    expect('defaultHeaders' in resolved.provider).toBe(false);
    expect('generationKwargs' in resolved.provider).toBe(false);
  });
});

describe('resolveRuntimeProvider customHeaders propagation', () => {
  it('forwards customHeaders to an anthropic provider', () => {
    const resolved = resolveRuntimeProvider({
      config: {
        defaultModel: 'claude-alias',
        providers: {
          anthropic: {
            type: 'anthropic',
            apiKey: 'sk-anthropic',
            customHeaders: { 'X-Custom': 'value' },
          },
        },
        models: {
          'claude-alias': { provider: 'anthropic', model: 'claude-runtime', maxContextSize: 200000 },
        },
      },
    });

    expect(resolved.provider).toMatchObject({
      type: 'anthropic',
      defaultHeaders: { 'X-Custom': 'value' },
    });
  });

  it('forwards customHeaders to an openai provider', () => {
    const resolved = resolveRuntimeProvider({
      config: {
        defaultModel: 'gpt-alias',
        providers: {
          openai: {
            type: 'openai',
            apiKey: 'sk-openai',
            customHeaders: { 'X-Custom': 'value' },
          },
        },
        models: {
          'gpt-alias': { provider: 'openai', model: 'gpt-runtime', maxContextSize: 200000 },
        },
      },
    });

    expect(resolved.provider).toMatchObject({
      type: 'openai',
      defaultHeaders: { 'X-Custom': 'value' },
    });
  });

  it('adds Grok Build CLI headers when the openai base URL is the Build proxy', () => {
    const resolved = resolveRuntimeProvider({
      config: {
        defaultModel: 'xai-grok/grok-4.5',
        providers: {
          'xai-grok': {
            type: 'openai',
            baseUrl: 'https://cli-chat-proxy.grok.com/v1',
            oauth: { storage: 'file', key: 'xai-grok' },
            customHeaders: { 'X-XAI-Token-Auth': 'xai-grok-cli' },
          },
        },
        models: {
          'xai-grok/grok-4.5': {
            provider: 'xai-grok',
            model: 'grok-4.5',
            maxContextSize: 500000,
            capabilities: ['thinking', 'tool_use'],
          },
        },
      },
    });

    expect(resolved.provider).toMatchObject({
      type: 'openai',
      baseUrl: 'https://cli-chat-proxy.grok.com/v1',
      defaultHeaders: {
        'X-XAI-Token-Auth': 'xai-grok-cli',
        'x-grok-model-override': 'grok-4.5',
      },
    });
  });

  it('does not inject Grok Build headers for the public xAI API base URL', () => {
    const resolved = resolveRuntimeProvider({
      config: {
        defaultModel: 'xai-grok/grok-4.5',
        providers: {
          'xai-grok': {
            type: 'openai',
            baseUrl: 'https://api.x.ai/v1',
            oauth: { storage: 'file', key: 'xai-grok' },
          },
        },
        models: {
          'xai-grok/grok-4.5': {
            provider: 'xai-grok',
            model: 'grok-4.5',
            maxContextSize: 500000,
            capabilities: ['thinking', 'tool_use'],
          },
        },
      },
    });

    expect(resolved.provider).toMatchObject({
      type: 'openai',
      baseUrl: 'https://api.x.ai/v1',
    });
    expect(
      (resolved.provider as { defaultHeaders?: Record<string, string> }).defaultHeaders,
    ).toBeUndefined();
  });

  it('forwards customHeaders to an openai_responses provider', () => {
    const resolved = resolveRuntimeProvider({
      config: {
        defaultModel: 'resp-alias',
        providers: {
          openai_responses: {
            type: 'openai_responses',
            apiKey: 'sk-openai',
            customHeaders: { 'X-Custom': 'value' },
          },
        },
        models: {
          'resp-alias': {
            provider: 'openai_responses',
            model: 'gpt-runtime',
            maxContextSize: 200000,
          },
        },
      },
    });

    expect(resolved.provider).toMatchObject({
      type: 'openai_responses',
      defaultHeaders: { 'X-Custom': 'value' },
    });
  });

  it('keeps customHeaders isolated between resolved provider instances', () => {
    const config: LioraConfig = {
      defaultModel: 'gpt-alias',
      providers: {
        openai: {
          type: 'openai',
          apiKey: 'sk-openai',
          customHeaders: { 'X-Custom': 'original' },
        },
      },
      models: {
        'gpt-alias': { provider: 'openai', model: 'gpt-runtime', maxContextSize: 200000 },
      },
    };

    const first = resolveRuntimeProvider({ config });
    const second = resolveRuntimeProvider({ config });
    const firstHeaders = (first.provider as { defaultHeaders?: Record<string, string> })
      .defaultHeaders;
    expect(firstHeaders).toEqual({ 'X-Custom': 'original' });

    firstHeaders!['X-Custom'] = 'mutated';

    expect(
      (second.provider as { defaultHeaders?: Record<string, string> }).defaultHeaders,
    ).toEqual({ 'X-Custom': 'original' });
    expect(config.providers['openai']?.customHeaders).toEqual({ 'X-Custom': 'original' });
  });
});

describe('ProviderManager prompt cache key', () => {
  it('applies a prompt cache key to Kimi providers', () => {
    const manager = new ProviderManager({
      config: BASE_CONFIG,
      promptCacheKey: 'session-test',
    });
    const resolved = manager.resolveProviderConfig('kimi-code/kimi-for-coding');

    expect(resolved.provider).toMatchObject({
      type: 'kimi',
      generationKwargs: {
        prompt_cache_key: 'session-test',
      },
    });
  });

  it('does not add generation kwargs to non-Kimi providers', () => {
    const manager = new ProviderManager({
      promptCacheKey: 'session-test',
      config: {
        defaultModel: 'gpt-alias',
        providers: {
          openai: {
            type: 'openai',
            apiKey: 'sk-openai',
          },
        },
        models: {
          'gpt-alias': {
            provider: 'openai',
            model: 'gpt-runtime',
            maxContextSize: 200000,
          },
        },
      },
    });
    const resolved = manager.resolveProviderConfig('gpt-alias');

    expect(resolved.provider).toMatchObject({
      type: 'openai',
      model: 'gpt-runtime',
    });
    expect('generationKwargs' in resolved.provider).toBe(false);
  });

  it('reads the current config when constructed with a function', () => {
    let sharedConfig: LioraConfig = { providers: {} };
    const manager = new ProviderManager({
      config: () => sharedConfig,
      promptCacheKey: 'session-test',
    });

    sharedConfig = BASE_CONFIG;

    const resolved = manager.resolveProviderConfig('kimi-code/kimi-for-coding');
    expect(resolved.provider).toMatchObject({
      type: 'kimi',
      generationKwargs: {
        prompt_cache_key: 'session-test',
      },
    });
  });
});

describe('ProviderManager provider routes', () => {
  it('expands provider api key pools into auto route candidates', () => {
    const manager = new ProviderManager({
      config: {
        defaultModel: 'primary',
        providers: {
          openai: {
            type: 'openai',
            apiKeys: ['sk-one', 'sk-two', 'sk-one'],
          },
        },
        models: {
          primary: {
            provider: 'openai',
            model: 'gpt-primary',
            maxContextSize: 200000,
            routing: {
              sessionAffinity: true,
              preferredCredential: 'api_key:2',
            },
          },
        },
      },
    });

    const resolved = manager.resolveProviderConfig('primary');
    const route = manager.resolveProviderRoute('primary');

    expect(resolved.provider).toMatchObject({ apiKey: 'sk-one' });
    expect(route?.strategy).toBe('auto');
    expect(route?.sessionAffinity).toBe(true);
    expect(route?.preferredCredential).toBe('api_key:2');
    expect(
      route?.candidates.map((candidate) => ({
        modelAlias: candidate.modelAlias,
        credentialLabel: candidate.credentialLabel,
        apiKey: candidate.provider.apiKey,
      })),
    ).toEqual([
      { modelAlias: 'primary', credentialLabel: 'api_key:1', apiKey: 'sk-one' },
      { modelAlias: 'primary', credentialLabel: 'api_key:2', apiKey: 'sk-two' },
    ]);
  });

  it('expands per-credential base URLs into route candidates', () => {
    const manager = new ProviderManager({
      config: {
        defaultModel: 'primary',
        providers: {
          cloudflare: {
            type: 'openai',
            baseUrl: 'https://api.cloudflare.com/client/v4/accounts/account-1/ai/v1',
            credentials: [
              {
                label: 'account-1',
                apiKey: 'cf-one',
                baseUrl: 'https://api.cloudflare.com/client/v4/accounts/account-1/ai/v1',
              },
              {
                label: 'account-2',
                apiKey: 'cf-two',
                baseUrl: 'https://api.cloudflare.com/client/v4/accounts/account-2/ai/v1',
              },
            ],
          },
        },
        models: {
          primary: {
            provider: 'cloudflare',
            model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
            maxContextSize: 200000,
          },
        },
      },
    });

    const route = manager.resolveProviderRoute('primary');

    expect(
      route?.candidates.map((candidate) => ({
        credentialLabel: candidate.credentialLabel,
        apiKey: candidate.provider.apiKey,
        baseUrl: (candidate.provider as { readonly baseUrl?: string }).baseUrl,
      })),
    ).toEqual([
      {
        credentialLabel: 'api_key:account-1',
        apiKey: 'cf-one',
        baseUrl: 'https://api.cloudflare.com/client/v4/accounts/account-1/ai/v1',
      },
      {
        credentialLabel: 'api_key:account-2',
        apiKey: 'cf-two',
        baseUrl: 'https://api.cloudflare.com/client/v4/accounts/account-2/ai/v1',
      },
    ]);
  });

  it('uses a single credential base URL as the runtime provider endpoint', () => {
    const manager = new ProviderManager({
      config: {
        defaultModel: 'primary',
        providers: {
          custom: {
            type: 'openai',
            baseUrl: 'https://default.example.test/v1',
            credentials: [
              {
                apiKey: 'sk-one',
                baseUrl: 'https://account.example.test/v1',
              },
            ],
          },
        },
        models: {
          primary: {
            provider: 'custom',
            model: 'gpt-primary',
            maxContextSize: 200000,
          },
        },
      },
    });

    const resolved = manager.resolveProviderConfig('primary');

    expect(resolved.provider).toMatchObject({
      apiKey: 'sk-one',
      baseUrl: 'https://account.example.test/v1',
    });
  });

  it('keeps a single named credential label on explicit routes', () => {
    const manager = new ProviderManager({
      config: {
        defaultModel: 'primary',
        providers: {
          openai: {
            type: 'openai',
            credentials: [{ apiKey: 'sk-work', label: 'work', rpm: 2, tpm: 1000 }],
          },
        },
        models: {
          primary: {
            provider: 'openai',
            model: 'gpt-primary',
            maxContextSize: 200000,
            routing: {
              preferredCredential: 'api_key:work',
            },
          },
        },
      },
    });

    const route = manager.resolveProviderRoute('primary');

    expect(route?.preferredCredential).toBe('api_key:work');
    expect(
      route?.candidates.map((candidate) => ({
        credentialLabel: candidate.credentialLabel,
        localLimits: candidate.localLimits,
        apiKey: candidate.provider.apiKey,
      })),
    ).toEqual([
      {
        credentialLabel: 'api_key:work',
        localLimits: { rpm: 2, tpm: 1000 },
        apiKey: 'sk-work',
      },
    ]);
  });

  it('expands provider OAuth pools into auto route candidates', () => {
    const manager = new ProviderManager({
      config: {
        defaultModel: 'primary',
        providers: {
          openai: {
            type: 'openai',
            oauth: { storage: 'file', key: 'oauth/primary', label: 'work' },
            oauths: [
              { storage: 'file', key: 'oauth/backup', label: 'backup' },
              { storage: 'file', key: 'oauth/primary', label: 'duplicate-primary' },
            ],
          },
        },
        models: {
          primary: {
            provider: 'openai',
            model: 'gpt-primary',
            maxContextSize: 200000,
          },
        },
      },
    });

    const route = manager.resolveProviderRoute('primary');

    expect(route?.strategy).toBe('auto');
    expect(
      route?.candidates.map((candidate) => ({
        modelAlias: candidate.modelAlias,
        credentialLabel: candidate.credentialLabel,
        oauthKey: candidate.oauthRef?.key,
        apiKey: candidate.provider.apiKey,
      })),
    ).toEqual([
      {
        modelAlias: 'primary',
        credentialLabel: 'oauth:work',
        oauthKey: 'oauth/primary',
        apiKey: undefined,
      },
      {
        modelAlias: 'primary',
        credentialLabel: 'oauth:backup',
        oauthKey: 'oauth/backup',
        apiKey: undefined,
      },
    ]);
  });

  it('resolves explicit environment references in provider api key pools', () => {
    const previousOne = process.env['KIMI_TEST_OPENAI_KEY_ONE'];
    const previousTwo = process.env['KIMI_TEST_OPENAI_KEY_TWO'];
    process.env['KIMI_TEST_OPENAI_KEY_ONE'] = 'sk-env-one';
    process.env['KIMI_TEST_OPENAI_KEY_TWO'] = 'sk-env-two';

    try {
      const manager = new ProviderManager({
        config: {
          defaultModel: 'primary',
          providers: {
            openai: {
              type: 'openai',
              apiKey: '{env:KIMI_TEST_OPENAI_KEY_ONE}',
              apiKeys: ['env:KIMI_TEST_OPENAI_KEY_TWO', 'env/KIMI_TEST_OPENAI_KEY_ONE'],
            },
          },
          models: {
            primary: {
              provider: 'openai',
              model: 'gpt-primary',
              maxContextSize: 200000,
            },
          },
        },
      });

      const resolved = manager.resolveProviderConfig('primary');
      const route = manager.resolveProviderRoute('primary');

      expect(resolved.provider).toMatchObject({ apiKey: 'sk-env-one' });
      expect(route?.strategy).toBe('auto');
      expect(route?.candidates.map((candidate) => candidate.provider.apiKey)).toEqual([
        'sk-env-one',
        'sk-env-two',
      ]);
    } finally {
      if (previousOne === undefined) delete process.env['KIMI_TEST_OPENAI_KEY_ONE'];
      else process.env['KIMI_TEST_OPENAI_KEY_ONE'] = previousOne;
      if (previousTwo === undefined) delete process.env['KIMI_TEST_OPENAI_KEY_TWO'];
      else process.env['KIMI_TEST_OPENAI_KEY_TWO'] = previousTwo;
    }
  });

  it('fails fast when an explicit provider api key environment reference is missing', () => {
    const previous = process.env['KIMI_TEST_MISSING_OPENAI_KEY'];
    delete process.env['KIMI_TEST_MISSING_OPENAI_KEY'];
    const manager = new ProviderManager({
      config: {
        defaultModel: 'primary',
        providers: {
          openai: {
            type: 'openai',
            apiKey: '{env:KIMI_TEST_MISSING_OPENAI_KEY}',
          },
        },
        models: {
          primary: {
            provider: 'openai',
            model: 'gpt-primary',
            maxContextSize: 200000,
          },
        },
      },
    });

    try {
      expect(() => manager.resolveProviderConfig('primary')).toThrow(
        /KIMI_TEST_MISSING_OPENAI_KEY/,
      );
    } finally {
      if (previous !== undefined) process.env['KIMI_TEST_MISSING_OPENAI_KEY'] = previous;
    }
  });

  it('resolves primary and fallback model aliases in routing order', () => {
    const manager = new ProviderManager({
      config: {
        defaultModel: 'primary',
        providers: {
          primary: {
            type: 'openai',
            apiKey: 'sk-primary',
          },
          backup: {
            type: 'anthropic',
            apiKey: 'sk-backup',
          },
        },
        models: {
          primary: {
            provider: 'primary',
            model: 'gpt-primary',
            maxContextSize: 200000,
            fallbackModels: ['backup', 'primary'],
            routing: { strategy: 'round_robin', cooldownMs: 120000 },
          },
          backup: {
            provider: 'backup',
            model: 'claude-backup',
            maxContextSize: 200000,
          },
        },
      },
    });

    const route = manager.resolveProviderRoute('primary');

    expect(route).toMatchObject({
      modelAlias: 'primary',
      strategy: 'round_robin',
      cooldownMs: 120000,
    });
    expect(
      route?.candidates.map((candidate) => ({
        modelAlias: candidate.modelAlias,
        providerName: candidate.providerName,
        providerModel: candidate.provider.model,
      })),
    ).toEqual([
      { modelAlias: 'primary', providerName: 'primary', providerModel: 'gpt-primary' },
      { modelAlias: 'backup', providerName: 'backup', providerModel: 'claude-backup' },
    ]);
  });

  it('attaches route weights to expanded model candidates', () => {
    const manager = new ProviderManager({
      config: {
        defaultModel: 'primary',
        providers: {
          primary: {
            type: 'openai',
            apiKeys: ['sk-primary-one', 'sk-primary-two'],
          },
          backup: {
            type: 'anthropic',
            apiKey: 'sk-backup',
          },
        },
        models: {
          primary: {
            provider: 'primary',
            model: 'gpt-primary',
            maxContextSize: 200000,
            fallbackModels: ['backup'],
            routing: {
              strategy: 'weighted_round_robin',
              weights: { primary: 3, backup: 1 },
            },
          },
          backup: {
            provider: 'backup',
            model: 'claude-backup',
            maxContextSize: 200000,
          },
        },
      },
    });

    const route = manager.resolveProviderRoute('primary');

    expect(route?.strategy).toBe('weighted_round_robin');
    expect(
      route?.candidates.map((candidate) => ({
        modelAlias: candidate.modelAlias,
        credentialLabel: candidate.credentialLabel,
        weight: candidate.weight,
      })),
    ).toEqual([
      { modelAlias: 'primary', credentialLabel: 'api_key:1', weight: 3 },
      { modelAlias: 'primary', credentialLabel: 'api_key:2', weight: 3 },
      { modelAlias: 'backup', credentialLabel: undefined, weight: 1 },
    ]);
  });

  it('returns no route when a model has no fallback routing configured', () => {
    const manager = new ProviderManager({ config: BASE_CONFIG });

    expect(manager.resolveProviderRoute('kimi-code/kimi-for-coding')).toBeUndefined();
  });
});

describe('ProviderManager OAuth auth', () => {
  function oauthConfig(): LioraConfig {
    return {
      ...BASE_CONFIG,
      providers: {
        'managed:kimi-code': {
          type: 'kimi',
          apiKey: '',
          baseUrl: 'https://api.example/v1',
          oauth: { storage: 'file', key: 'oauth/kimi-code' },
        },
      },
    };
  }

  it('preserves non-Kimi token fetch failures instead of guessing their category', async () => {
    const tokenError = new Error('token storage permission denied');
    const manager = new ProviderManager({
      config: oauthConfig(),
      resolveOAuthTokenProvider: () => ({
        async getAccessToken() {
          throw tokenError;
        },
      }),
    });

    const resolveAuth = manager.resolveAuth('kimi-code/kimi-for-coding');
    expect(resolveAuth).toBeDefined();

    await expect(resolveAuth!(async () => 'ok')).rejects.toBe(tokenError);
  });

  it('keeps explicit login-required token failures as login-required errors', async () => {
    const manager = new ProviderManager({
      config: oauthConfig(),
      resolveOAuthTokenProvider: () => ({
        async getAccessToken() {
          throw new LioraError(ErrorCodes.AUTH_LOGIN_REQUIRED, 'not logged in');
        },
      }),
    });

    const resolveAuth = manager.resolveAuth('kimi-code/kimi-for-coding');
    expect(resolveAuth).toBeDefined();

    await expect(resolveAuth!(async () => 'ok')).rejects.toMatchObject({
      code: ErrorCodes.AUTH_LOGIN_REQUIRED,
    });
  });

  it('adds route-safe OAuth credential details to login-required token failures', async () => {
    const manager = new ProviderManager({
      config: {
        ...oauthConfig(),
        providers: {
          'managed:kimi-code': {
            type: 'kimi',
            apiKey: '',
            baseUrl: 'https://api.example/v1',
            oauth: { storage: 'file', key: 'oauth/primary', label: 'work' },
            oauths: [{ storage: 'file', key: 'oauth/backup', label: 'backup' }],
          },
        },
      },
      resolveOAuthTokenProvider: () => ({
        async getAccessToken() {
          throw new LioraError(ErrorCodes.AUTH_LOGIN_REQUIRED, 'not logged in');
        },
      }),
    });

    const resolveAuth = manager.resolveAuth('kimi-code/kimi-for-coding', {
      credentialLabel: 'oauth:2',
    });
    expect(resolveAuth).toBeDefined();

    let thrown: unknown;
    try {
      await resolveAuth!(async () => 'ok');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      code: ErrorCodes.AUTH_LOGIN_REQUIRED,
      details: {
        providerName: 'managed:kimi-code',
        credentialLabel: 'oauth:2',
        oauthStorage: 'file',
        oauthKeyFingerprint: expect.any(String),
      },
    });
    expect(JSON.stringify((thrown as LioraError).details)).not.toContain('oauth/backup');
  });

  it('prefers explicit api keys over configured OAuth credentials', () => {
    let tokenProviderResolved = false;
    const manager = new ProviderManager({
      config: {
        ...oauthConfig(),
        providers: {
          'managed:kimi-code': {
            type: 'kimi',
            apiKey: 'static-key',
            baseUrl: 'https://api.example/v1',
            oauth: { storage: 'file', key: 'oauth/kimi-code' },
          },
        },
      },
      resolveOAuthTokenProvider: () => {
        tokenProviderResolved = true;
        return {
          async getAccessToken() {
            return 'oauth-token';
          },
        };
      },
    });

    const resolved = manager.resolveProviderConfig('kimi-code/kimi-for-coding');

    expect(resolved.provider).toMatchObject({ apiKey: 'static-key' });
    expect(manager.resolveAuth('kimi-code/kimi-for-coding')).toBeUndefined();
    expect(tokenProviderResolved).toBe(false);
  });

  it('uses the route candidate credential label to select an OAuth account', async () => {
    const resolvedRefs: OAuthRef[] = [];
    const manager = new ProviderManager({
      config: {
        ...oauthConfig(),
        providers: {
          'managed:kimi-code': {
            type: 'kimi',
            apiKey: '',
            baseUrl: 'https://api.example/v1',
            oauth: { storage: 'file', key: 'oauth/primary', label: 'work' },
            oauths: [{ storage: 'file', key: 'oauth/backup', label: 'backup' }],
          },
        },
      },
      resolveOAuthTokenProvider: (_providerName, oauthRef) => {
        if (oauthRef === undefined) return undefined;
        resolvedRefs.push(oauthRef);
        return {
          async getAccessToken() {
            return `token:${oauthRef.key}`;
          },
        };
      },
    });

    const primaryAuth = manager.resolveAuth('kimi-code/kimi-for-coding', {
      credentialLabel: 'oauth:work',
    });
    const backupAuth = manager.resolveAuth('kimi-code/kimi-for-coding', {
      credentialLabel: 'oauth:backup',
    });

    expect(primaryAuth).toBeDefined();
    expect(backupAuth).toBeDefined();
    await expect(primaryAuth!((auth) => Promise.resolve(auth.apiKey))).resolves.toBe(
      'token:oauth/primary',
    );
    await expect(backupAuth!((auth) => Promise.resolve(auth.apiKey))).resolves.toBe(
      'token:oauth/backup',
    );
    expect(resolvedRefs.map((ref) => ref.key)).toEqual(['oauth/primary', 'oauth/backup']);
  });
});

describe('resolveThinkingLevel', () => {
  it('normalizes requested thinking into a concrete effort', () => {
    expect(
      resolveThinkingLevel('on', {
        defaultThinking: false,
        thinking: { effort: 'medium', mode: 'auto' },
      }),
    ).toBe('medium');
    expect(
      resolveThinkingLevel('off', {
        defaultThinking: false,
        thinking: { effort: 'medium', mode: 'auto' },
      }),
    ).toBe('off');
    expect(
      resolveThinkingLevel('low', {
        defaultThinking: false,
        thinking: { effort: 'medium', mode: 'auto' },
      }),
    ).toBe('low');
    expect(
      resolveThinkingLevel(undefined, {
        defaultThinking: false,
        thinking: { effort: 'medium', mode: 'auto' },
      }),
    ).toBe('off');
    expect(
      resolveThinkingLevel('', {
        defaultThinking: false,
        thinking: { effort: 'medium', mode: 'auto' },
      }),
    ).toBe('off');
    expect(
      resolveThinkingLevel('   ', {
        defaultThinking: false,
        thinking: { effort: 'medium', mode: 'auto' },
      }),
    ).toBe('off');

    expect(
      resolveThinkingLevel(undefined, {
        defaultThinking: true,
        thinking: { effort: 'medium', mode: 'auto' },
      }),
    ).toBe('medium');
    expect(
      resolveThinkingLevel('   ', {
        defaultThinking: true,
        thinking: { effort: 'medium', mode: 'auto' },
      }),
    ).toBe('medium');

    expect(
      resolveThinkingLevel('on', {
        defaultThinking: true,
        thinking: { mode: 'auto' },
      }),
    ).toBe('high');
    expect(
      resolveThinkingLevel(undefined, {
        defaultThinking: true,
        thinking: { mode: 'auto' },
      }),
    ).toBe('high');

    expect(
      resolveThinkingLevel(undefined, {
        thinking: { mode: 'off' },
      }),
    ).toBe('off');

    expect(
      resolveThinkingLevel(undefined, {
        defaultThinking: true,
        thinking: { effort: 'medium', mode: 'off' },
      }),
    ).toBe('off');
    expect(
      resolveThinkingLevel('   ', {
        defaultThinking: true,
        thinking: { effort: 'medium', mode: 'off' },
      }),
    ).toBe('off');

    expect(resolveThinkingLevel(undefined, {})).toBe('high');
  });

  it('uses model-declared effort defaults when thinking is enabled generically', () => {
    const model = {
      supportEfforts: ['low', 'medium'],
      defaultEffort: 'low',
    };

    expect(
      resolveThinkingLevel('on', {
        defaultThinking: true,
        thinking: { mode: 'auto' },
        model,
      }),
    ).toBe('low');
    expect(
      resolveThinkingLevel(undefined, {
        defaultThinking: true,
        thinking: { mode: 'auto' },
        model,
      }),
    ).toBe('low');
  });
});
