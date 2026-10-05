import { afterEach, describe, expect, it, vi } from 'vitest';

import { OAuthProviderManager } from '../src/flow/oauth-provider-manager';
import { runDeviceCodeFlow, refreshDeviceCodeToken } from '../src/flow/oauth-flow-device';
import { runDevinPkceFlow } from '../src/flow/oauth-flow-devin';
import { runKiloDeviceFlow } from '../src/flow/oauth-flow-kilo';
import { refreshMinimaxToken, runMinimaxUserCodeFlow } from '../src/flow/oauth-flow-minimax';
import { runOpenRouterKeyFlow } from '../src/flow/oauth-flow-openrouter';
import {
  discoverGoogleAntigravityProject,
  resolveGoogleAntigravityOauthConfig,
} from '../src/flow/oauth-flow-google';
import {
  EXPERIMENTAL_PROVIDER_PROFILES,
  getProviderProfile,
} from '../src/profiles';
import { OAUTH_PROVIDER_IDS } from '../src/profiles/provider-profile';
import { qwenResourceUrlToBaseUrl } from '../src/profiles/qwen-oauth';
import { tokenFromWire, tokenToWire, type TokenInfo } from '../src/types';

type FetchMock = (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) => Promise<Response>;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
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

const NOOP_SLEEP = (): Promise<void> => Promise.resolve();

