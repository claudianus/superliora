/**
 * OpenAI Codex / ChatGPT OAuth flow.
 *
 * Two strategies against `https://auth.openai.com` (public client id shared
 * with the official Codex CLI):
 *
 *   1. **Custom device-code flow** (default for terminals without a browser):
 *        POST /api/accounts/deviceauth/usercode  → { device_auth_id, user_code, interval }
 *        user visits https://auth.openai.com/codex/device and enters the code
 *        POST /api/accounts/deviceauth/token      (poll; 403/404 = pending, 200 = approved)
 *          → { authorization_code, code_verifier }
 *        POST /oauth/token                         (authorization_code grant)
 *          → token bundle
 *
 *   2. **PKCE browser flow**:
 *        serve localhost:1455/callback
 *        open authorize URL → callback ?code= → POST /oauth/token
 *
 * The resulting access token is a Bearer token for the ChatGPT Codex backend.
 */

import { OAuthError, OAuthUnauthorizedError } from './errors';
import type { DeviceAuthorization, TokenInfo } from './types';
import {
  generatePkcePair,
  generateState,
  postForm,
  postJson,
  startCallbackServer,
  type CallbackServer,
  type PkcePair,
} from './oauth-flow-http';
import type { ProviderFlowConfig } from './profiles';

export interface OpenAIDeviceCode {
  readonly deviceAuthId: string;
  readonly userCode: string;
  readonly interval: number;
  readonly verificationUri: string;
}

export interface OpenAITokenExchange {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
  readonly scope: string;
  readonly tokenType: string;
}

type Sleep = (ms: number) => Promise<void>;
const defaultSleep: Sleep = (ms) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/** Requests a user code from the OpenAI device-authorization endpoint. */
export async function requestOpenAiUserCode(
  flow: ProviderFlowConfig,
  options: { readonly signal?: AbortSignal } = {},
): Promise<OpenAIDeviceCode> {
  const url = `${flow.oauthHost}/api/accounts/deviceauth/usercode`;
  const { status, data } = await postJson(url, { client_id: flow.clientId }, { signal: options.signal });
  if (status !== 200) {
    throw new OAuthError(`OpenAI user code request failed (HTTP ${status}).`);
  }
  const deviceAuthId = data['device_auth_id'];
  const userCode = data['user_code'];
  const interval = data['interval'];
  if (typeof deviceAuthId !== 'string' || typeof userCode !== 'string') {
    throw new OAuthError('OpenAI device authorization response missing required fields.');
  }
  return {
    deviceAuthId,
    userCode,
    interval: typeof interval === 'number' ? Math.max(interval, 1) : 5,
    verificationUri: `${flow.oauthHost}/codex/device`,
  };
}

/**
 * Polls the OpenAI device-token endpoint until the user approves. Returns the
 * `authorization_code` + `code_verifier` pair on success.
 */
export async function pollOpenAiDeviceToken(
  flow: ProviderFlowConfig,
  deviceCode: OpenAIDeviceCode,
  options: {
    readonly signal?: AbortSignal;
    readonly sleep?: Sleep;
    readonly timeoutMs?: number;
  } = {},
): Promise<{ readonly authorizationCode: string; readonly codeVerifier: string }> {
  const sleep = options.sleep ?? defaultSleep;
  const deadline = Date.now() + (options.timeoutMs ?? 15 * 60 * 1000);
  const url = `${flow.oauthHost}/api/accounts/deviceauth/token`;

  let interval = deviceCode.interval;
  while (true) {
    if (options.signal?.aborted === true) throw new OAuthError('Authorization aborted');
    if (Date.now() >= deadline) throw new OAuthError('OpenAI device authorization timed out.');

    const { status, data } = await postJson(
      url,
      { device_auth_id: deviceCode.deviceAuthId, user_code: deviceCode.userCode },
      { signal: options.signal },
    );
    // 403/404 → still pending; the user hasn't approved yet.
    if (status === 200) {
      const authorizationCode = data['authorization_code'];
      const codeVerifier = data['code_verifier'];
      if (typeof authorizationCode !== 'string' || typeof codeVerifier !== 'string') {
        throw new OAuthError('OpenAI device token response missing authorization_code.');
      }
      return { authorizationCode, codeVerifier };
    }
    if (status === 403 || status === 404) {
      await sleep(Math.max(interval, 1) * 1000);
      continue;
    }
    throw new OAuthError(`OpenAI device token polling failed (HTTP ${status}).`);
  }
}

/** Exchanges an authorization code for a token bundle. */
export async function exchangeOpenAiToken(
  flow: ProviderFlowConfig,
  code: string,
  codeVerifier: string,
  redirectUri: string,
  options: { readonly signal?: AbortSignal } = {},
): Promise<OpenAITokenExchange> {
  const url = flow.tokenUrl ?? `${flow.oauthHost}/oauth/token`;
  const { status, data } = await postForm(
    url,
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
    throw new OAuthUnauthorizedError('OpenAI token exchange unauthorized.');
  }
  if (status !== 200 || typeof data['access_token'] !== 'string') {
    throw new OAuthError(`OpenAI token exchange failed (HTTP ${status}).`);
  }
  return extractTokenBundle(data);
}

