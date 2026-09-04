import { describe, expect, it } from 'vitest';

import {
  API_KEY_PROVIDERS,
  defaultBaseUrlForProvider,
  describeMissingApiKey,
  getApiKeyProvider,
  isApiKeyProviderId,
  resolveApiKeyFromEnv,
} from '../src/registry/api-key-providers';

describe('api-key-providers registry', () => {
  it('covers the Cline/Hermes provider surface (no missing mainstream provider)', () => {
    const ids = new Set(API_KEY_PROVIDERS.map((def) => def.id));
    for (const expected of [
      'openai',
      'anthropic',
      'google',
      'openrouter',
      'deepseek',
      'groq',
      'mistral',
      'togetherai',
      'cerebras',
      'perplexity',
      'xai',
      'deepinfra',
      'ollama',
      'lm-studio',
    ]) {
      expect(ids.has(expected), `missing provider ${expected}`).toBe(true);
    }
  });

  it('resolves common aliases case-insensitively', () => {
    expect(getApiKeyProvider('gemini')?.id).toBe('google');
    expect(getApiKeyProvider('GEMINI')?.id).toBe('google');
    expect(getApiKeyProvider('together')?.id).toBe('togetherai');
    expect(getApiKeyProvider('lmstudio')?.id).toBe('lm-studio');
    expect(getApiKeyProvider('claude')?.id).toBe('anthropic');
    expect(isApiKeyProviderId('OpenRouter')).toBe(true);
    expect(isApiKeyProviderId('no-such-provider')).toBe(false);
  });

  it('resolves the first non-empty env value', () => {
    const def = getApiKeyProvider('google');
    expect(def).toBeDefined();
    if (def === undefined) return;
    expect(resolveApiKeyFromEnv(def, { GEMINI_API_KEY: '  ', GOOGLE_API_KEY: 'key-1' })).toBe(
      'key-1',
    );
    expect(resolveApiKeyFromEnv(def, {})).toBeUndefined();
  });

  it('exposes default base URLs for catalog entries that omit `api`', () => {
    expect(defaultBaseUrlForProvider('deepseek')).toBe('https://api.deepseek.com/v1');
    expect(defaultBaseUrlForProvider('openrouter')).toBe('https://openrouter.ai/api/v1');
    expect(defaultBaseUrlForProvider('ollama')).toBe('http://localhost:11434/v1');
    expect(defaultBaseUrlForProvider('unknown-provider')).toBeUndefined();
  });

  it('describes missing credentials with env vars and a doc URL', () => {
    const def = getApiKeyProvider('openrouter');
    expect(def).toBeDefined();
    if (def === undefined) return;
    const message = describeMissingApiKey(def);
    expect(message).toContain('OPENROUTER_API_KEY');
    expect(message).toContain(def.docUrl);
  });

  it('marks local providers as key-optional', () => {
    expect(getApiKeyProvider('ollama')?.local).toBe(true);
    expect(getApiKeyProvider('openai')?.local).toBeUndefined();
  });
});
