import { OAuthError } from '../errors';
import type { TokenInfo } from '../types';
import type { ProviderFlowConfig } from '../profiles/provider-profile';
import {
  generatePkcePair,
  postJson,
  startCallbackServer,
  waitForCallbackOrManual,
  type ManualCallbackPromptContext,
} from './oauth-flow-http';

const DEVIN_CALLBACK_PORT = 59653;
const DEVIN_CALLBACK_HOST = '127.0.0.1';
/** Devin session tokens are JWTs; when `exp` is absent the session is ~1 year. */
const DEVIN_EXPIRY_FALLBACK_SECONDS = 31_536_000;

/** Devin's `exp` claim carries the real session lifetime; fall back to 1 year. */
function devinTokenTtlSeconds(token: string): number {
  const parts = token.split('.');
  if (parts.length === 3 && parts[1] !== undefined) {
    try {
      const payload = JSON.parse(
        Buffer.from(parts[1], 'base64url').toString('utf8'),
      ) as Record<string, unknown>;
      const exp = payload['exp'];
      if (typeof exp === 'number' && Number.isFinite(exp)) {
        const ttl = Math.floor(exp - Date.now() / 1000);
        if (ttl > 0) return ttl;
      }
    } catch {
      // Fall through to the fallback TTL.
    }
  }
  return DEVIN_EXPIRY_FALLBACK_SECONDS;
}

/**
 * Devin CLI login: authorization-code + PKCE against
 * `app.devin.ai/auth/cli/continue` with a `127.0.0.1:59653/callback` loopback,
 * then a JSON token exchange `{code, code_verifier}` at
 * `api.devin.ai/auth/cli/token` returning `{ token: "<session-jwt>" }`.
 *
 * Devin issues no refresh token — the session JWT is long-lived (~1 year) and
 * `expiresAt` comes from its `exp` claim when present.
 */
export async function runDevinPkceFlow(
  flow: ProviderFlowConfig,
  options: {
    readonly onAuthorizeUrl?: (url: string) => Promise<void> | void;
    readonly onManualCallbackPrompt?: (
      context: ManualCallbackPromptContext,
    ) => Promise<string | undefined>;
    readonly signal?: AbortSignal;
  } = {},
): Promise<TokenInfo> {
  const authorizeUrl = flow.authorizeUrl;
  const tokenUrl = flow.tokenUrl;
  if (authorizeUrl === undefined || tokenUrl === undefined) {
    throw new OAuthError('Devin OAuth flow requires authorizeUrl and tokenUrl.');
  }

  const pkce = generatePkcePair();
  const state = crypto.randomUUID();
  const port = flow.callbackPort ?? DEVIN_CALLBACK_PORT;
  const redirectHost = flow.callbackHost ?? DEVIN_CALLBACK_HOST;
  const server = await startCallbackServer(port, redirectHost, { expectedState: state });
  try {
    const params = new URLSearchParams({
      response_type: 'code',
      redirect_uri: server.redirectUri,
      code_challenge: pkce.challenge,
      code_challenge_method: pkce.method,
      state,
      prompt: 'select_account',
    });
    await options.onAuthorizeUrl?.(`${authorizeUrl}?${params.toString()}`);
    const { code } = await waitForCallbackOrManual(server, {
      signal: options.signal,
      expectedState: state,
      onManualCallbackPrompt: options.onManualCallbackPrompt,
    });

    const { status, data } = await postJson(
      tokenUrl,
      { code, code_verifier: pkce.verifier },
      { signal: options.signal, headers: { Accept: 'application/json' } },
    );
    const token = data['token'];
    if (status !== 200 || typeof token !== 'string' || token.length === 0) {
      const message =
        typeof data['error_description'] === 'string'
          ? data['error_description']
          : typeof data['error'] === 'string'
            ? data['error']
            : typeof data['message'] === 'string'
              ? data['message']
              : `HTTP ${String(status)}`;
      throw new OAuthError(`Devin token exchange failed: ${message}`);
    }
    const ttl = devinTokenTtlSeconds(token);
    return {
      accessToken: token,
      refreshToken: '',
      expiresAt: Math.floor(Date.now() / 1000) + ttl,
      scope: '',
      tokenType: 'Bearer',
      expiresIn: ttl,
    };
  } finally {
    await server.close();
  }
}
