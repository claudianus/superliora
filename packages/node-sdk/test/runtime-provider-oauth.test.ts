import { describe, expect, it, vi } from 'vitest';

import { ErrorCodes, LioraError, type LioraConfig, type Logger } from '#/index';

import { ProviderManager } from '../../agent-core/src/session/provider-manager';

function managedConfig(): LioraConfig {
  return {
    providers: {
      'managed:kimi-code': {
        type: 'kimi',
        baseUrl: 'https://api.kimi.com/coding/v1',
        apiKey: '',
        oauth: { storage: 'file', key: 'oauth/kimi-code' },
      },
    },
    models: {
      'kimi-code/kimi-for-coding': {
        provider: 'managed:kimi-code',
        model: 'kimi-for-coding',
        maxContextSize: 262144,
      },
    },
    defaultModel: 'kimi-code/kimi-for-coding',
  };
}

async function resolveRuntimeProviderWithOAuth(options: {
  readonly config: LioraConfig;
  readonly resolveOAuthTokenProvider?: import('../../agent-core/src/session/provider-manager').OAuthTokenProviderResolver;
  readonly log?: Logger;
}) {
  const manager = new ProviderManager({
    config: options.config,
    resolveOAuthTokenProvider: options.resolveOAuthTokenProvider,
  });
  const model = options.config.defaultModel;
  if (model === undefined) {
    throw new LioraError(ErrorCodes.CONFIG_INVALID, 'No model is selected.');
  }
  const { providerName, provider } = manager.resolveProviderConfig(model);

  const providerConfig = options.config.providers[providerName];
  if (providerConfig?.oauth !== undefined && (providerConfig.apiKey ?? '').length > 0) {
    return {
      providerName,
      provider,
      resolveAuth: undefined,
    };
  }

  const oauthRef = providerConfig?.oauth;
  const tokenProvider = options.resolveOAuthTokenProvider?.(providerName, oauthRef);

  if (tokenProvider === undefined) {
    throw new LioraError(
      ErrorCodes.AUTH_LOGIN_REQUIRED,
      `OAuth provider "${providerName}" requires login before it can be used.`,
    );
  }

  // Replicate the old API's eager token fetch during resolution so
  // test mocks see the expected call sequence.
  try {
    await tokenProvider.getAccessToken(undefined);
  } catch (error) {
    if (
      !(error instanceof LioraError && error.code === ErrorCodes.AUTH_LOGIN_REQUIRED)
    ) {
      options.log?.warn('oauth token fetch failed', { providerName, error });
    }
    throw new LioraError(
      ErrorCodes.AUTH_LOGIN_REQUIRED,
      `OAuth provider "${providerName}" requires login before it can be used.`,
      { cause: error },
    );
  }

  return {
    providerName,
    provider,
    resolveAuth: async (opts?: { forceRefresh?: boolean }) => {
      try {
        const apiKey = await tokenProvider.getAccessToken(
          opts?.forceRefresh ? { force: true } : undefined,
        );
        if (apiKey.trim().length === 0) {
          throw new LioraError(
            ErrorCodes.AUTH_LOGIN_REQUIRED,
            `OAuth provider "${providerName}" requires login before it can be used.`,
          );
        }
        return { apiKey };
      } catch (error) {
        if (
          !(error instanceof LioraError && error.code === ErrorCodes.AUTH_LOGIN_REQUIRED)
        ) {
          options.log?.warn('oauth token fetch failed', { providerName, error });
        }
        throw new LioraError(
          ErrorCodes.AUTH_LOGIN_REQUIRED,
          `OAuth provider "${providerName}" requires login before it can be used.`,
          { cause: error },
        );
      }
    },
  };
}

