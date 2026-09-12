import { afterEach, describe, expect, it, vi } from 'vitest';

import { OAuthProviderManager } from '../src/flow/oauth-provider-manager';
import {
  EXPERIMENTAL_PROVIDER_PROFILES,
  GITHUB_COPILOT_PROFILE,
  GITLAB_DUO_PROFILE,
  GLM_ZCODE_PROFILE,
  PROVIDER_PROFILES,
  XAI_PROFILE,
} from '../src/profiles';
import type { TokenInfo } from '../src/types';

type FetchMock = (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) => Promise<Response>;

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function memoryStorage(): {
  storage: {
    load: (name: string) => Promise<TokenInfo | undefined>;
    save: (name: string, token: TokenInfo) => Promise<void>;
    remove: (name: string) => Promise<void>;
    list: () => Promise<string[]>;
  };
  saved: Map<string, TokenInfo>;
} {
  const saved = new Map<string, TokenInfo>();
  return {
    saved,
    storage: {
      load: async (name) => saved.get(name),
      save: async (name, token) => {
        saved.set(name, token);
      },
      remove: async (name) => {
        saved.delete(name);
      },
      list: async () => [...saved.keys()],
    },
  };
}

describe('OAuth provider profiles (gajae-code parity)', () => {
  it('registers gitlab-duo as an always-on generic PKCE profile', () => {
    expect(PROVIDER_PROFILES.map((profile) => profile.id)).toContain('gitlab-duo');
    expect(GITLAB_DUO_PROFILE.flow.kind).toBe('pkce_browser');
    expect(GITLAB_DUO_PROFILE.flow.variant).toBe('generic');
    expect(GITLAB_DUO_PROFILE.flow.callbackPort).toBe(8080);
    expect(GITLAB_DUO_PROFILE.wire).toBe('anthropic');
    expect(GITLAB_DUO_PROFILE.wireAuth).toBe('bearer');
    expect(GITLAB_DUO_PROFILE.apiBaseUrl).toBe('https://cloud.gitlab.com/ai/v1/proxy/anthropic');
  });

  it('registers glm-zcode behind the glm_zcode_oauth flag with bearer auth', () => {
    expect(
      EXPERIMENTAL_PROVIDER_PROFILES.some(
        (entry) => entry.profile.id === 'glm-zcode' && entry.flag === 'glm_zcode_oauth',
      ),
    ).toBe(true);
    expect(GLM_ZCODE_PROFILE.flow.kind).toBe('code_paste');
    expect(GLM_ZCODE_PROFILE.wire).toBe('anthropic');
    expect(GLM_ZCODE_PROFILE.wireAuth).toBe('bearer');
    expect(GLM_ZCODE_PROFILE.apiBaseUrl).toBe('https://api.z.ai/api/anthropic');
  });

  it('keeps explicit variants on the pre-existing PKCE profiles', () => {
    expect(XAI_PROFILE.flow.variant).toBe('xai');
    // anthropic-oauth ships the generic variant (set in profiles/anthropic.ts).
    expect(
      EXPERIMENTAL_PROVIDER_PROFILES.find((entry) => entry.profile.id === 'anthropic-oauth')
        ?.profile.flow.variant,
    ).toBe('generic');
    // Non-PKCE profiles stay variant-less.
    expect(GITHUB_COPILOT_PROFILE.flow.variant).toBeUndefined();
  });
});

describe('OAuthProviderManager variant dispatch', () => {
  it('refreshes gitlab-duo via the generic secret-less PKCE grant', async () => {
    const { storage, saved } = memoryStorage();
    saved.set('gitlab-duo', {
      accessToken: 'gl-old',
      refreshToken: 'gl-refresh',
      expiresAt: 1,
      scope: 'api',
      tokenType: 'Bearer',
      expiresIn: 0,
    });
    const fetchMock = vi.fn<FetchMock>(async () =>
      jsonResponse({ access_token: 'gl-new', refresh_token: 'gl-refresh-2', expires_in: 7200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const manager = new OAuthProviderManager({ storage });
    const accessToken = await manager.ensureFresh('gitlab-duo');

    expect(accessToken).toBe('gl-new');
    expect(saved.get('gitlab-duo')?.refreshToken).toBe('gl-refresh-2');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://gitlab.com/oauth/token');
    expect(init.method).toBe('POST');
    const body = String(init.body);
    expect(body).toContain('grant_type=refresh_token');
    expect(body).toContain('refresh_token=gl-refresh');
    expect(body).toContain('client_id=da4edff2e6ebd2bc3208611e2768bc1c1dd7be791dc5ff26ca34ca9ee44f7d4b');
    expect(body).not.toContain('client_secret');
  });

  it('runs the glm-zcode code_paste login through the paste callback', async () => {
    const { storage, saved } = memoryStorage();
    const fetchMock = vi.fn<FetchMock>();
    let stage = 0;
    fetchMock.mockImplementation(async (input, init?: RequestInit) => {
      const url = String(input);
      stage += 1;
      if (stage === 1) {
        expect(url).toBe('https://zcode.z.ai/api/v1/oauth/token');
        return jsonResponse({
          data: { token: 'zcode-jwt', zai: { access_token: 'upstream' } },
        });
      }
      if (stage === 2) return jsonResponse({ data: { access_token: 'biz' } });
      if (stage === 3) {
        return jsonResponse({
          data: {
            organizations: [
              { organizationId: 'o', isDefault: true, projects: [{ projectId: 'p', isDefault: true }] },
            ],
          },
        });
      }
      if (stage === 4) return jsonResponse({ data: [] });
      if (stage === 5) return jsonResponse({ data: { apiKey: 'key-1' } });
      return jsonResponse({ data: { secretKey: 'sec-1' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const manager = new OAuthProviderManager({ storage });
    let authorizeState = '';
    const token = await manager.login(
      'glm-zcode',
      {
        onAuthorizeUrl: (url) => {
          expect(url).toContain('https://chat.z.ai/api/oauth/authorize');
          authorizeState = new URL(url).searchParams.get('state') ?? '';
        },
        onManualCallbackPrompt: async () =>
          `zcode://oauth/callback?code=auth-code&state=${authorizeState}`,
      },
      { storageKey: 'glm-zcode-secondary' },
    );

    expect(token.accessToken).toBe('key-1.sec-1');
    expect(saved.has('glm-zcode-secondary')).toBe(true);
  });
});