function jwtWithExp(expSeconds: number): string {
  const segment = (value: unknown): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${segment({ alg: 'none' })}.${segment({ exp: expSeconds })}.sig`;
}

describe('new OAuth provider profiles', () => {
  it('registers every new id in OAUTH_PROVIDER_IDS with a resolvable profile', () => {
    for (const id of [
      'google-antigravity',
      'qwen-oauth',
      'minimax-oauth',
      'minimax-oauth-cn',
      'nous',
      'openrouter-oauth',
      'devin',
      'muse-code',
      'kilo',
      'factory-droid',
    ]) {
      expect(OAUTH_PROVIDER_IDS).toContain(id);
      expect(getProviderProfile(id)?.id).toBe(id);
    }
  });

  it('gates the new providers behind experimental flags; antigravity stays off by default', () => {
    const flags = new Map(
      EXPERIMENTAL_PROVIDER_PROFILES.map((entry) => [entry.profile.id, entry]),
    );
    expect(flags.get('qwen-oauth')?.flag).toBe('qwen_oauth');
    expect(flags.get('minimax-oauth')?.flag).toBe('minimax_oauth');
    expect(flags.get('minimax-oauth-cn')?.flag).toBe('minimax_oauth');
    expect(flags.get('nous')?.flag).toBe('nous_oauth');
    expect(flags.get('openrouter-oauth')?.flag).toBe('openrouter_oauth');
    // Google bans accounts over third-party Antigravity logins: opt-in only.
    const antigravity = flags.get('google-antigravity');
    expect(antigravity?.flag).toBe('google_antigravity_oauth');
    expect(antigravity?.offByDefault).toBe(true);
    expect(flags.get('devin')?.flag).toBe('devin_oauth');
    expect(flags.get('muse-code')?.flag).toBe('muse_code_oauth');
    expect(flags.get('kilo')?.flag).toBe('kilo_oauth');
    expect(flags.get('factory-droid')?.flag).toBe('factory_droid_oauth');
  });
});

describe('generic device_code flow (qwen / nous)', () => {
  it('sends the PKCE challenge on the device request and the verifier on the poll', async () => {
    const bodies: string[] = [];
    let polls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchMock>(async (input, init) => {
        const url = String(input);
        bodies.push(String(init?.body));
        if (url.endsWith('/device/code')) {
          return jsonResponse({
            device_code: 'dc-1',
            user_code: 'ABCD-1234',
            verification_uri: 'https://chat.qwen.ai/device',
            expires_in: 900,
            interval: 1,
          });
        }
        polls += 1;
        if (polls === 1) return jsonResponse({ error: 'authorization_pending' }, 400);
        return jsonResponse({
          access_token: 'qwen-at',
          refresh_token: 'qwen-rt',
          expires_in: 3600,
          token_type: 'Bearer',
          resource_url: 'portal.qwen.ai',
        });
      }),
    );
    const profile = getProviderProfile('qwen-oauth');
    expect(profile).toBeDefined();
    if (profile === undefined) return;

    const token = await runDeviceCodeFlow(profile.flow, { sleep: NOOP_SLEEP });
    expect(token.accessToken).toBe('qwen-at');
    // resource_url is captured so connect can adopt the assigned endpoint.
    expect(token.resourceUrl).toBe('portal.qwen.ai');

    const deviceBody = bodies[0] ?? '';
    expect(deviceBody).toContain('code_challenge=');
    expect(deviceBody).toContain('code_challenge_method=S256');
    expect(deviceBody).toContain('client_id=f0304373b74a44d2b584a3fb70ca9e56');
    expect(deviceBody).toContain(encodeURIComponent('model.completion'));
    const pollBody = bodies.at(-1) ?? '';
    expect(pollBody).toContain('code_verifier=');
    expect(pollBody).toContain('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code');
  });

  it('derives expires_in from the JWT exp claim when the portal omits it', async () => {
    const exp = Math.floor(Date.now() / 1000) + 7200;
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchMock>(async (input) =>
        String(input).endsWith('/device/code')
          ? jsonResponse({
              device_code: 'dc',
              user_code: 'UU',
              verification_uri: 'https://portal.nousresearch.com/device',
              interval: 1,
            })
          : jsonResponse({
              access_token: jwtWithExp(exp),
              refresh_token: 'nous-rt',
              token_type: 'Bearer',
            }),
      ),
    );
    const profile = getProviderProfile('nous');
    if (profile === undefined) throw new Error('nous profile missing');
    const token = await runDeviceCodeFlow(profile.flow, { sleep: NOOP_SLEEP });
    expect(token.expiresIn).toBeGreaterThan(0);
    expect(token.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('sends the refresh token in the provider header on refresh (nous)', async () => {
    const seen: { headers: unknown }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchMock>(async (_input, init) => {
        seen.push({ headers: init?.headers });
        return jsonResponse({
          access_token: 'nous-at-2',
          refresh_token: 'nous-rt-2',
          expires_in: 3600,
        });
      }),
    );
    const profile = getProviderProfile('nous');
    if (profile === undefined) throw new Error('nous profile missing');
    const token = await refreshDeviceCodeToken(profile.flow, 'nous-rt');
    expect(token.accessToken).toBe('nous-at-2');
    const headers = seen[0]?.headers as Record<string, string> | undefined;
    expect(headers?.['x-nous-refresh-token']).toBe('nous-rt');
  });
});

describe('minimax user_code flow', () => {
  it('polls with the user_code grant and normalizes absolute-ms expired_in', async () => {
    const bodies: string[] = [];
    const absoluteDeadline = Date.now() + 300_000;
    let polls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchMock>(async (input, init) => {
        bodies.push(String(init?.body));
        if (String(input).endsWith('/oauth/code')) {
          return jsonResponse({
            user_code: 'MM-42',
            verification_uri: 'https://www.minimax.io/device',
            expired_in: absoluteDeadline,
            interval: 50,
          });
        }
        polls += 1;
        if (polls === 1) return jsonResponse({ status: 'pending' });
        return jsonResponse({
          status: 'success',
          access_token: 'mm-at',
          refresh_token: 'mm-rt',
          expired_in: 7200,
        });
      }),
    );
    const profile = getProviderProfile('minimax-oauth');
    if (profile === undefined) throw new Error('minimax profile missing');

    let shownUri = '';
    const token = await runMinimaxUserCodeFlow(profile.flow, {
      sleep: NOOP_SLEEP,
      onDeviceCode: (auth) => {
        shownUri = auth.verificationUri;
      },
    });
    expect(token.accessToken).toBe('mm-at');
    // Stale www.minimax.io verification hosts are normalized to the portal.
    expect(shownUri).toBe('https://platform.minimax.io/device');

    const codeBody = bodies[0] ?? '';
    expect(codeBody).toContain('code_challenge=');
    const pollBody = bodies.at(-1) ?? '';
    expect(pollBody).toContain(
      'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Auser_code',
    );
    expect(pollBody).toContain('user_code=MM-42');
    expect(pollBody).toContain('code_verifier=');
  });

  it('treats refresh_token_reused as an unauthorized re-login signal', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchMock>(async () =>
        jsonResponse({ error: 'refresh_token_reused' }, 400),
      ),
    );
    const profile = getProviderProfile('minimax-oauth');
    if (profile === undefined) throw new Error('minimax profile missing');
    const error = await refreshMinimaxToken(profile.flow, 'mm-rt').catch(
      (error: unknown) => error,
    );
    expect((error as Error).constructor.name).toBe('OAuthUnauthorizedError');
  });
});

describe('openrouter pkce_api_key flow', () => {
  it('accepts a state-less callback paste and mints a durable key', async () => {
    let exchangeBody: Record<string, unknown> | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchMock>(async (_input, init) => {
        exchangeBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return jsonResponse({ key: 'sk-or-v1-test-key' });
      }),
    );
    const profile = getProviderProfile('openrouter-oauth');
    if (profile === undefined) throw new Error('openrouter profile missing');

    const token = await runOpenRouterKeyFlow(profile.flow, {
      onManualCallbackPrompt: async () =>
        // OpenRouter redirects carry only ?code= — no state was issued.
        'http://127.0.0.1:1/callback?code=or-auth-code-12345',
    });
    expect(token.accessToken).toBe('sk-or-v1-test-key');
    // The key doubles as its own refresh credential.
    expect(token.refreshToken).toBe('sk-or-v1-test-key');
    expect(exchangeBody?.['code']).toBe('or-auth-code-12345');
    expect(typeof exchangeBody?.['code_verifier']).toBe('string');
  });
});

describe('google antigravity oauth', () => {
  it('uses its own PKCE config (port 51121, wider scopes, dedicated secret)', () => {
    const config = resolveGoogleAntigravityOauthConfig();
    expect(config.pkce).toBe(true);
    expect(config.callbackPort).toBe(51121);
    expect(config.scopes).toContain('https://www.googleapis.com/auth/cclog');
    expect(config.scopes).toContain('https://www.googleapis.com/auth/cloud-platform');
    expect(config.clientSecret.startsWith('GOCSPX-')).toBe(true);
  });

  it('discovers the project across the sandbox endpoints before production', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchMock>(async (input) => {
        urls.push(String(input));
        // First sandbox rejects (tier gating); second answers the project.
        if (urls.length === 1) return jsonResponse({ error: {} }, 403);
        return jsonResponse({ cloudaicompanionProject: 'ag-proj-1' });
      }),
    );
    const project = await discoverGoogleAntigravityProject('tok');
    expect(project).toBe('ag-proj-1');
    expect(urls[0]).toContain('daily-cloudcode-pa.sandbox.googleapis.com');
    expect(urls[1]).toContain('autopush-cloudcode-pa.sandbox.googleapis.com');
  });

  it('prefers GOOGLE_CLOUD_PROJECT when set', async () => {
    vi.stubEnv('GOOGLE_CLOUD_PROJECT', 'env-ag-proj');
    const fetchMock = vi.fn<FetchMock>(async () =>
      jsonResponse({ cloudaicompanionProject: 'other' }),
    );
    vi.stubGlobal('fetch', fetchMock);
    expect(await discoverGoogleAntigravityProject('tok')).toBe('env-ag-proj');
  });
});

describe('devin pkce flow', () => {
  it('exchanges the loopback code for a session JWT with exp-derived expiry', async () => {
    const exp = Math.floor(Date.now() / 1000) + 90 * 24 * 3600;
    const sessionJwt = jwtWithExp(exp);
    let exchangeBody: Record<string, unknown> | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchMock>(async (input, init) => {
        expect(String(input)).toBe('https://api.devin.ai/auth/cli/token');
        exchangeBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return jsonResponse({ token: sessionJwt });
      }),
    );
    const profile = getProviderProfile('devin');
    if (profile === undefined) throw new Error('devin profile missing');

    let authorizeUrl = '';
    const token = await runDevinPkceFlow(profile.flow, {
      onAuthorizeUrl: (url) => {
        authorizeUrl = url;
      },
      onManualCallbackPrompt: async () => {
        const state = new URL(authorizeUrl).searchParams.get('state');
        expect(state).toBeTruthy();
        return `http://127.0.0.1:59653/callback?code=devin-code-1&state=${state ?? ''}`;
      },
    });
    expect(token.accessToken).toBe(sessionJwt);
    expect(token.refreshToken).toBe('');
    // ~90 days of remaining JWT lifetime, not the 1-year fallback.
    expect(token.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000) + 80 * 24 * 3600);
    expect(token.expiresAt).toBeLessThan(Math.floor(Date.now() / 1000) + 100 * 24 * 3600);
    expect(exchangeBody?.['code']).toBe('devin-code-1');
    expect(typeof exchangeBody?.['code_verifier']).toBe('string');
    const url = new URL(authorizeUrl);
    expect(url.origin + url.pathname).toBe('https://app.devin.ai/auth/cli/continue');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:59653/callback');
  });

  it('falls back to a ~1-year expiry when the session token has no exp', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchMock>(async () => jsonResponse({ token: 'opaque-session' })),
    );
    const profile = getProviderProfile('devin');
    if (profile === undefined) throw new Error('devin profile missing');
    let authorizeUrl = '';
    const token = await runDevinPkceFlow(profile.flow, {
      onAuthorizeUrl: (url) => {
        authorizeUrl = url;
      },
      onManualCallbackPrompt: async () => {
        const state = new URL(authorizeUrl).searchParams.get('state') ?? '';
        return `http://127.0.0.1:59653/callback?code=c2&state=${state}`;
      },
    });
    expect(token.expiresIn).toBeGreaterThan(300 * 24 * 3600);
  });
});