/** Refreshes an OpenAI access token using a refresh token. */
export async function refreshOpenAiToken(
  flow: ProviderFlowConfig,
  refreshToken: string,
  options: { readonly signal?: AbortSignal } = {},
): Promise<OpenAITokenExchange> {
  const url = flow.tokenUrl ?? `${flow.oauthHost}/oauth/token`;
  const { status, data } = await postForm(
    url,
    {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: flow.clientId,
    },
    { signal: options.signal },
  );
  if (status === 401 || status === 403) {
    throw new OAuthUnauthorizedError('OpenAI token refresh unauthorized.');
  }
  if (status !== 200 || typeof data['access_token'] !== 'string') {
    throw new OAuthError(`OpenAI token refresh failed (HTTP ${status}).`);
  }
  return extractTokenBundle(data);
}

function extractTokenBundle(data: Record<string, unknown>): OpenAITokenExchange {
  const accessToken = data['access_token'];
  const refreshToken = data['refresh_token'];
  const expiresIn = Number(data['expires_in']);
  if (typeof accessToken !== 'string' || typeof refreshToken !== 'string') {
    throw new OAuthError('OpenAI token response missing access_token or refresh_token.');
  }
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new OAuthError('OpenAI token response has invalid expires_in.');
  }
  return {
    accessToken,
    refreshToken,
    expiresIn,
    scope: typeof data['scope'] === 'string' ? data['scope'] : '',
    tokenType: typeof data['token_type'] === 'string' ? data['token_type'] : 'Bearer',
  };
}

/**
 * Runs the OpenAI device-code flow end-to-end and calls `onUserCode` so the
 * caller can display the code + verification URL. Returns the token bundle.
 */
export async function runOpenAiDeviceFlow(
  flow: ProviderFlowConfig,
  options: {
    readonly onUserCode?: (auth: OpenAIDeviceCode) => Promise<void> | void;
    readonly signal?: AbortSignal;
    readonly sleep?: Sleep;
    readonly timeoutMs?: number;
  } = {},
): Promise<OpenAITokenExchange> {
  const deviceCode = await requestOpenAiUserCode(flow, { signal: options.signal });
  await options.onUserCode?.(deviceCode);
  const { authorizationCode, codeVerifier } = await pollOpenAiDeviceToken(flow, deviceCode, {
    signal: options.signal,
    sleep: options.sleep,
    timeoutMs: options.timeoutMs,
  });
  return exchangeOpenAiToken(
    flow,
    authorizationCode,
    codeVerifier,
    `${flow.oauthHost}/deviceauth/callback`,
    { signal: options.signal },
  );
}

/**
 * Runs the OpenAI PKCE browser flow: starts a loopback server, builds the
 * authorize URL, and waits for the callback. The caller opens the URL.
 * Returns the token bundle.
 */
export async function runOpenAiBrowserFlow(
  flow: ProviderFlowConfig,
  options: {
    readonly onAuthorizeUrl?: (url: string) => Promise<void> | void;
    readonly signal?: AbortSignal;
  } = {},
): Promise<OpenAITokenExchange> {
  const pkce = generatePkcePair();
  const state = generateState();
  const port = flow.callbackPort ?? 1455;
  const server = await startCallbackServer(port, flow.callbackHost);
  try {
    const authorizeUrl = buildOpenAiAuthorizeUrl(flow, pkce, state, server.redirectUri);
    await options.onAuthorizeUrl?.(authorizeUrl);
    const { code } = await server.waitForCallback(options.signal);
    return exchangeOpenAiToken(flow, code, pkce.verifier, server.redirectUri, {
      signal: options.signal,
    });
  } finally {
    await server.close();
  }
}

function buildOpenAiAuthorizeUrl(
  flow: ProviderFlowConfig,
  pkce: PkcePair,
  state: string,
  redirectUri: string,
): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: flow.clientId,
    redirect_uri: redirectUri,
    scope: flow.scope ?? 'openid profile email offline_access',
    code_challenge: pkce.challenge,
    code_challenge_method: pkce.method,
    state,
    codex_cli_simplified_flow: 'true',
  });
  const base = flow.authorizeUrl ?? `${flow.oauthHost}/oauth/authorize`;
  return `${base}?${params.toString()}`;
}

/** Converts an OpenAI device code into the shared {@link DeviceAuthorization} shape. */
export function toDeviceAuthorization(deviceCode: OpenAIDeviceCode): DeviceAuthorization {
  return {
    userCode: deviceCode.userCode,
    deviceCode: deviceCode.deviceAuthId,
    verificationUri: deviceCode.verificationUri,
    verificationUriComplete: `${deviceCode.verificationUri}?code=${deviceCode.userCode}`,
    expiresIn: null,
    interval: deviceCode.interval,
  };
}

// Re-export for the flow runner.
export type { CallbackServer };

/** Normalizes an OpenAI token exchange into the shared {@link TokenInfo} shape. */
export function toTokenInfo(token: OpenAITokenExchange): TokenInfo {
  return {
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    expiresAt: Math.floor(Date.now() / 1000) + token.expiresIn,
    scope: token.scope,
    tokenType: token.tokenType,
    expiresIn: token.expiresIn,
  };
}
