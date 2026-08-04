import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { base64url } from '../src/flow/oauth-flow-http';
import {
  buildCursorLoginUrl,
  jwtExpiresInSeconds,
  parseCursorTokenResponse,
  pollCursorAuth,
  refreshCursorToken,
  runCursorDeepLinkFlow,
  toCursorTokenInfo,
} from '../src/flow/oauth-flow-cursor';
import { CURSOR_PROFILE, getProviderProfile, isOAuthProviderId } from '../src/profiles';
import { EXPERIMENTAL_PROVIDER_PROFILES } from '../src/profiles';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function jwtWithExp(exp: number): string {
  const header = base64url(Buffer.from(JSON.stringify({ alg: 'none' })));
  const payload = base64url(Buffer.from(JSON.stringify({ exp })));
  return `${header}.${payload}.sig`;
}

describe('cursor deep-link OAuth', () => {
  it('registers cursor-oauth as an experimental profile', () => {
    expect(getProviderProfile('cursor-oauth')).toEqual(CURSOR_PROFILE);
    expect(isOAuthProviderId('cursor-oauth')).toBe(true);
    expect(CURSOR_PROFILE.flow.kind).toBe('deep_link_poll');
    expect(CURSOR_PROFILE.wire).toBe('cursor');
    expect(
      EXPERIMENTAL_PROVIDER_PROFILES.some(
        (entry) => entry.profile.id === 'cursor-oauth' && entry.flag === 'cursor_oauth',
      ),
    ).toBe(true);
  });

  it('builds a loginDeepControl URL with challenge and uuid', () => {
    const url = buildCursorLoginUrl('chal', 'uuid-1');
    expect(url).toContain('https://cursor.com/loginDeepControl?');
    expect(url).toContain('challenge=chal');
    expect(url).toContain('uuid=uuid-1');
    expect(url).toContain('mode=login');
    expect(url).toContain('redirectTarget=cli');
  });

  it('parses camelCase poll tokens and preserves prior refresh when omitted', () => {
    const parsed = parseCursorTokenResponse({
      accessToken: 'access',
      refreshToken: 'refresh',
    });
    expect(parsed?.accessToken).toBe('access');
    expect(parsed?.refreshToken).toBe('refresh');

    const preserved = parseCursorTokenResponse({ accessToken: 'access-2' }, 'old-refresh');
    expect(preserved?.refreshToken).toBe('old-refresh');

    expect(parseCursorTokenResponse({})).toBeUndefined();
    expect(parseCursorTokenResponse({ accessToken: '' })).toBeUndefined();
  });

  it('reads JWT exp for expiresIn', () => {
    const exp = Math.floor(Date.now() / 1000) + 3_600;
    const expiresIn = jwtExpiresInSeconds(jwtWithExp(exp));
    expect(expiresIn).toBeGreaterThan(3_000);
    expect(expiresIn).toBeLessThanOrEqual(3_600);
  });

  it('polls until tokens arrive after pending 404s', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(
        jsonResponse({ accessToken: 'access-1', refreshToken: 'refresh-1' }),
      );
    vi.stubGlobal('fetch', fetchMock);
    try {
      const token = await pollCursorAuth('https://example.test', 'uuid', 'verifier', {
        initialIntervalMs: 1,
        maxAttempts: 5,
      });
      expect(token.accessToken).toBe('access-1');
      expect(token.refreshToken).toBe('refresh-1');
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const pollUrl = String(fetchMock.mock.calls[1]?.[0]);
      expect(pollUrl).toContain('/auth/poll?');
      expect(pollUrl).toContain('uuid=uuid');
      expect(pollUrl).toContain('verifier=verifier');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('runs deep-link flow: authorize URL then poll', async () => {
    const polled: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL) => {
      polled.push(String(input));
      return jsonResponse({ accessToken: 'a', refreshToken: 'r' });
    });
    vi.stubGlobal('fetch', fetchMock);
    const urls: string[] = [];
    try {
      const token = await runCursorDeepLinkFlow(CURSOR_PROFILE.flow, {
        onAuthorizeUrl: (url) => {
          urls.push(url);
        },
        initialIntervalMs: 1,
        maxAttempts: 3,
      });
      expect(urls).toHaveLength(1);
      expect(urls[0]).toContain('loginDeepControl');
      expect(urls[0]).toContain('challenge=');
      expect(polled[0]).toContain('verifier=');
      const info = toCursorTokenInfo(token);
      expect(info.accessToken).toBe('a');
      expect(info.refreshToken).toBe('r');
      expect(info.tokenType).toBe('Bearer');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('refreshes via exchange_user_api_key with Bearer refresh token', async () => {
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      if (String(input).includes('exchange_user_api_key')) {
        expect(init?.headers).toMatchObject(
          expect.objectContaining({
            Authorization: 'Bearer refresh-token',
          }),
        );
        return jsonResponse({ accessToken: jwtWithExp(Math.floor(Date.now() / 1000) + 2_000) });
      }
      return jsonResponse({ error: 'nope' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const token = await refreshCursorToken(CURSOR_PROFILE.flow, 'refresh-token');
      expect(token.accessToken.length).toBeGreaterThan(0);
      expect(token.refreshToken).toBe('refresh-token');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('PKCE challenge in login URL matches SHA-256 of poll verifier', async () => {
    let loginUrl = '';
    const fetchMock = vi.fn(async (url: string) => {
      const u = new URL(String(url));
      const verifier = u.searchParams.get('verifier') ?? '';
      const challenge = new URL(loginUrl).searchParams.get('challenge') ?? '';
      const expected = base64url(createHash('sha256').update(verifier).digest());
      expect(challenge).toBe(expected);
      return jsonResponse({ accessToken: 'ok', refreshToken: 'r' });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      await runCursorDeepLinkFlow(CURSOR_PROFILE.flow, {
        onAuthorizeUrl: (url) => {
          loginUrl = url;
        },
        initialIntervalMs: 1,
        maxAttempts: 2,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