describe('kilo device authorization', () => {
  function kiloFetch(pollBodies: Array<Response>): FetchMock {
    let polls = 0;
    return async (input, init) => {
      const url = String(input);
      if (init?.method === 'POST' && url.endsWith('/api/device-auth/codes')) {
        return jsonResponse({
          code: 'kilo-code-1',
          verificationUrl: 'https://kilo.ai/device?code=kilo-code-1',
          expiresIn: 600,
        });
      }
      polls += 1;
      return pollBodies[Math.min(polls - 1, pollBodies.length - 1)] ?? jsonResponse({}, 202);
    };
  }

  it('polls the code endpoint and stores the ~1-year gateway token', async () => {
    let shown = '';
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchMock>(
        kiloFetch([new Response('', { status: 202 }), jsonResponse({ status: 'approved', token: 'kilo-tok' })]),
      ),
    );
    const profile = getProviderProfile('kilo');
    if (profile === undefined) throw new Error('kilo profile missing');
    const token = await runKiloDeviceFlow(profile.flow, {
      sleep: NOOP_SLEEP,
      onDeviceCode: (auth) => {
        shown = auth.verificationUri;
      },
    });
    expect(token.accessToken).toBe('kilo-tok');
    expect(token.expiresIn).toBeGreaterThan(300 * 24 * 3600);
    expect(shown).toContain('kilo-code-1');
  });

  it.each([
    [403, 'denied'],
    [410, 'expired'],
  ])('maps HTTP %i to a terminal OAuthError', async (status, match) => {
    vi.stubGlobal('fetch', vi.fn<FetchMock>(kiloFetch([new Response('', { status })])));
    const profile = getProviderProfile('kilo');
    if (profile === undefined) throw new Error('kilo profile missing');
    await expect(
      runKiloDeviceFlow(profile.flow, { sleep: NOOP_SLEEP }),
    ).rejects.toThrow(new RegExp(match, 'i'));
  });
});

