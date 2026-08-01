import { describe, expect, it } from 'vitest';

import {
  cacheInvalidateEpochPatch,
  mergeConfigPatch,
  resolvePromptCacheKey,
  type LioraConfig,
} from '../../src/config';
import { ProviderManager } from '../../src/session/provider/provider-manager';

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
    },
  },
};

describe('resolvePromptCacheKey', () => {
  it('returns session id when invalidate epoch is unset or zero', () => {
    expect(resolvePromptCacheKey('sess-abc', { providers: {} })).toBe('sess-abc');
    expect(resolvePromptCacheKey('sess-abc', { providers: {}, cache: { invalidateEpoch: 0 } })).toBe(
      'sess-abc',
    );
  });

  it('appends :vN when invalidate epoch is positive', () => {
    expect(
      resolvePromptCacheKey('sess-abc', { providers: {}, cache: { invalidateEpoch: 1 } }),
    ).toBe('sess-abc:v1');
    expect(
      resolvePromptCacheKey('sess-abc', { providers: {}, cache: { invalidateEpoch: 3 } }),
    ).toBe('sess-abc:v3');
  });
});

describe('cacheInvalidateEpochPatch', () => {
  it('starts at 1 when epoch is missing', () => {
    expect(cacheInvalidateEpochPatch({})).toEqual({
      cache: { invalidateEpoch: 1 },
    });
  });

  it('increments the current epoch', () => {
    expect(cacheInvalidateEpochPatch({ cache: { invalidateEpoch: 2 } })).toEqual({
      cache: { invalidateEpoch: 3 },
    });
  });
});

describe('cache.invalidateEpoch config merge', () => {
  it('deep-merges epoch bumps into existing cache settings', () => {
    const merged = mergeConfigPatch(
      { providers: {}, cache: { invalidateEpoch: 1 } },
      { cache: { invalidateEpoch: 2 } },
    );
    expect(merged.cache?.invalidateEpoch).toBe(2);
  });
});

describe('ProviderManager dynamic promptCacheKey', () => {
  it('uses the latest key from a resolver on each provider resolve', () => {
    let epoch = 0;
    const manager = new ProviderManager({
      config: () => ({ ...BASE_CONFIG, cache: { invalidateEpoch: epoch } }),
      promptCacheKey: () => resolvePromptCacheKey('sess-abc', { ...BASE_CONFIG, cache: { invalidateEpoch: epoch } }),
    });

    const first = manager.resolveProviderConfig('kimi-code/kimi-for-coding');
    expect(first.provider.generationKwargs?.['prompt_cache_key']).toBe('sess-abc');

    epoch = 2;
    const second = manager.resolveProviderConfig('kimi-code/kimi-for-coding');
    expect(second.provider.generationKwargs?.['prompt_cache_key']).toBe('sess-abc:v2');
  });

  it('pins prompt_cache_key for OpenAI-compatible (xAI Grok) providers', () => {
    const config: LioraConfig = {
      defaultModel: 'xai-grok/grok-4.5',
      providers: {
        'xai-grok': {
          type: 'openai',
          apiKey: 'test-key',
          baseUrl: 'https://api.x.ai/v1',
        },
      },
      models: {
        'xai-grok/grok-4.5': {
          provider: 'xai-grok',
          model: 'grok-4.5',
          maxContextSize: 256_000,
        },
      },
    };
    const manager = new ProviderManager({
      config: () => config,
      promptCacheKey: () => resolvePromptCacheKey('sess-xai', config),
    });
    const resolved = manager.resolveProviderConfig('xai-grok/grok-4.5');
    expect(resolved.provider.type).toBe('openai');
    expect(resolved.provider.generationKwargs?.['prompt_cache_key']).toBe('sess-xai');
  });
});
