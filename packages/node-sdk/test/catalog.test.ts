import type { LioraConfig } from '@superliora/agent-core';
import { describe, expect, it, vi } from 'vitest';

import {
  applyCatalogProvider,
  catalogModelToAlias,
  catalogProviderModels,
  CatalogFetchError,
  fetchCatalog,
  type CatalogModel,
} from '../src/catalog';

function catalogResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const model: CatalogModel = {
  id: 'm1',
  name: 'M1',
  maxOutputSize: 64000,
  capability: {
    image_in: true,
    video_in: false,
    audio_in: false,
    thinking: true,
    tool_use: true,
    max_context_tokens: 200000,
  },
};

describe('fetchCatalog', () => {
  it('fetches and returns the catalog map', async () => {
    const catalog = { anthropic: { id: 'anthropic', models: { x: { id: 'x', limit: { context: 1000 } } } } };
    const fetchMock = vi.fn(async () => catalogResponse(catalog));
    const result = await fetchCatalog('https://x/api.json', undefined, fetchMock as unknown as typeof fetch);
    expect(result).toEqual(catalog);
  });

  it('throws CatalogFetchError on HTTP error', async () => {
    const fetchMock = vi.fn(async () => catalogResponse('no', 500));
    await expect(
      fetchCatalog('https://x', undefined, fetchMock as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(CatalogFetchError);
  });

  it('throws on a non-object payload', async () => {
    const fetchMock = vi.fn(async () => catalogResponse([1, 2]));
    await expect(
      fetchCatalog('https://x', undefined, fetchMock as unknown as typeof fetch),
    ).rejects.toThrow(/Unexpected catalog response/);
  });
});

describe('catalogModelToAlias', () => {
  it('flattens a catalog model capability into alias fields', () => {
    expect(catalogModelToAlias('anthropic', model)).toEqual({
      provider: 'anthropic',
      model: 'm1',
      maxContextSize: 200000,
      maxOutputSize: 64000,
      capabilities: ['image_in', 'thinking', 'tool_use'],
      displayName: 'M1',
    });
  });

  it('caps Grok catalog windows at the xAI 200k price band', () => {
    expect(
      catalogModelToAlias('xai', {
        ...model,
        id: 'grok-4.6',
        name: 'Grok 4.6',
        capability: { ...model.capability, max_context_tokens: 500000 },
      }),
    ).toMatchObject({
      provider: 'xai',
      model: 'grok-4.6',
      maxContextSize: 200000,
    });
  });

  it('caps Gemini Pro and GPT-5.4 catalog windows at their price bands', () => {
    expect(
      catalogModelToAlias('google', {
        ...model,
        id: 'gemini-3.1-pro',
        name: 'Gemini 3.1 Pro',
        capability: { ...model.capability, max_context_tokens: 1_000_000 },
      }),
    ).toMatchObject({
      provider: 'google',
      model: 'gemini-3.1-pro',
      maxContextSize: 200_000,
    });
    expect(
      catalogModelToAlias('openai', {
        ...model,
        id: 'gpt-5.4',
        name: 'GPT-5.4',
        capability: { ...model.capability, max_context_tokens: 1_050_000 },
      }),
    ).toMatchObject({
      provider: 'openai',
      model: 'gpt-5.4',
      maxContextSize: 272_000,
    });
    expect(
      catalogModelToAlias('alibaba', {
        ...model,
        id: 'qwen3.7-plus',
        name: 'Qwen 3.7 Plus',
        capability: { ...model.capability, max_context_tokens: 1_000_000 },
      }),
    ).toMatchObject({
      provider: 'alibaba',
      model: 'qwen3.7-plus',
      maxContextSize: 256_000,
    });
    expect(
      catalogModelToAlias('minimax', {
        ...model,
        id: 'MiniMax-M3',
        name: 'MiniMax M3',
        capability: { ...model.capability, max_context_tokens: 1_000_000 },
      }),
    ).toMatchObject({
      provider: 'minimax',
      model: 'MiniMax-M3',
      maxContextSize: 512_000,
    });
    expect(
      catalogModelToAlias('sakana', {
        ...model,
        id: 'fugu-ultra-v1.1',
        name: 'Fugu Ultra',
        capability: { ...model.capability, max_context_tokens: 1_000_000 },
      }),
    ).toMatchObject({
      provider: 'sakana',
      model: 'fugu-ultra-v1.1',
      maxContextSize: 272_000,
    });
    expect(
      catalogModelToAlias('openrouter', {
        ...model,
        id: 'acme-1m',
        name: 'Acme 1M',
        capability: { ...model.capability, max_context_tokens: 1_000_000 },
        cost: {
          input: 1,
          output: 2,
          tiers: [{ input: 2, output: 4, tier: { type: 'context', size: 200_000 } }],
        },
      }),
    ).toMatchObject({
      model: 'acme-1m',
      maxContextSize: 200_000,
    });
  });

  it('carries catalog effort values through to the model alias', () => {
    expect(
      catalogModelToAlias('openai', {
        ...model,
        supportEfforts: ['low', 'high', 'max'],
        alwaysThinking: true,
      }),
    ).toMatchObject({
      supportEfforts: ['low', 'high', 'max'],
      capabilities: ['image_in', 'thinking', 'tool_use', 'always_thinking'],
    });
  });
});

describe('applyCatalogProvider', () => {
  it('writes provider, model aliases, and defaults', () => {
    const config = { providers: {} } as LioraConfig;
    const result = applyCatalogProvider(config, {
      providerId: 'anthropic',
      wire: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'sk',
      models: [model],
      selectedModelId: 'm1',
      thinking: true,
    });

    expect(result.defaultModel).toBe('anthropic/m1');
    expect(config.providers['anthropic']).toMatchObject({ type: 'anthropic', apiKey: 'sk' });
    expect(config.models?.['anthropic/m1']).toMatchObject({
      provider: 'anthropic',
      model: 'm1',
      maxContextSize: 200000,
    });
    expect(config.defaultModel).toBe('anthropic/m1');
    expect(config.defaultThinking).toBe(true);
  });

  it('writes interleaved reasoning key from a catalog-selected model alias', () => {
    const models = catalogProviderModels({
      id: 'deepseek',
      models: {
        'deepseek-v4-pro': {
          id: 'deepseek-v4-pro',
          name: 'DeepSeek V4 Pro',
          family: 'deepseek-thinking',
          limit: { context: 1000000, output: 384000 },
          reasoning: true,
          tool_call: true,
          interleaved: { field: 'reasoning_content' },
        },
      },
    });
    const config = { providers: {} } as LioraConfig;

    applyCatalogProvider(config, {
      providerId: 'deepseek',
      wire: 'openai',
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'sk',
      models,
      selectedModelId: 'deepseek-v4-pro',
      thinking: true,
    });

    expect(config.models?.['deepseek/deepseek-v4-pro']).toMatchObject({
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
      reasoningKey: 'reasoning_content',
    });
  });

  it('clears stale aliases for the same provider but keeps others', () => {
    const config = {
      providers: { anthropic: { type: 'anthropic', apiKey: 'old' } },
      models: {
        'anthropic/stale': { provider: 'anthropic', model: 'stale', maxContextSize: 1 },
        'other/keep': { provider: 'other', model: 'keep', maxContextSize: 1 },
      },
    } as unknown as LioraConfig;

    applyCatalogProvider(config, {
      providerId: 'anthropic',
      wire: 'anthropic',
      apiKey: 'new',
      models: [model],
      selectedModelId: 'm1',
      thinking: false,
    });

    expect(config.models?.['anthropic/stale']).toBeUndefined();
    expect(config.models?.['other/keep']).toBeDefined();
  });
});
