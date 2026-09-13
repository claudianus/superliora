import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildGlmZcodeAuthorizeUrl,
  exchangeGlmZcodeCode,
  redactGlmZcodeSecrets,
  refreshGlmZcodeToken,
} from '../src/flow/oauth-flow-glm-zcode';
import { OAuthError } from '../src/errors';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Stubs the full broker → z/login → getCustomerInfo → api_keys → copy chain. */
type FetchMock = (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) => Promise<Response>;

function stubProvisionChain(fetchMock: ReturnType<typeof vi.fn<FetchMock>>): void {
  fetchMock
    .mockImplementation(async (input, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/v1/oauth/token')) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body['provider']).toBe('zai');
        expect(body['redirect_uri']).toBe('zcode://oauth/callback');
        return jsonResponse({
          data: { token: 'zcode-jwt-token', zai: { access_token: 'upstream-access' } },
        });
      }
      if (url.includes('/api/auth/z/login')) {
        expect(JSON.parse(String(init?.body))).toEqual({ token: 'upstream-access' });
        return jsonResponse({ data: { access_token: 'business-token' } });
      }
      if (url.includes('/getCustomerInfo')) {
        return jsonResponse({
          data: {
            id: 42,
            email: 'User@Example.com',
            organizations: [
              {
                organizationId: 'org-1',
                projects: [{ projectId: 'proj-1' }, { projectId: 'proj-default', isDefault: true }],
              },
            ],
          },
        });
      }
      if (url.includes('/api_keys/copy/key-9')) {
        return jsonResponse({ data: { secretKey: 'secret-9' } });
      }
      if (url.includes('/api_keys') && init?.method === 'POST') {
        return jsonResponse({ data: { apiKey: 'key-9' } });
      }
      if (url.includes('/api_keys')) {
        return jsonResponse({ data: [] });
      }
      return jsonResponse({ error: `unexpected url ${url}` }, 500);
    });
}

describe('glm-zcode OAuth flow', () => {
  it('builds the authorize URL with the custom-protocol redirect', () => {
    const url = new URL(buildGlmZcodeAuthorizeUrl('state-123'));
    expect(url.origin + url.pathname).toBe('https://chat.z.ai/api/oauth/authorize');
    expect(url.searchParams.get('redirect_uri')).toBe('zcode://oauth/callback');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toContain('client_');
    expect(url.searchParams.get('state')).toBe('state-123');
  });

  it('exchanges a pasted redirect URL for a provisioned Z.AI API key', async () => {
    const fetchMock = vi.fn();
    stubProvisionChain(fetchMock);
    vi.stubGlobal('fetch', fetchMock);

    const token = await exchangeGlmZcodeCode(
      'zcode://oauth/callback?code=auth-code&state=state-123',
      'state-123',
    );

    expect(token.accessToken).toBe('key-9.secret-9');
    // The upstream Z.AI token is stored as the refresh credential.
    expect(token.refreshToken).toBe('upstream-access');
    expect(token.tokenType).toBe('Bearer');
    expect(token.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('accepts a bare authorization code', async () => {
    const fetchMock = vi.fn();
    stubProvisionChain(fetchMock);
    vi.stubGlobal('fetch', fetchMock);

    const token = await exchangeGlmZcodeCode('authorization-code-abc123', 'state-123');
    expect(token.accessToken).toBe('key-9.secret-9');
  });

  it('rejects a paste whose state does not match the flow', async () => {
    await expect(
      exchangeGlmZcodeCode('zcode://oauth/callback?code=x&state=other', 'state-123'),
    ).rejects.toBeInstanceOf(OAuthError);
  });

  it('surfaces broker failures without leaking tokens', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'boom eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig_abc123' }, 500)),
    );
    await expect(exchangeGlmZcodeCode('authorization-code-abc123', 'state-123')).rejects.toThrow(
      /GLM ZCode broker request failed: 500.*\[redacted-jwt\]/,
    );
  });

  it('re-provisions the API key from the stored upstream token on refresh', async () => {
    const fetchMock = vi.fn();
    stubProvisionChain(fetchMock);
    vi.stubGlobal('fetch', fetchMock);

    const token = await refreshGlmZcodeToken('upstream-access');
    expect(token.accessToken).toBe('key-9.secret-9');
    expect(token.refreshToken).toBe('upstream-access');
  });

  it('requires re-login when the upstream token is missing', async () => {
    await expect(refreshGlmZcodeToken('   ')).rejects.toThrow(/require re-login/);
  });

  it('honors endpoint env overrides', async () => {
    vi.stubEnv('SUPERLIORA_ZCODE_OAUTH_AUTHORIZE_URL', 'https://zai.example.test/oauth/authorize');
    vi.stubEnv('SUPERLIORA_ZCODE_OAUTH_REDIRECT_URI', 'zcode://example/callback');
    const url = new URL(buildGlmZcodeAuthorizeUrl('s'));
    expect(url.origin + url.pathname).toBe('https://zai.example.test/oauth/authorize');
    expect(url.searchParams.get('redirect_uri')).toBe('zcode://example/callback');
  });

  it('redacts long secrets and JWTs', () => {
    const redacted = redactGlmZcodeSecrets(
      'jwt: eyJaXd0.abc123.signature tail secretvalue123456789012345678901234567890123456789',
    );
    expect(redacted).toContain('[redacted-jwt]');
    expect(redacted).toContain('[redacted]');
    expect(redacted).not.toContain('eyJaXd0');
    expect(redacted).not.toContain('secretvalue1234');
  });
});
