import { afterEach, describe, expect, it, vi } from 'vitest';

import { OAuthProviderManager } from '../src/flow/oauth-provider-manager';
import { discoverGoogleCodeAssistProject, refreshGoogleToken } from '../src/flow/oauth-flow-google';
import {
  pollKiroDeviceToken,
  refreshKiroToken,
  requestKiroDeviceAuthorization,
  resetKiroRegistrationCache,
} from '../src/flow/oauth-flow-kiro';
import { EXPERIMENTAL_PROVIDER_PROFILES } from '../src/profiles';
import type { TokenInfo } from '../src/types';

afterEach(() => {
  vi.unstubAllGlobals();
  resetKiroRegistrationCache();
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

describe('google gemini-cli oauth flow', () => {
  it('registers the profile behind the google_gemini_cli_oauth flag', () => {
    const entry = EXPERIMENTAL_PROVIDER_PROFILES.find((e) => e.profile.id === 'google-gemini-cli');
    expect(entry?.flag).toBe('google_gemini_cli_oauth');
    expect(entry?.profile.flow.kind).toBe('google_oauth');
    expect(entry?.profile.wire).toBe('code-assist');
    expect(entry?.profile.apiBaseUrl).toBe('https://cloudcode-pa.googleapis.com');
  });

  it('discovers an existing Code Assist project', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ currentTier: { id: 'free-tier' }, cloudaicompanionProject: 'proj-1' })),
    );
    const project = await discoverGoogleCodeAssistProject('tok');
    expect(project).toBe('proj-1');
  });

  it('provisions a project for free-tier accounts via onboardUser', async () => {
    const fetchMock = vi.fn(async (url: unknown) => {
      if (String(url).includes('loadCodeAssist')) {
        return jsonResponse({ allowedTiers: [{ id: 'free-tier', isDefault: true }] });
      }
      return jsonResponse({ done: true, response: { cloudaicompanionProject: { id: 'proj-new' } } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const project = await discoverGoogleCodeAssistProject('tok');
    expect(project).toBe('proj-new');
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.includes('/v1internal:loadCodeAssist'))).toBe(true);
    expect(urls.some((url) => url.includes('/v1internal:onboardUser'))).toBe(true);
  });

  it('refreshes with the client secret grant', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => jsonResponse({ access_token: 'tok2', expires_in: 3600 }));
    vi.stubGlobal('fetch', fetchMock);
    const token = await refreshGoogleToken(
      {
        clientId: 'cid',
        clientSecret: 'sec',
        scopes: [],
        callbackPort: 8085,
        callbackPath: '/oauth2callback',
        authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
      },
      'rt',
    );
    expect(token.accessToken).toBe('tok2');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const body = String(init?.body);
    expect(body).toContain('client_secret=sec');
    expect(body).toContain('grant_type=refresh_token');
  });

  it('falls back to the refresh flow when loadCodeAssist fails with an env project', async () => {
    vi.stubEnv('GOOGLE_CLOUD_PROJECT', 'env-proj');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: { details: [{ reason: 'SECURITY_POLICY_VIOLATED' }] } }, 403)),
    );
    const project = await discoverGoogleCodeAssistProject('tok');
    expect(project).toBe('env-proj');
  });
});

describe('kiro aws sso oidc device flow', () => {
  it('registers the profile behind the kiro_oauth flag', () => {
    const entry = EXPERIMENTAL_PROVIDER_PROFILES.find((e) => e.profile.id === 'kiro');
    expect(entry?.flag).toBe('kiro_oauth');
    expect(entry?.profile.flow.kind).toBe('device_code_kiro');
    expect(entry?.profile.wire).toBe('codewhisperer');
  });

  it('polls device authorization through pending to a token', async () => {
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        call += 1;
        if (call === 1) {
          return jsonResponse({ clientId: 'cid-1', clientSecret: 'sec-1', clientSecretExpiresAt: 9e9 });
        }
        if (call === 2) {
          return jsonResponse({ deviceCode: 'dc', userCode: 'ABCD-EFGH', verificationUri: 'https://view.awsapps.com/start#/device', expiresIn: 600, interval: 1 });
        }
        if (call === 3) {
          return jsonResponse({ error: 'authorization_pending' });
        }
        return jsonResponse({ accessToken: 'at', refreshToken: 'rt', expiresIn: 28800 });
      }),
    );
    const { authorization, region } = await requestKiroDeviceAuthorization();
    expect(authorization.userCode).toBe('ABCD-EFGH');
    expect(region).toBe('us-east-1');

    const delays: number[] = [];
    const token = await pollKiroDeviceToken(authorization, region, {
      onRetry: (delayMs) => {
        delays.push(delayMs);
      },
    });
    expect(token.accessToken).toBe('at');
    expect(token.refreshToken).toBe('rt');
    expect(delays.length).toBe(1);
  });

  it('surfaces access_denied as an OAuth error', async () => {
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        call += 1;
        if (call === 1) return jsonResponse({ clientId: 'cid-1', clientSecret: 'sec-1' });
        if (call === 2) {
          return jsonResponse({ deviceCode: 'dc', userCode: 'ABCD-EFGH', verificationUri: 'https://view.awsapps.com/start#/device' });
        }
        return jsonResponse({ error: 'access_denied' });
      }),
    );
    const { authorization, region } = await requestKiroDeviceAuthorization();
    await expect(pollKiroDeviceToken(authorization, region)).rejects.toThrow(/denied/);
  });

  it('refreshes by re-registering a public client', async () => {
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        call += 1;
        if (call === 1) return jsonResponse({ clientId: 'cid-2', clientSecret: 'sec-2' });
        return jsonResponse({ accessToken: 'at2', expiresIn: 3600 });
      }),
    );
    const token = await refreshKiroToken('rt');
    expect(token.accessToken).toBe('at2');
    expect(token.refreshToken).toBe('rt');
  });

  it('runs the kiro login end-to-end through the provider manager', async () => {
    const { storage, saved } = memoryStorage();
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        call += 1;
        if (call === 1) return jsonResponse({ clientId: 'cid-1', clientSecret: 'sec-1' });
        if (call === 2) {
          return jsonResponse({ deviceCode: 'dc', userCode: 'ABCD-EFGH', verificationUri: 'https://view.awsapps.com/start#/device', interval: 1 });
        }
        return jsonResponse({ accessToken: 'at', refreshToken: 'rt', expiresIn: 28800 });
      }),
    );
    const manager = new OAuthProviderManager({ storage });
    const prompts: string[] = [];
    const token = await manager.login('kiro', {
      onDeviceCode: (auth) => {
        prompts.push(auth.verificationUriComplete);
      },
    });
    expect(prompts).toEqual(['https://view.awsapps.com/start#/device']);
    expect(token.accessToken).toBe('at');
    expect(saved.has('kiro')).toBe(true);
  });
});