describe('muse code key minting', () => {
  function museFetch(mintResponse: Response): FetchMock {
    return async (input) => {
      const url = String(input);
      if (url.includes('device/authorization')) {
        return jsonResponse({
          device_code: 'dc',
          user_code: 'MUSE-1',
          verification_uri: 'https://www.meta.ai/device',
          interval: 1,
        });
      }
      if (url.includes('device/token')) {
        // Meta omits expires_in — the account token is session-bound.
        return jsonResponse({ access_token: 'meta-account-token', token_type: 'Bearer' });
      }
      if (url === 'https://api.meta.ai/muse-code/key') {
        return mintResponse;
      }
      throw new Error(`unexpected url ${url}`);
    };
  }

  it('mints the Muse API key and keeps the Meta token as refresh credential', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchMock>(museFetch(jsonResponse({ api_key: 'muse-api-key-1', is_subs_active: true }))),
    );
    const profile = getProviderProfile('muse-code');
    if (profile === undefined) throw new Error('muse-code profile missing');
    const token = await runDeviceCodeFlow(profile.flow, { sleep: NOOP_SLEEP });
    expect(token.accessToken).toBe('muse-api-key-1');
    expect(token.refreshToken).toBe('meta-account-token');
    // Meta's grant is non-expiring (jwt_or_never → expiresAt 0).
    expect(token.expiresAt).toBe(0);
  });

  it('fails the login on an inactive subscription', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchMock>(museFetch(jsonResponse({ is_subs_active: false }))),
    );
    const profile = getProviderProfile('muse-code');
    if (profile === undefined) throw new Error('muse-code profile missing');
    await expect(
      runDeviceCodeFlow(profile.flow, { sleep: NOOP_SLEEP }),
    ).rejects.toThrow(/inactive/i);
  });
});

