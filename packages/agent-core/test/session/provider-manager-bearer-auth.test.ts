import { describe, expect, it } from 'vitest';

import { ProviderManager } from '../../src/session/provider/provider-manager';

function bearerAuthConfig(providerId: 'glm-zcode' | 'gitlab-duo' | 'anthropic-oauth') {
  const baseUrls: Record<string, string> = {
    'glm-zcode': 'https://api.z.ai/api/anthropic',
    'gitlab-duo': 'https://cloud.gitlab.com/ai/v1/proxy/anthropic',
    'anthropic-oauth': 'https://api.anthropic.com',
  };
  return {
    defaultModel: `${providerId}/default-model`,
    providers: {
      [providerId]: {
        type: 'anthropic' as const,
        baseUrl: baseUrls[providerId],
        oauth: { storage: 'file' as const, key: providerId },
      },
    },
    models: {
      [`${providerId}/default-model`]: {
        provider: providerId,
        model: 'default-model',
        maxContextSize: 200000,
      },
    },
  };
}

describe('ProviderManager bearer-style OAuth auth (anthropic wire)', () => {
  it('injects Authorization Bearer for the glm-zcode profile', async () => {
    const manager = new ProviderManager({
      config: bearerAuthConfig('glm-zcode'),
      resolveOAuthTokenProvider: () => ({
        async getAccessToken() {
          return 'key-1.secret-1';
        },
      }),
    });

    const resolveAuth = manager.resolveAuth('glm-zcode/default-model');
    expect(resolveAuth).toBeDefined();

    await resolveAuth!(async (auth) => {
      expect(auth.apiKey).toBe('key-1.secret-1');
      expect(auth.headers?.['Authorization']).toBe('Bearer key-1.secret-1');
      return 'ok';
    });
  });

  it('injects Authorization Bearer for the gitlab-duo profile', async () => {
    const manager = new ProviderManager({
      config: bearerAuthConfig('gitlab-duo'),
      resolveOAuthTokenProvider: () => ({
        async getAccessToken() {
          return 'gl-token';
        },
      }),
    });

    const resolveAuth = manager.resolveAuth('gitlab-duo/default-model');
    await resolveAuth!(async (auth) => {
      expect(auth.headers?.['Authorization']).toBe('Bearer gl-token');
      return 'ok';
    });
  });

  it('leaves the x-api-key style untouched for non-bearer anthropic profiles', async () => {
    const manager = new ProviderManager({
      config: bearerAuthConfig('anthropic-oauth'),
      resolveOAuthTokenProvider: () => ({
        async getAccessToken() {
          return 'sk-ant-oat-token';
        },
      }),
    });

    const resolveAuth = manager.resolveAuth('anthropic-oauth/default-model');
    await resolveAuth!(async (auth) => {
      expect(auth.apiKey).toBe('sk-ant-oat-token');
      expect(auth.headers).toBeUndefined();
      return 'ok';
    });
  });
});
