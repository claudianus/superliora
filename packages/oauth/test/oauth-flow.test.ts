import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import {
  generatePkcePair,
  generateState,
  base64url,
  parseOAuthCallbackInput,
  postJson,
  postForm,
  startCallbackServer,
  waitForCallbackOrManual,
} from '../src/oauth-flow-http';
import {
  ANTHROPIC_PROFILE,
  EXPERIMENTAL_PROVIDER_PROFILES,
  KIMI_PROFILE,
  OPENAI_PROFILE,
  PROVIDER_PROFILES,
  XAI_GROK_API_BASE_URL,
  XAI_GROK_BUILD_BASE_URL,
  XAI_PROFILE,
  getProviderProfile,
  isOAuthProviderId,
  isXaiGrokApiBaseUrl,
  isXaiGrokBuildBaseUrl,
  resolveXaiGrokRoute,
  xaiGrokBuildRequestHeaders,
  xaiGrokRouteConfig,
} from '../src/profiles';
import {
  requestOpenAiUserCode,
  toTokenInfo as toOpenAiTokenInfo,
} from '../src/oauth-flow-openai';
import { toTokenInfo as toXaiTokenInfo } from '../src/oauth-flow-xai';
import { OAuthProviderManager } from '../src/oauth-provider-manager';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('oauth-flow-http helpers', () => {
  it('generates a PKCE pair with an S256 challenge matching the verifier', () => {
    const pair = generatePkcePair();
    expect(pair.method).toBe('S256');
    expect(pair.verifier.length).toBeGreaterThanOrEqual(43);
    const expectedChallenge = base64url(createHash('sha256').update(pair.verifier).digest());
    expect(pair.challenge).toBe(expectedChallenge);
  });

  it('base64url strips padding and swaps URL-unsafe characters', () => {
    // '?' (0b111111) → '+' → '-', '/' → '_', and no '=' padding.
    const encoded = base64url(Buffer.from([0xff, 0xff, 0xff]));
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
    expect(encoded).not.toContain('=');
  });

  it('generates a non-empty state', () => {
    expect(generateState().length).toBeGreaterThan(0);
  });

  it('postJson parses a JSON response', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const { data } = await postJson('https://example.test/api', {});
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(data).toEqual({ ok: true });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('postForm sends form-encoded params', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ access_token: 'tok' }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await postForm('https://example.test/token', { grant_type: 'refresh_token' });
      const init = fetchMock.mock.calls[0]?.[1];
      expect(init?.body).toBe('grant_type=refresh_token');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('provider profile registry', () => {
  it('includes Kimi, OpenAI, and xAI profiles', () => {
    const ids = PROVIDER_PROFILES.map((p) => p.id);
    expect(ids).toContain(KIMI_PROFILE.id);
    expect(ids).toContain(OPENAI_PROFILE.id);
    expect(ids).toContain(XAI_PROFILE.id);
  });

  it('looks up a profile by id', () => {
    expect(getProviderProfile('openai-codex')?.displayName).toBe('OpenAI Codex (ChatGPT login)');
    expect(getProviderProfile('xai-grok')?.wire).toBe('openai');
    expect(getProviderProfile('nonexistent')).toBeUndefined();
  });

  it('classifies known OAuth provider ids', () => {
    expect(isOAuthProviderId('openai-codex')).toBe(true);
    expect(isOAuthProviderId('random')).toBe(false);
  });

  it('configures OpenAI flow against auth.openai.com', () => {
    expect(OPENAI_PROFILE.flow.oauthHost).toBe('https://auth.openai.com');
    expect(OPENAI_PROFILE.flow.clientId).toBe('app_EMoamEEZ73f0CkXaXp7hrann');
    expect(OPENAI_PROFILE.flow.kind).toBe('device_code_openai');
  });

  it('configures xAI OAuth to the Grok Build proxy by default', () => {
    expect(XAI_PROFILE.flow.discoveryUrl).toContain('.well-known/openid-configuration');
    expect(XAI_PROFILE.flow.kind).toBe('pkce_browser');
    expect(XAI_PROFILE.apiBaseUrl).toBe(XAI_GROK_BUILD_BASE_URL);
    expect(XAI_PROFILE.customHeaders).toEqual({ 'X-XAI-Token-Auth': 'xai-grok-cli' });
  });

  it('classifies Grok Build vs Grok API base URLs', () => {
    expect(resolveXaiGrokRoute()).toBe('build');
    expect(resolveXaiGrokRoute(XAI_GROK_BUILD_BASE_URL)).toBe('build');
    expect(resolveXaiGrokRoute(XAI_GROK_API_BASE_URL)).toBe('api');
    expect(isXaiGrokBuildBaseUrl(XAI_GROK_BUILD_BASE_URL)).toBe(true);
    expect(isXaiGrokApiBaseUrl(XAI_GROK_API_BASE_URL)).toBe(true);
    expect(xaiGrokRouteConfig('api')).toEqual({ route: 'api', baseUrl: XAI_GROK_API_BASE_URL });
    expect(xaiGrokRouteConfig('build').customHeaders).toEqual({
      'X-XAI-Token-Auth': 'xai-grok-cli',
    });
    expect(xaiGrokBuildRequestHeaders('grok-4.5')).toEqual({
      'X-XAI-Token-Auth': 'xai-grok-cli',
      'x-grok-model-override': 'grok-4.5',
    });
  });

  it('ships model presets for OpenAI Codex', () => {
    expect(OPENAI_PROFILE.models).toBeDefined();
    expect(OPENAI_PROFILE.models!.length).toBeGreaterThan(0);
    expect(OPENAI_PROFILE.models!.every((m) => m.id.length > 0 && m.maxContextSize > 0)).toBe(true);
  });

  it('ships model presets for xAI Grok', () => {
    expect(XAI_PROFILE.models).toBeDefined();
    expect(XAI_PROFILE.models!.length).toBeGreaterThan(0);
    expect(XAI_PROFILE.models!.every((m) => m.id.length > 0 && m.maxContextSize > 0)).toBe(true);
    // The latest flagship model must be present as a fallback even before the
    // models.dev catalog is fetched.
    expect(XAI_PROFILE.models!.some((m) => m.id === 'grok-4.5')).toBe(true);
  });

  it('keeps the Anthropic profile out of the always-on list and in the experimental list', () => {
    // Anthropic OAuth is gated behind the anthropic_oauth flag.
    expect(PROVIDER_PROFILES.map((p) => p.id)).not.toContain('anthropic-oauth');
    const experimental = EXPERIMENTAL_PROVIDER_PROFILES.find((e) => e.profile.id === 'anthropic-oauth');
    expect(experimental).toBeDefined();
    expect(experimental?.flag).toBe('anthropic_oauth');
  });

  it('configures the Anthropic flow with PKCE browser against console.anthropic.com', () => {
    expect(ANTHROPIC_PROFILE.flow.kind).toBe('pkce_browser');
    expect(ANTHROPIC_PROFILE.flow.oauthHost).toBe('https://console.anthropic.com');
    expect(ANTHROPIC_PROFILE.wire).toBe('anthropic');
    expect(ANTHROPIC_PROFILE.models?.length).toBeGreaterThan(0);
  });

  it('can resolve the experimental Anthropic profile by id', () => {
    // getProviderProfile searches ALL_PROFILES (always-on + experimental).
    expect(getProviderProfile('anthropic-oauth')?.id).toBe('anthropic-oauth');
  });
});

describe('OpenAI flow wrappers', () => {
  it('requests a user code from the deviceauth endpoint', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({
        device_auth_id: 'da-1',
        user_code: 'ABC-123',
        interval: 3,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      const deviceCode = await requestOpenAiUserCode(OPENAI_PROFILE.flow);
      expect(deviceCode.deviceAuthId).toBe('da-1');
      expect(deviceCode.userCode).toBe('ABC-123');
      expect(deviceCode.interval).toBe(3);
      expect(deviceCode.verificationUri).toBe('https://auth.openai.com/codex/device');
      const url = fetchMock.mock.calls[0]?.[0];
      expect(url).toBe('https://auth.openai.com/api/accounts/deviceauth/usercode');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('converts an OpenAI token exchange into a TokenInfo', () => {
    const tokenInfo = toOpenAiTokenInfo({
      accessToken: 'a',
      refreshToken: 'r',
      expiresIn: 3600,
      scope: 'openid',
      tokenType: 'Bearer',
    });
    expect(tokenInfo.accessToken).toBe('a');
    expect(tokenInfo.refreshToken).toBe('r');
    expect(tokenInfo.expiresIn).toBe(3600);
    expect(tokenInfo.expiresAt).toBeGreaterThan(0);
  });

  it('converts an xAI token exchange into a TokenInfo', () => {
    const tokenInfo = toXaiTokenInfo({
      accessToken: 'xa',
      refreshToken: 'xr',
      expiresIn: 3600,
      scope: 'openid profile',
      tokenType: 'Bearer',
    });
    expect(tokenInfo.accessToken).toBe('xa');
    expect(tokenInfo.scope).toBe('openid profile');
  });
});

describe('OAuthProviderManager', () => {
  it('derives a filesystem-safe storage name per provider', () => {
    const manager = new OAuthProviderManager();
    expect(manager.storageName('managed:kimi-api')).toBe('kimi-api');
    expect(manager.storageName('openai-codex')).toBe('openai-codex');
    expect(manager.storageName('xai-grok')).toBe('xai-grok');
  });

  it('throws for an unknown provider id on login', async () => {
    const manager = new OAuthProviderManager();
    await expect(manager.login('unknown-provider', {})).rejects.toThrow(/No OAuth profile/);
  });
});


describe('parseOAuthCallbackInput', () => {
  it('parses a full callback URL', () => {
    const result = parseOAuthCallbackInput(
      'http://127.0.0.1:56121/callback?code=abc123&state=xyz',
    );
    expect(result).toEqual({ code: 'abc123', state: 'xyz' });
  });

  it('parses a query string', () => {
    const result = parseOAuthCallbackInput('code=abc123&state=xyz');
    expect(result).toEqual({ code: 'abc123', state: 'xyz' });
  });

  it('accepts a bare authorization code when expectedState is provided', () => {
    const result = parseOAuthCallbackInput('abc123XYZ7890', 'xyz');
    expect(result).toEqual({ code: 'abc123XYZ7890', state: 'xyz' });
  });

  it('rejects a bare code without expectedState', () => {
    expect(() => parseOAuthCallbackInput('abc123XYZ7890')).toThrow(/Could not parse/);
  });

  it('rejects a mismatched state', () => {
    expect(() =>
      parseOAuthCallbackInput('http://127.0.0.1/callback?code=abc&state=one', 'two'),
    ).toThrow(/state does not match/);
  });
});

describe('waitForCallbackOrManual', () => {
  it('accepts a manually pasted callback while the loopback server is waiting', async () => {
    const server = await startCallbackServer(0, '127.0.0.1');
    try {
      const resultPromise = waitForCallbackOrManual(server, {
        expectedState: 'state-1',
        onManualCallbackPrompt: async () =>
          'http://127.0.0.1:1/callback?code=manual-code&state=state-1',
      });
      await expect(resultPromise).resolves.toEqual({
        code: 'manual-code',
        state: 'state-1',
      });
    } finally {
      await server.close();
    }
  });

  it('re-prompts after an invalid paste and then accepts a valid one', async () => {
    const server = await startCallbackServer(0, '127.0.0.1');
    try {
      let calls = 0;
      const resultPromise = waitForCallbackOrManual(server, {
        expectedState: 'state-2',
        onManualCallbackPrompt: async ({ lastError }) => {
          calls += 1;
          if (calls === 1) {
            expect(lastError).toBeUndefined();
            return 'not a valid callback';
          }
          expect(lastError).toMatch(/Could not parse|missing state|empty/i);
          return 'code=ok-code&state=state-2';
        },
      });
      await expect(resultPromise).resolves.toEqual({
        code: 'ok-code',
        state: 'state-2',
      });
      expect(calls).toBe(2);
    } finally {
      await server.close();
    }
  });
});