describe('factory droid device flow', () => {
  function workosJwt(externalOrgId: string): string {
    const segment = (value: unknown): string =>
      Buffer.from(JSON.stringify(value)).toString('base64url');
    return `${segment({ alg: 'none' })}.${segment({ external_org_id: externalOrgId })}.sig`;
  }

  it('resolves org and residency through the whoami post-exchange', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchMock>(async (input) => {
        const url = String(input);
        calls.push(url);
        if (url.includes('workos.com/user_management/authorize/device')) {
          return jsonResponse({
            device_code: 'dc',
            user_code: 'FAC-1',
            verification_uri: 'https://factory.ai/device',
            interval: 1,
          });
        }
        if (url.includes('workos.com/user_management/authenticate')) {
          return jsonResponse({
            access_token: workosJwt('org-ext-9'),
            refresh_token: 'workos-rt',
            expires_in: 3600,
          });
        }
        if (url === 'https://api.factory.ai/api/cli/whoami') {
          return jsonResponse({ orgId: 'org-ext-9', region: 'eu', inferenceRegion: 'eu' });
        }
        throw new Error(`unexpected url ${url}`);
      }),
    );
    const profile = getProviderProfile('factory-droid');
    if (profile === undefined) throw new Error('factory-droid profile missing');
    const token = await runDeviceCodeFlow(profile.flow, { sleep: NOOP_SLEEP });
    expect(token.orgId).toBe('org-ext-9');
    expect(token.region).toBe('eu');
    expect(token.inferenceRegion).toBe('eu');
    expect(calls.some((u) => u.includes('whoami'))).toBe(true);
  });

  it('falls back to the external_org_id JWT claim when whoami omits orgId', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchMock>(async (input) => {
        const url = String(input);
        if (url.includes('authorize/device')) {
          return jsonResponse({
            device_code: 'dc',
            user_code: 'FAC-2',
            verification_uri: 'https://factory.ai/device',
            interval: 1,
          });
        }
        if (url.includes('authenticate')) {
          return jsonResponse({ access_token: workosJwt('org-jwt-4'), expires_in: 3600 });
        }
        if (url.includes('whoami')) {
          return jsonResponse({ region: 'global' });
        }
        throw new Error(`unexpected url ${url}`);
      }),
    );
    const profile = getProviderProfile('factory-droid');
    if (profile === undefined) throw new Error('factory-droid profile missing');
    const token = await runDeviceCodeFlow(profile.flow, { sleep: NOOP_SLEEP });
    expect(token.orgId).toBe('org-jwt-4');
    expect(token.region).toBe('global');
    expect(token.inferenceRegion).toBe('global');
  });
});

