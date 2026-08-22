import { afterEach, describe, expect, it, vi } from 'vitest';
import { APIStatusError } from '@superliora/kosong';
import { resetGitHubCopilotSessionCache } from '@superliora/oauth';

import { ProviderManager } from '../../src/session/provider/provider-manager';
import { ErrorCodes } from '../../src/errors';

afterEach(() => {
  resetGitHubCopilotSessionCache();
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function copilotConfig(apiKey?: string) {
  return {
    defaultModel: 'github-copilot/gpt-4.1',
    providers: {
      'github-copilot': {
        type: 'openai' as const,
        baseUrl: 'https://api.githubcopilot.com',
        ...(apiKey === undefined ? {} : { apiKey }),
        oauth:
          apiKey === undefined
            ? { storage: 'file' as const, key: 'github-copilot' }
            : undefined,
        customHeaders: {
          'Editor-Version': 'SuperLiora/1.0.0',
          'Copilot-Integration-Id': 'vscode-chat',
        },
      },
    },
    models: {
      'github-copilot/gpt-4.1': {
        provider: 'github-copilot',
        model: 'gpt-4.1',
        maxContextSize: 128000,
      },
    },
  };
}

describe('ProviderManager GitHub Copilot auth', () => {
  it('exchanges a stored user token and retries once on 401', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          token: 'tid=one',
          expires_at: 2_000_000_000,
          endpoints: { api: 'https://copilot.example.test' },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          token: 'tid=two',
          expires_at: 2_000_000_000,
          endpoints: { api: 'https://copilot.example.test' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const manager = new ProviderManager({
      config: copilotConfig(),
      resolveOAuthTokenProvider: () => ({
        async getAccessToken() {
          return 'ghu_user';
        },
      }),
    });

    const resolveAuth = manager.resolveAuth('github-copilot/gpt-4.1');
    expect(resolveAuth).toBeDefined();

    let calls = 0;
    const result = await resolveAuth!(async (auth) => {
      calls += 1;
      if (calls === 1) {
        expect(auth.apiKey).toBe('tid=one');
        expect(auth.baseUrl).toBe('https://copilot.example.test');
        expect(auth.headers?.['Copilot-Integration-Id']).toBe('vscode-chat');
        throw new APIStatusError(401, 'expired');
      }
      expect(auth.apiKey).toBe('tid=two');
      return 'ok';
    });

    expect(result).toBe('ok');
    expect(calls).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('exchanges a pasted apiKey without an OAuth ref', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        token: 'tid=from-key',
        expires_at: 2_000_000_000,
        endpoints: { api: 'https://copilot.example.test' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const manager = new ProviderManager({
      config: copilotConfig('ghu_pasted'),
    });

    const resolveAuth = manager.resolveAuth('github-copilot/gpt-4.1');
    expect(resolveAuth).toBeDefined();

    await resolveAuth!(async (auth) => {
      expect(auth.apiKey).toBe('tid=from-key');
      expect(auth.headers?.['Editor-Version']).toBe('SuperLiora/1.0.0');
      return 'ok';
    });
  });

  it('asks for login when no token is available', async () => {
    const manager = new ProviderManager({
      config: copilotConfig(),
    });
    const resolveAuth = manager.resolveAuth('github-copilot/gpt-4.1');
    await expect(resolveAuth!(async () => 'ok')).rejects.toMatchObject({
      code: ErrorCodes.AUTH_LOGIN_REQUIRED,
    });
  });
});
