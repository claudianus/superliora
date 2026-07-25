import { describe, expect, it, beforeEach } from 'vitest';

import { sharedCredentialHealthStore } from '@superliora/oauth';

import { ProviderManager } from '../../src/session/provider-manager';
import type { LioraConfig } from '../../src/config';

function baseConfig(): LioraConfig {
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

  it('filters out auth-rejected credentials from route candidates', () => {
    sharedCredentialHealthStore.markAuthRejected('xai-grok', {
      failureReason: 'rejected',
    });

    const manager = new ProviderManager({
      config: () => baseConfig(),
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

  it('expands same-capability candidates from other logged-in providers', () => {
    const manager = new ProviderManager({
      config: () => baseConfig(),
    });
    const route = manager.resolveProviderRoute('grok-main');
    expect(route).toBeDefined();
    expect(route!.candidates.length).toBeGreaterThanOrEqual(2);
    const providers = new Set(route!.candidates.map((c) => c.providerName));
    expect(providers.has('xai-grok')).toBe(true);
    expect(providers.has('openai')).toBe(true);
  });
});