describe('provider manager dispatch for new flows', () => {
  it('runs qwen-oauth login through the generic device flow and keeps resourceUrl', async () => {
    const { storage, saved } = memoryStorage();
    let polls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchMock>(async (input) => {
        const url = String(input);
        if (url.includes('chat.qwen.ai/api/v1/oauth2/device/code')) {
          return jsonResponse({
            device_code: 'dc',
            user_code: 'QWEN-1',
            verification_uri: 'https://chat.qwen.ai/device',
            interval: 1,
          });
        }
        polls += 1;
        return jsonResponse({
          access_token: 'qat',
          refresh_token: 'qrt',
          expires_in: 3600,
          resource_url: 'portal.qwen.ai',
        });
      }),
    );
    const manager = new OAuthProviderManager({ storage });
    const prompts: string[] = [];
    const token = await manager.login('qwen-oauth', {
      onDeviceCode: (auth) => {
        prompts.push(auth.userCode);
      },
    });
    expect(token.accessToken).toBe('qat');
    expect(token.resourceUrl).toBe('portal.qwen.ai');
    expect(prompts).toEqual(['QWEN-1']);
    expect(saved.get('qwen-oauth')?.resourceUrl).toBe('portal.qwen.ai');
    expect(polls).toBe(1);
  });

  it('re-wraps the openrouter key on refresh without a network round-trip', async () => {
    const { storage, saved } = memoryStorage();
    saved.set('openrouter-oauth', {
      accessToken: 'sk-or-old',
      refreshToken: 'sk-or-old',
      expiresAt: 1,
      scope: '',
      tokenType: 'Bearer',
      expiresIn: 0,
    });
    const fetchMock = vi.fn<FetchMock>(async () => jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);
    const manager = new OAuthProviderManager({ storage });
    const token = await manager.ensureFresh('openrouter-oauth');
    expect(token).toBe('sk-or-old');
    expect(fetchMock).not.toHaveBeenCalled();
    // The key survives the re-wrap — the next expiry check still sees it.
    expect(saved.get('openrouter-oauth')?.refreshToken).toBe('sk-or-old');
  });
});

describe('qwen resource_url normalization', () => {
  it.each([
    ['portal.qwen.ai', 'https://portal.qwen.ai/v1'],
    ['https://portal.qwen.ai', 'https://portal.qwen.ai/v1'],
    ['https://portal.qwen.ai/v1', 'https://portal.qwen.ai/v1'],
    ['https://portal.qwen.ai/v1/', 'https://portal.qwen.ai/v1'],
  ])('maps %s → %s', (input, expected) => {
    expect(qwenResourceUrlToBaseUrl(input)).toBe(expected);
  });

  it('returns undefined for unusable values', () => {
    expect(qwenResourceUrlToBaseUrl('  ')).toBeUndefined();
    expect(qwenResourceUrlToBaseUrl('https://')).toBeUndefined();
  });
});

describe('token wire round-trip', () => {
  it('persists project_id and resource_url', () => {
    const token: TokenInfo = {
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAt: 9999999999,
      scope: 's',
      tokenType: 'Bearer',
      expiresIn: 3600,
      projectId: 'proj-1',
      resourceUrl: 'https://portal.qwen.ai/v1',
    };
    const wire = tokenToWire(token);
    expect(wire.project_id).toBe('proj-1');
    expect(wire.resource_url).toBe('https://portal.qwen.ai/v1');
    const back = tokenFromWire(wire);
    expect(back.projectId).toBe('proj-1');
    expect(back.resourceUrl).toBe('https://portal.qwen.ai/v1');
  });

  it('persists the factory org and region fields', () => {
    const token: TokenInfo = {
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAt: 9999999999,
      scope: '',
      tokenType: 'Bearer',
      expiresIn: 3600,
      orgId: 'org-ext-9',
      region: 'eu',
      inferenceRegion: 'us',
    };
    const wire = tokenToWire(token);
    expect(wire.org_id).toBe('org-ext-9');
    expect(wire.region).toBe('eu');
    expect(wire.inference_region).toBe('us');
    const back = tokenFromWire(wire);
    expect(back.orgId).toBe('org-ext-9');
    expect(back.region).toBe('eu');
    expect(back.inferenceRegion).toBe('us');
  });
});
