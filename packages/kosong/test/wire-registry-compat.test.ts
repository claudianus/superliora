import { describe, expect, it } from 'vitest';

import { catalogBaseUrl, inferWireType } from '../src/catalog';
import { resolveWireFromPackage } from '../src/providers/wire-registry';

describe('wire-registry compat (chat-completions gateways)', () => {
  it('resolves per-model npm overrides for gateways whose package lacks the openai substring', () => {
    for (const npm of [
      '@ai-sdk/groq',
      '@ai-sdk/mistral',
      '@ai-sdk/togetherai',
      '@ai-sdk/xai',
      '@ai-sdk/cerebras',
      '@ai-sdk/perplexity',
      '@ai-sdk/gateway',
      '@ai-sdk/vercel',
      '@ai-sdk/deepseek',
      '@ai-sdk/deepinfra',
      '@openrouter/ai-sdk-provider',
      '@qvac/ai-sdk-provider',
      '@qvac/sdk',
      'venice-ai-sdk-provider',
      '@aihubmix/ai-sdk-provider',
      'merge-gateway-ai-sdk-provider',
    ]) {
      expect(resolveWireFromPackage(npm), npm).toBe('openai');
    }
  });

  it('matches case-insensitively and keeps native SDK wires intact', () => {
    expect(resolveWireFromPackage('@AI-SDK/GROQ')).toBe('openai');
    expect(resolveWireFromPackage('@ai-sdk/anthropic')).toBe('anthropic');
    expect(resolveWireFromPackage('@ai-sdk/openai')).toBe('openai_responses');
    expect(resolveWireFromPackage('@ai-sdk/openai-compatible')).toBe('openai');
    expect(resolveWireFromPackage(undefined)).toBeUndefined();
    expect(resolveWireFromPackage('@ai-sdk/cohere')).toBeUndefined();
  });
});

describe('catalog compat (deepseek + default endpoints)', () => {
  it('infers the openai wire for deepseek', () => {
    expect(inferWireType({ id: 'deepseek', npm: '@ai-sdk/deepseek' })).toBe('openai');
    expect(inferWireType({ id: 'deepseek' })).toBe('openai');
  });

  it('supplies default base URLs when the catalog omits `api`', () => {
    expect(catalogBaseUrl({ id: 'openai' }, 'openai')).toBe('https://api.openai.com/v1');
    expect(catalogBaseUrl({ id: 'openrouter' }, 'openai')).toBe(
      'https://openrouter.ai/api/v1',
    );
    expect(catalogBaseUrl({ id: 'deepseek' }, 'openai')).toBe('https://api.deepseek.com/v1');
    expect(catalogBaseUrl({ id: 'deepinfra' }, 'openai')).toBe(
      'https://api.deepinfra.com/v1/openai',
    );
  });
});
