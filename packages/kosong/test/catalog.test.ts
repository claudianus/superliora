import { describe, expect, it } from 'vitest';

import {
  catalogBaseUrl,
  catalogImportThinking,
  catalogModelToCapability,
  catalogProviderModels,
  catalogWireGroups,
  inferWireType,
  type CatalogModelEntry,
  type CatalogProviderEntry,
} from '../src/catalog';

describe('inferWireType', () => {
  it('honors an explicit valid type', () => {
    expect(inferWireType({ id: 'x', type: 'openai_responses' })).toBe('openai_responses');
  });

  it('infers anthropic from npm or id', () => {
    expect(inferWireType({ id: 'anthropic', npm: '@ai-sdk/anthropic' })).toBe('anthropic');
    expect(inferWireType({ id: 'my-claude' })).toBe('anthropic');
  });

  it('infers google-genai and vertexai', () => {
    expect(inferWireType({ id: 'gemini', npm: '@ai-sdk/google' })).toBe('google-genai');
    expect(inferWireType({ id: 'google-vertex' })).toBe('vertexai');
  });

  it('returns undefined for unknown / invalid wire types', () => {
    expect(inferWireType({ id: 'some-proxy' })).toBeUndefined();
    expect(inferWireType({ id: 'x', type: 'not-a-wire' })).toBeUndefined();
  });

  it('infers openai for github-copilot even without an npm package', () => {
    expect(inferWireType({ id: 'github-copilot' })).toBe('openai');
    expect(inferWireType({ id: 'github-copilot', npm: '@ai-sdk/openai-compatible' })).toBe('openai');
  });

  it('infers openai for Chat Completions gateways whose npm lacks the openai substring', () => {
    expect(inferWireType({ id: 'openrouter', npm: '@openrouter/ai-sdk-provider' })).toBe('openai');
    expect(inferWireType({ id: 'deepinfra', npm: '@ai-sdk/deepinfra' })).toBe('openai');
    expect(inferWireType({ id: 'qvac', npm: '@qvac/sdk' })).toBe('openai');
    expect(inferWireType({ id: 'groq', npm: '@ai-sdk/groq' })).toBe('openai');
    expect(inferWireType({ id: 'mistral', npm: '@ai-sdk/mistral' })).toBe('openai');
    expect(inferWireType({ id: 'togetherai', npm: '@ai-sdk/togetherai' })).toBe('openai');
    expect(inferWireType({ id: 'xai', npm: '@ai-sdk/xai' })).toBe('openai');
    expect(inferWireType({ id: 'cerebras', npm: '@ai-sdk/cerebras' })).toBe('openai');
    expect(inferWireType({ id: 'perplexity', npm: '@ai-sdk/perplexity' })).toBe('openai');
    expect(inferWireType({ id: 'vercel', npm: '@ai-sdk/gateway' })).toBe('openai');
    expect(inferWireType({ id: 'v0', npm: '@ai-sdk/vercel' })).toBe('openai');
    expect(inferWireType({ id: 'venice', npm: 'venice-ai-sdk-provider' })).toBe('openai');
    expect(inferWireType({ id: 'aihubmix', npm: '@aihubmix/ai-sdk-provider' })).toBe('openai');
    expect(inferWireType({ id: 'merge-gateway', npm: 'merge-gateway-ai-sdk-provider' })).toBe(
      'openai',
    );
  });

  it('does not treat native non-Chat-Completions SDKs as openai', () => {
    expect(inferWireType({ id: 'cohere', npm: '@ai-sdk/cohere' })).toBeUndefined();
    expect(inferWireType({ id: 'amazon-bedrock', npm: '@ai-sdk/amazon-bedrock' })).toBeUndefined();
    expect(inferWireType({ id: 'azure', npm: '@ai-sdk/azure' })).toBeUndefined();
  });
});

