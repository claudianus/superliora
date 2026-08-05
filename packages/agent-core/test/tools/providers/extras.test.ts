import { describe, expect, it } from 'vitest';

import type { LioraConfig } from '../../../src/config/schema';
import {
  detectProviderExtras,
  getProviderExtrasDeclaration,
  resolveZaiSearchProviderConfig,
} from '../../../src/tools/providers/extras';

const EMPTY_ENV: NodeJS.ProcessEnv = {};

function configWith(
  providers: LioraConfig['providers'],
  extras?: LioraConfig['extras'],
): Pick<LioraConfig, 'providers' | 'extras'> {
  return extras === undefined ? { providers } : { providers, extras };
}

describe('detectProviderExtras', () => {
  it('returns nothing when no keys or providers are configured', () => {
    expect(detectProviderExtras(configWith({}), EMPTY_ENV)).toEqual([]);
  });

  it('detects Z.AI from the env key without any config entry', () => {
    const detected = detectProviderExtras(configWith({}), { Z_AI_API_KEY: 'zai-key' });
    expect(detected).toHaveLength(1);
    expect(detected[0]!.declaration.id).toBe('zai');
    expect(detected[0]!.apiKey).toBe('zai-key');
    expect(detected[0]!.apiKeyEnv).toBe('Z_AI_API_KEY');
    expect(detected[0]!.declaration.extras.webSearch).toBe(true);
    expect(detected[0]!.declaration.extras.mcpServers).toBe(true);
    expect(detected[0]!.declaration.extras.imageGen).toBe(false);
  });

  it('detects Z.AI from a configured provider entry and prefers the env key', () => {
    const detected = detectProviderExtras(
      configWith({
        'zai-coding-plan': { type: 'openai', baseUrl: 'https://api.z.ai/api/coding/paas/v4', apiKey: 'config-key' },
      }),
      { Z_AI_API_KEY: 'env-key' },
    );
    expect(detected[0]!.declaration.id).toBe('zai');
    expect(detected[0]!.apiKey).toBe('env-key');
    expect(detected[0]!.providerId).toBe('zai-coding-plan');
    expect(detected[0]!.baseUrl).toBe('https://api.z.ai/api/coding/paas/v4');
  });

  it('detects Qwen Token Plan from config apiKey', () => {
    const detected = detectProviderExtras(
      configWith({ 'qwen-token-plan': { type: 'openai', apiKey: 'sk-sp-x' } }),
      EMPTY_ENV,
    );
    expect(detected[0]!.declaration.id).toBe('qwen-token-plan');
    expect(detected[0]!.apiKey).toBe('sk-sp-x');
  });

  it('detects Codex only via an OAuth ref on the provider entry', () => {
    expect(detectProviderExtras(configWith({}), EMPTY_ENV).map((d) => d.declaration.id)).not.toContain(
      'openai-codex',
    );
    const detected = detectProviderExtras(
      configWith({
        'openai-codex': {
          type: 'openai_responses',
          oauth: { storage: 'file', key: 'openai-codex' },
        },
      }),
      EMPTY_ENV,
    );
    expect(detected[0]!.declaration.id).toBe('openai-codex');
    expect(detected[0]!.hasOAuth).toBe(true);
  });

  it('detects xAI Grok from XAI_API_KEY', () => {
    const detected = detectProviderExtras(configWith({}), { XAI_API_KEY: 'xai-key' });
    expect(detected.map((d) => d.declaration.id)).toContain('xai-grok');
  });

  it('ignores unrelated provider entries', () => {
    const detected = detectProviderExtras(
      configWith({ openrouter: { type: 'openai', apiKey: 'or-key' } }),
      EMPTY_ENV,
    );
    expect(detected).toEqual([]);
  });
});

describe('getProviderExtrasDeclaration', () => {
  it('resolves declarations by id', () => {
    expect(getProviderExtrasDeclaration('zai')?.envKeys).toContain('Z_AI_API_KEY');
    expect(getProviderExtrasDeclaration('openai-codex')?.extras.webSearch).toBe(true);
  });
});

describe('resolveZaiSearchProviderConfig', () => {
  it('builds a zai search slot from a config provider key', () => {
    const slot = resolveZaiSearchProviderConfig(
      configWith({
        'zai-coding-plan': { type: 'openai', baseUrl: 'https://api.z.ai/api/coding/paas/v4', apiKey: 'config-key' },
      }),
      EMPTY_ENV,
    );
    expect(slot?.kind).toBe('zai');
    expect(slot?.apiKey).toBe('config-key');
  });

  it('leaves env-sourced keys to the engine env detection', () => {
    const slot = resolveZaiSearchProviderConfig(configWith({}), { Z_AI_API_KEY: 'env-key' });
    expect(slot).toBeUndefined();
  });

  it('returns nothing when the service is switched off in Settings', () => {
    const slot = resolveZaiSearchProviderConfig(
      configWith(
        { 'zai-coding-plan': { type: 'openai', apiKey: 'config-key' } },
        { disabledProviders: ['zai'] },
      ),
      EMPTY_ENV,
    );
    expect(slot).toBeUndefined();
  });
});
