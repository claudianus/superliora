/**
 * xAI (Grok) OAuth flow — standard OAuth 2.0 PKCE authorization-code with a
 * loopback browser callback. Endpoints are resolved via OIDC discovery at
 * runtime when a `discoveryUrl` is set, otherwise fall back to the configured
 * authorize/token URLs.
 *
 * The access token is a Bearer token for `https://api.x.ai/v1`.
 */

import { OAuthError, OAuthUnauthorizedError } from './errors';
import type { TokenInfo } from './types';
import {
  generateNonce,
  generatePkcePair,
  generateState,
  getJson,
  postForm,
  startCallbackServer,
  waitForCallbackOrManual,
  type PkcePair,
} from './oauth-flow-http';
import type { ProviderFlowConfig } from './profiles';

interface OidcDiscovery {
  readonly authorization_endpoint?: string;
  readonly token_endpoint?: string;
}

export interface XaiTokenExchange {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
  readonly scope: string;
  readonly tokenType: string;
}

/** Resolves authorize/token endpoints via OIDC discovery when available. */
export async function resolveXaiEndpoints(
  flow: ProviderFlowConfig,
  options: { readonly signal?: AbortSignal } = {},
): Promise<{ readonly authorizeUrl: string; readonly tokenUrl: string }> {
  if (flow.discoveryUrl !== undefined) {
    try {
      const doc = await getJson<OidcDiscovery>(flow.discoveryUrl, { signal: options.signal });
      if (typeof doc.authorization_endpoint === 'string' && typeof doc.token_endpoint === 'string') {
        return { authorizeUrl: doc.authorization_endpoint, tokenUrl: doc.token_endpoint };
      }
    } catch {
      // Fall back to configured URLs below.
    }
  }
  return {
    authorizeUrl: flow.authorizeUrl ?? `${flow.oauthHost}/oauth/authorize`,
    tokenUrl: flow.tokenUrl ?? `${flow.oauthHost}/oauth2/token`,
  };
}

/** Exchanges an authorization code for a token bundle. */
export async function exchangeXaiToken(
  flow: ProviderFlowConfig,
  code: string,
  codeVerifier: string,
  redirectUri: string,
  tokenUrl: string,
  options: { readonly signal?: AbortSignal } = {},
): Promise<XaiTokenExchange> {
  const { status, data } = await postForm(
    tokenUrl,
    {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: flow.clientId,
      code_verifier: codeVerifier,
    },
    { signal: options.signal },
  );
  if (status === 401 || status === 403) {
    throw new OAuthUnauthorizedError('xAI token exchange unauthorized.');
  }
  if (status !== 200 || typeof data['access_token'] !== 'string') {
    throw new OAuthError(`xAI token exchange failed (HTTP ${status}).`);
  }
  return extractTokenBundle(data);
}

/** Refreshes an xAI access token. */
export async function refreshXaiToken(
  flow: ProviderFlowConfig,
  refreshToken: string,
  tokenUrl: string,
  options: { readonly signal?: AbortSignal } = {},
): Promise<XaiTokenExchange> {
  const { status, data } = await postForm(
    tokenUrl,
    {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: flow.clientId,
    },
    { signal: options.signal },
  );
  if (status === 401 || status === 403) {
    throw new OAuthUnauthorizedError('xAI token refresh unauthorized.');
  }
  if (status !== 200 || typeof data['access_token'] !== 'string') {
    throw new OAuthError(`xAI token refresh failed (HTTP ${status}).`);
  }
  return extractTokenBundle(data);
}

/**
 * Runs the xAI PKCE browser flow: discovers endpoints, starts a loopback
 * server, builds the authorize URL, and waits for the callback. The caller
 * opens the URL. Returns the token bundle.
 */
export async function runXaiBrowserFlow(
  flow: ProviderFlowConfig,
  options: {
    readonly onAuthorizeUrl?: (url: string) => Promise<void> | void;
    /**
     * Optional fallback when the browser cannot reach the loopback callback
     * server. The caller prompts the user to paste the callback URL/code.
     */
    readonly onManualCallbackPrompt?: (context: {
      readonly signal: AbortSignal;
      readonly lastError?: string;
    }) => Promise<string | undefined>;
    readonly signal?: AbortSignal;
  } = {},
): Promise<XaiTokenExchange> {
  const { authorizeUrl, tokenUrl } = await resolveXaiEndpoints(flow, { signal: options.signal });
  const pkce = generatePkcePair();
  const state = generateState();
  const nonce = generateNonce();
  const port = flow.callbackPort ?? 56121;
  const server = await startCallbackServer(port, flow.callbackHost);
  try {
    const url = buildXaiAuthorizeUrl(flow, pkce, state, nonce, server.redirectUri, authorizeUrl);
    await options.onAuthorizeUrl?.(url);
    const { code } = await waitForCallbackOrManual(server, {
      signal: options.signal,
      expectedState: state,
      onManualCallbackPrompt: options.onManualCallbackPrompt,
    });
    return exchangeXaiToken(flow, code, pkce.verifier, server.redirectUri, tokenUrl, {
      signal: options.signal,
    });
  } finally {
    await server.close();
  }
}

function buildXaiAuthorizeUrl(
  flow: ProviderFlowConfig,
  pkce: PkcePair,
  state: string,
  nonce: string,
  redirectUri: string,
  authorizeUrl: string,
): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: flow.clientId,
    redirect_uri: redirectUri,
    scope: flow.scope ?? 'openid profile email offline_access',
    code_challenge: pkce.challenge,
    code_challenge_method: pkce.method,
    state,
    nonce,
  });
  return `${authorizeUrl}?${params.toString()}`;
}

function extractTokenBundle(data: Record<string, unknown>): XaiTokenExchange {
  const accessToken = data['access_token'];
  const refreshToken = data['refresh_token'];
  const expiresIn = Number(data['expires_in']);
  if (typeof accessToken !== 'string' || typeof refreshToken !== 'string') {
    throw new OAuthError('xAI token response missing access_token or refresh_token.');
  }
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new OAuthError('xAI token response has invalid expires_in.');
  }
  return {
    accessToken,
    refreshToken,
    expiresIn,
    scope: typeof data['scope'] === 'string' ? data['scope'] : '',
    tokenType: typeof data['token_type'] === 'string' ? data['token_type'] : 'Bearer',
  };
}

/** Normalizes an xAI token exchange into the shared {@link TokenInfo} shape. */
export function toTokenInfo(token: XaiTokenExchange): TokenInfo {
  return {
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    expiresAt: Math.floor(Date.now() / 1000) + token.expiresIn,
    scope: token.scope,
    tokenType: token.tokenType,
    expiresIn: token.expiresIn,
  };
}