describe('catalogBaseUrl', () => {
  it('strips a trailing /v1 for anthropic so the official SDK does not double it', () => {
    expect(catalogBaseUrl({ id: 'k', api: 'https://api.kimi.com/coding/v1' }, 'anthropic')).toBe(
      'https://api.kimi.com/coding',
    );
    expect(catalogBaseUrl({ id: 'k', api: 'https://api.kimi.com/coding/v1/' }, 'anthropic')).toBe(
      'https://api.kimi.com/coding',
    );
  });

  it('leaves anthropic base URLs without a bare /v1 suffix untouched', () => {
    expect(catalogBaseUrl({ id: 'a', api: 'https://api.anthropic.com' }, 'anthropic')).toBe(
      'https://api.anthropic.com',
    );
    expect(catalogBaseUrl({ id: 'a', api: 'https://host/v1beta' }, 'anthropic')).toBe(
      'https://host/v1beta',
    );
  });

  it('passes openai-family base URLs through unchanged (SDK appends /chat/completions)', () => {
    expect(catalogBaseUrl({ id: 'o', api: 'https://api.openai.com/v1' }, 'openai')).toBe(
      'https://api.openai.com/v1',
    );
  });

  it('returns undefined for a missing or empty api', () => {
    expect(catalogBaseUrl({ id: 'x' }, 'anthropic')).toBeUndefined();
    expect(catalogBaseUrl({ id: 'x', api: '' }, 'openai')).toBeUndefined();
  });

  it('fills the official Chat Completions host when models.dev omits api', () => {
    expect(catalogBaseUrl({ id: 'groq', npm: '@ai-sdk/groq' }, 'openai')).toBe(
      'https://api.groq.com/openai/v1',
    );
    expect(catalogBaseUrl({ id: 'mistral', npm: '@ai-sdk/mistral' }, 'openai')).toBe(
      'https://api.mistral.ai/v1',
    );
    expect(catalogBaseUrl({ id: 'togetherai' }, 'openai')).toBe('https://api.together.xyz/v1');
    expect(catalogBaseUrl({ id: 'xai' }, 'openai')).toBe('https://api.x.ai/v1');
    expect(catalogBaseUrl({ id: 'cerebras' }, 'openai')).toBe('https://api.cerebras.ai/v1');
    expect(catalogBaseUrl({ id: 'perplexity' }, 'openai')).toBe('https://api.perplexity.ai');
    expect(catalogBaseUrl({ id: 'vercel' }, 'openai')).toBe('https://ai-gateway.vercel.sh/v1');
  });

  it('prefers the catalog api over the built-in Chat Completions host', () => {
    expect(
      catalogBaseUrl({ id: 'groq', api: 'https://example.test/groq/v1' }, 'openai'),
    ).toBe('https://example.test/groq/v1');
  });
});

describe('catalogModelToCapability', () => {
  it('maps modalities and limits into a ModelCapability', () => {
    expect(
      catalogModelToCapability({
        id: 'm',
        name: 'M',
        limit: { context: 200000, output: 64000 },
        tool_call: true,
        reasoning: true,
        modalities: { input: ['text', 'image'], output: ['text'] },
      }),
    ).toEqual({
      id: 'm',
      name: 'M',
      maxOutputSize: 64000,
      capability: {
        image_in: true,
        video_in: false,
        audio_in: false,
        thinking: true,
        tool_use: true,
        max_context_tokens: 200000,
      },
    });
  });

  it('preserves declared reasoning efforts and marks effort-only models always-on', () => {
    expect(
      catalogModelToCapability({
        id: 'gpt-5.4',
        limit: { context: 200000 },
        reasoning: true,
        reasoning_options: [
          { type: 'effort', values: ['low', 'medium', 'high', 'xhigh', 'max'] },
        ],
      }),
    ).toMatchObject({
      supportEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      alwaysThinking: true,
    });
  });

  it('treats an explicit off effort or toggle as the off path', () => {
    expect(
      catalogModelToCapability({
        id: 'gpt-5.4',
        limit: { context: 200000 },
        reasoning: true,
        reasoning_options: [
          { type: 'effort', values: ['none', 'low', 'medium', 'high', 'max'] },
        ],
      }),
    ).toMatchObject({
      supportEfforts: ['low', 'medium', 'high', 'max'],
    });
    expect(
      catalogModelToCapability({
        id: 'deepseek-v4',
        limit: { context: 200000 },
        reasoning: true,
        reasoning_options: [
          { type: 'toggle' },
          { type: 'effort', values: ['high', 'max'] },
        ],
      }),
    ).toMatchObject({
      supportEfforts: ['high', 'max'],
    });
    expect(
      catalogModelToCapability({
        id: 'budget-model',
        limit: { context: 200000 },
        reasoning: true,
        reasoning_options: [{ type: 'budget_tokens' }],
      }),
    ).toMatchObject({
      supportEfforts: [],
      alwaysThinking: true,
    });
  });

  it('defaults tool_use to true and skips models without a positive context', () => {
    expect(catalogModelToCapability({ id: 'm', limit: { context: 1000 } })?.capability.tool_use).toBe(
      true,
    );
    expect(catalogModelToCapability({ id: 'm' })).toBeUndefined();
    expect(catalogModelToCapability({ id: 'm', limit: { context: 0 } })).toBeUndefined();
  });

  it('skips embedding and non-text-output models that cannot serve as chat defaults', () => {
    expect(
      catalogModelToCapability({
        id: 'text-embedding-3-large',
        name: 'text-embedding-3-large',
        family: 'text-embedding',
        limit: { context: 8192, output: 1536 },
        modalities: { input: ['text'], output: ['text'] },
      }),
    ).toBeUndefined();
    expect(
      catalogModelToCapability({
        id: 'grok-imagine-image',
        name: 'Grok Imagine Image',
        family: 'grok',
        limit: { context: 8000 },
        modalities: { input: ['text', 'image'], output: ['image', 'pdf'] },
      }),
    ).toBeUndefined();
    expect(
      catalogModelToCapability({
        id: 'mimo-v2-tts',
        name: 'MiMo-V2-TTS',
        family: 'mimo',
        limit: { context: 8192, output: 16384 },
        modalities: { input: ['text'], output: ['audio'] },
      }),
    ).toBeUndefined();
  });

  it.each<[CatalogModelEntry['interleaved'], string | undefined]>([
    [undefined, undefined],
    [true, 'reasoning_content'],
    [false, undefined],
    [{}, undefined],
    [{ field: '' }, undefined],
    [{ field: 'reasoning_content' }, 'reasoning_content'],
    [{ field: 'reasoning_details' }, 'reasoning_details'],
    [{ field: '  reasoning_content  ' }, 'reasoning_content'],
  ])('derives reasoningKey from interleaved=%j → %j', (interleaved, expected) => {
    const model = catalogModelToCapability({ id: 'm', limit: { context: 1000 }, interleaved });
    expect(model?.reasoningKey).toBe(expected);
  });
});

