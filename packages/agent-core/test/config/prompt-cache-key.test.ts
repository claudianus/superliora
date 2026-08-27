import { describe, expect, it } from 'vitest';

import {
  cacheInvalidateEpochPatch,
  mergeConfigPatch,
  pinPromptCacheKeyToAgent,
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
    expect(promptCacheKeyOf(first.provider)).toBe('sess-abc');

    epoch = 2;
    const second = manager.resolveProviderConfig('kimi-code/kimi-for-coding');
    expect(promptCacheKeyOf(second.provider)).toBe('sess-abc:v2');
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
    expect(promptCacheKeyOf(resolved.provider)).toBe('sess-xai');
  });
});

describe('pinPromptCacheKeyToAgent', () => {
  it('keeps the session key for main', () => {
    expect(pinPromptCacheKeyToAgent('sess-abc', 'main')).toBe('sess-abc');
    expect(pinPromptCacheKeyToAgent('sess-abc:v2', 'main')).toBe('sess-abc:v2');
    expect(pinPromptCacheKeyToAgent('sess-abc', '  ')).toBe('sess-abc');
  });

  it('appends the worker agent id before an invalidate epoch', () => {
    expect(pinPromptCacheKeyToAgent('sess-abc', 'agent-0')).toBe('sess-abc:agent-0');
    expect(pinPromptCacheKeyToAgent('sess-abc:v2', 'agent-0')).toBe('sess-abc:agent-0:v2');
    expect(pinPromptCacheKeyToAgent('sess-abc:v10', 'agent-3')).toBe('sess-abc:agent-3:v10');
  });
});

describe('ProviderManager.forAgent', () => {
  it('returns the same manager for main and pins Job workers to their agent id', () => {
    const manager = new ProviderManager({
      config: BASE_CONFIG,
      promptCacheKey: () => resolvePromptCacheKey('sess-abc', BASE_CONFIG),
    });
    expect(manager.forAgent('main')).toBe(manager);
    expect(
      promptCacheKeyOf(
        manager.forAgent('main').resolveProviderConfig('kimi-code/kimi-for-coding').provider,
      ),
    ).toBe('sess-abc');

    const worker = manager.forAgent('agent-0');
    expect(worker).not.toBe(manager);
    expect(
      promptCacheKeyOf(worker.resolveProviderConfig('kimi-code/kimi-for-coding').provider),
    ).toBe('sess-abc:agent-0');
    expect(
      promptCacheKeyOf(
        manager.forAgent('agent-1').resolveProviderConfig('kimi-code/kimi-for-coding').provider,
      ),
    ).toBe('sess-abc:agent-1');
  });

  it('keeps Settings cache invalidate on the pinned worker key', () => {
    let epoch = 2;
    const manager = new ProviderManager({
      config: () => ({ ...BASE_CONFIG, cache: { invalidateEpoch: epoch } }),
      promptCacheKey: () =>
        resolvePromptCacheKey('sess-abc', { ...BASE_CONFIG, cache: { invalidateEpoch: epoch } }),
    });
    const worker = manager.forAgent('agent-0');
    expect(
      promptCacheKeyOf(worker.resolveProviderConfig('kimi-code/kimi-for-coding').provider),
    ).toBe('sess-abc:agent-0:v2');

    epoch = 3;
    expect(
      promptCacheKeyOf(worker.resolveProviderConfig('kimi-code/kimi-for-coding').provider),
    ).toBe('sess-abc:agent-0:v3');
  });

  it('leaves generationKwargs unset when the session has no cache key', () => {
    const manager = new ProviderManager({ config: BASE_CONFIG });
    expect(
      promptCacheKeyOf(
        manager.forAgent('agent-0').resolveProviderConfig('kimi-code/kimi-for-coding').provider,
      ),
    ).toBeUndefined();
  });
});

/** Kosong `ProviderConfig` is a union; only some members carry generationKwargs. */
function promptCacheKeyOf(provider: object): unknown {
  const kwargs = (provider as { generationKwargs?: { prompt_cache_key?: unknown } })
    .generationKwargs;
  return kwargs?.prompt_cache_key;
}
