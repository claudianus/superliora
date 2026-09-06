import { describe, expect, it, beforeEach } from 'vitest';

import { sharedCredentialHealthStore } from '@superliora/oauth';

import { ProviderManager } from '../../src/session/provider/provider-manager';
import type { LioraConfig } from '../../src/config';

function baseConfig(routing?: { autoFallback?: boolean }): LioraConfig {
  return {
    providers: {
      'xai-grok': {
        type: 'openai',
        oauth: { storage: 'file', key: 'xai-a' },
        baseUrl: 'https://cli-chat-proxy.grok.com/v1',
      },
      openai: {
        type: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1',
      },
    },
    models: {
      'grok-main': {
        provider: 'xai-grok',
        model: 'grok-4.5',
        maxContextSize: 128_000,
        ...(routing === undefined ? {} : { routing }),
      },
      'gpt-fallback': {
        provider: 'openai',
        model: 'gpt-4.1',
        maxContextSize: 128_000,
      },
    },
  } as unknown as LioraConfig;
}

describe('ProviderManager route health + expansion', () => {
  beforeEach(() => {
    sharedCredentialHealthStore.clear();
  });

  it('does not auto-expand cross-provider candidates by default', () => {
    const manager = new ProviderManager({
      config: () => baseConfig(),
    });
    const route = manager.resolveProviderRoute('grok-main');
    // No fallback_models, no routing config: the primary alone must serve the
    // turn — silently swapping in models the user never chose is a cost and
    // quality hazard.
    expect(route).toBeUndefined();
  });

  it('honors an explicit fallback_models list without auto-expansion', () => {
    const config = baseConfig() as unknown as Record<string, unknown>;
    const models = config['models'] as Record<string, { fallbackModels?: string[] } | undefined>;
    const grokMain = models['grok-main'];
    expect(grokMain).toBeDefined();
    if (grokMain === undefined) throw new Error('grok-main missing from test config');
    grokMain.fallbackModels = ['gpt-fallback'];

    const manager = new ProviderManager({ config: () => config as unknown as LioraConfig });
    const route = manager.resolveProviderRoute('grok-main');
    expect(route).toBeDefined();
    expect(route!.candidates.map((c) => c.modelAlias)).toEqual(['grok-main', 'gpt-fallback']);
  });

  it('filters out auth-rejected credentials from route candidates', () => {
    sharedCredentialHealthStore.markAuthRejected('xai-grok', {
      failureReason: 'rejected',
    });

    const manager = new ProviderManager({
      config: () => baseConfig({ autoFallback: true }),
    });

    const route = manager.resolveProviderRoute('grok-main');
    expect(route).toBeDefined();
    expect(route!.candidates.length).toBeGreaterThan(0);
    for (const c of route!.candidates) {
      expect(c.providerName).not.toBe('xai-grok');
      expect(
        sharedCredentialHealthStore.isAvailable(c.providerName, c.credentialLabel),
      ).toBe(true);
    }
    expect(route!.candidates.some((c) => c.providerName === 'openai')).toBe(true);
  });

  it('returns no route when the primary credential is unhealthy and no fallback is configured', () => {
    sharedCredentialHealthStore.markAuthRejected('xai-grok', {
      failureReason: 'rejected',
    });

    const manager = new ProviderManager({
      config: () => baseConfig(),
    });

    const route = manager.resolveProviderRoute('grok-main');
    expect(route).toBeUndefined();
  });

  it('expands same-capability candidates from other logged-in providers on opt-in', () => {
    const manager = new ProviderManager({
      config: () => baseConfig({ autoFallback: true }),
    });
    const route = manager.resolveProviderRoute('grok-main');
    expect(route).toBeDefined();
    expect(route!.candidates.length).toBeGreaterThanOrEqual(2);
    const providers = new Set(route!.candidates.map((c) => c.providerName));
    expect(providers.has('xai-grok')).toBe(true);
    expect(providers.has('openai')).toBe(true);
  });
});