describe('catalogWireGroups', () => {
  const entry: CatalogProviderEntry = {
    id: 'commandcode',
    api: 'https://api.commandcode.ai/provider/v1',
    type: 'openai',
    models: {
      'deepseek-v4-flash': { id: 'deepseek-v4-flash', limit: { context: 1_000_000 } },
      'claude-sonnet-5': {
        id: 'claude-sonnet-5',
        limit: { context: 1_000_000 },
        provider: { npm: '@ai-sdk/anthropic' },
      },
    },
  };

  it('partitions models by their per-model npm override', () => {
    const groups = catalogWireGroups(entry, { wire: 'openai' });
    expect(groups.map((group) => group.wire)).toEqual(['openai', 'anthropic']);
    expect(groups[0]!.models.map((model) => model.id)).toEqual(['deepseek-v4-flash']);
    expect(groups[1]!.models.map((model) => model.id)).toEqual(['claude-sonnet-5']);
  });

  it('adapts the API root per wire (strips /v1 for anthropic)', () => {
    const groups = catalogWireGroups(entry, { wire: 'openai' });
    expect(groups[0]!.baseUrl).toBe('https://api.commandcode.ai/provider/v1');
    expect(groups[1]!.baseUrl).toBe('https://api.commandcode.ai/provider');
  });

  it('falls back to the provider wire when a model names no package', () => {
    const groups = catalogWireGroups(
      {
        id: 'gw',
        type: 'openai',
        models: { m: { id: 'm', limit: { context: 1000 } } },
      },
      { wire: 'openai' },
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.wire).toBe('openai');
    expect(groups[0]!.baseUrl).toBeUndefined();
    expect(groups[0]!.models.map((model) => model.id)).toEqual(['m']);
  });
});

describe('catalogProviderModels', () => {
  it('extracts only valid models from a provider entry', () => {
    const models = catalogProviderModels({
      id: 'p',
      models: {
        good: { id: 'good', limit: { context: 1000 } },
        bad: { id: 'bad' },
      },
    });
    expect(models).toHaveLength(1);
    expect(models[0]?.id).toBe('good');
  });
});

describe('catalogImportThinking', () => {
  it('is off when no model is selected', () => {
    const models = catalogProviderModels({
      id: 'zen',
      models: {
        'x-preview-f-free': {
          id: 'x-preview-f-free',
          limit: { context: 200000 },
          reasoning: true,
          reasoning_options: [{ type: 'effort', values: ['low', 'high', 'max'] }],
        },
      },
    });
    expect(catalogImportThinking(models)).toBe(false);
    expect(catalogImportThinking(models, '')).toBe(false);
  });

  it('is on only for the selected always-thinking model', () => {
    const models = catalogProviderModels({
      id: 'zen',
      models: {
        'x-preview-f-free': {
          id: 'x-preview-f-free',
          limit: { context: 200000 },
          reasoning: true,
          reasoning_options: [{ type: 'effort', values: ['low', 'high', 'max'] }],
        },
        'plain': {
          id: 'plain',
          limit: { context: 128000 },
          reasoning: true,
        },
      },
    });
    expect(catalogImportThinking(models, 'x-preview-f-free')).toBe(true);
    expect(catalogImportThinking(models, 'plain')).toBe(false);
  });
});