describe('resolveRuntimeProviderWithOAuth', () => {
  it('returns request-scoped OAuth auth without storing the initial access token in provider config', async () => {
    const tokens = ['initial-oauth-token', 'rotated-oauth-token', 'force-refreshed-oauth-token'];
    const getAccessToken = vi.fn().mockImplementation(async () => {
      const token = tokens.shift();
      if (token === undefined) throw new Error('unexpected token request');
      return token;
    });

    const resolved = await resolveRuntimeProviderWithOAuth({
      config: managedConfig(),
      resolveOAuthTokenProvider: (_providerName, oauthRef) => {
        expect(oauthRef).toEqual({ storage: 'file', key: 'oauth/kimi-code' });
        return { getAccessToken };
      },
    });

    expect(resolved.providerName).toBe('managed:kimi-code');
    expect(resolved.provider).toMatchObject({
      type: 'kimi',
      model: 'kimi-for-coding',
      baseUrl: 'https://api.kimi.com/coding/v1',
    });
    expect(resolved.provider.apiKey).toBeUndefined();
    await expect(resolved.resolveAuth?.()).resolves.toEqual({ apiKey: 'rotated-oauth-token' });
    await expect(resolved.resolveAuth?.({ forceRefresh: true })).resolves.toEqual({
      apiKey: 'force-refreshed-oauth-token',
    });
    expect(getAccessToken.mock.calls).toEqual([[undefined], [undefined], [{ force: true }]]);
  });

  it('throws a clear login-required error when no token provider exists', async () => {
    await expect(
      resolveRuntimeProviderWithOAuth({
        config: managedConfig(),
      }),
    ).rejects.toThrow(/requires login/);
  });

  it('prefers explicit static apiKey over configured OAuth credentials', async () => {
    const getAccessToken = vi.fn().mockResolvedValue('unused');
    const conflicting: LioraConfig = {
      ...managedConfig(),
      providers: {
        'managed:kimi-code': {
          type: 'kimi',
          baseUrl: 'https://api.kimi.com/coding/v1',
          apiKey: 'static-key',
          oauth: { storage: 'file', key: 'oauth/kimi-code' },
        },
      },
    };

    const resolved = await resolveRuntimeProviderWithOAuth({
      config: conflicting,
      resolveOAuthTokenProvider: () => ({ getAccessToken }),
    });

    expect(resolved.provider).toMatchObject({ apiKey: 'static-key' });
    expect(resolved.resolveAuth).toBeUndefined();
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  it('wraps token provider failures as login-required errors', async () => {
    await expect(
      resolveRuntimeProviderWithOAuth({
        config: managedConfig(),
        resolveOAuthTokenProvider: () => ({
          getAccessToken: vi.fn().mockRejectedValue(new Error('missing token')),
        }),
      }),
    ).rejects.toMatchObject({
      name: 'LioraError',
      code: 'auth.login_required',
    });
  });

  it('logs token provider failures except plain login-required errors', async () => {
    const log = testLogger();
    await expect(
      resolveRuntimeProviderWithOAuth({
        config: managedConfig(),
        log,
        resolveOAuthTokenProvider: () => ({
          getAccessToken: vi.fn().mockRejectedValue(new Error('token endpoint down')),
        }),
      }),
    ).rejects.toMatchObject({ code: 'auth.login_required' });
    expect(log.warn).toHaveBeenCalledWith(
      'oauth token fetch failed',
      expect.objectContaining({
        providerName: 'managed:kimi-code',
        error: expect.any(Error),
      }),
    );

    vi.clearAllMocks();
    await expect(
      resolveRuntimeProviderWithOAuth({
        config: managedConfig(),
        log,
        resolveOAuthTokenProvider: () => ({
          getAccessToken: vi.fn().mockRejectedValue(
            new LioraError(ErrorCodes.AUTH_LOGIN_REQUIRED, 'not logged in'),
          ),
        }),
      }),
    ).rejects.toMatchObject({ code: 'auth.login_required' });
    expect(log.warn).not.toHaveBeenCalled();
  });
});

function testLogger(): Logger {
  const logger: Logger = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    createChild: () => logger,
  };
  return logger;
}
