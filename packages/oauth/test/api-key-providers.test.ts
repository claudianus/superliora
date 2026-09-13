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

  it('covers the gajae-code parity providers absent from the models.dev catalog', () => {
    const expected: readonly (readonly [string, string])[] = [
      ['firepass', 'https://api.fireworks.ai/inference/v1'],
      ['fugu', 'https://api.sakana.ai/v1'],
      ['nanogpt', 'https://nano-gpt.com/api/v1'],
      ['mara', 'https://api.cloud.mara.com/v1'],
      ['opengateway', 'https://apis.opengateway.ai/v1'],
      ['bizrouter', 'https://api.bizrouter.ai/v1'],
      ['qianfan', 'https://qianfan.baidubce.com/v2'],
      ['sglang', 'http://127.0.0.1:30000/v1'],
    ];
    for (const [id, baseUrl] of expected) {
      const def = getApiKeyProvider(id);
      expect(def, `missing provider ${id}`).toBeDefined();
      expect(def?.defaultBaseUrl, `${id} base URL`).toBe(baseUrl);
      expect(def?.wire, `${id} wire`).toBe('openai');
      expect(def?.envVars.length, `${id} env vars`).toBeGreaterThan(0);
    }
    expect(getApiKeyProvider('sglang')?.local).toBe(true);
  });

  it('does not duplicate providers the models.dev catalog already carries', () => {
    // models.dev ships env hints + base URLs for these ids (or the curated
    // local overlay surfaces them); a registry entry here would conflict or
    // double-source the same credential. Keep the catalog authoritative.
    const coveredByCatalog = [
      'alibaba-token-plan',
      'xiaomi',
      'xiaomi-token-plan-sgp',
      'xiaomi-token-plan-ams',
      'xiaomi-token-plan-cn',
      'nvidia',
      'synthetic',
      'huggingface',
      'zenmux',
      'minimax-cn',
      'ollama-cloud',
      // Curated local overlay row (apps/liora local-catalog-providers).
      'commandcode',
    ];
    for (const id of coveredByCatalog) {
      expect(getApiKeyProvider(id), `${id} should stay catalog-only`).toBeUndefined();
      expect(isApiKeyProviderId(id)).toBe(false);
    }
  });

  it('resolves huggingface credentials from HF_TOKEN via the catalog, not the registry', () => {
    // HF_TOKEN belongs to the models.dev huggingface entry; the registry must
    // not shadow it with a second definition.
    expect(getApiKeyProvider('huggingface')).toBeUndefined();
  });
});
