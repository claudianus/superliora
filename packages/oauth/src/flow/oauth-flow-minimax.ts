/**
 * MiniMax user-code OAuth flow (PKCE).
 *
 * MiniMax's coding-plan login is a device-flow variant with its own names:
 * `POST {oauthHost}/oauth/code` issues a `user_code` + portal verification
 * URL; the client then polls `{oauthHost}/oauth/token` with the nonstandard
 * `urn:ietf:params:oauth:grant-type:user_code` grant and the PKCE verifier.
 *
 * Response quirks carried over from the reference implementations
 * (hermes-agent / openclaw):
 *  - `expired_in` (not `expires_in`) may be a TTL in seconds *or* an absolute
 *    unix-ms deadline; values ≥ 1e12 are treated as deadlines.
 *  - `interval` is reported in **milliseconds**.
 *  - Poll responses carry `{status: 'pending' | 'success'}` wrappers instead
 *    of RFC error codes.
 */

import { OAuthError, OAuthUnauthorizedError } from '../errors';
import { extractApiErrorMessage } from '../api-error';
import type { DeviceAuthorization, TokenInfo } from '../types';
import type { ProviderFlowConfig } from '../profiles/provider-profile';
import { generatePkcePair, generateState, postForm } from './oauth-flow-http';

const DEFAULT_POLL_INTERVAL_S = 2;
const USER_CODE_FLOW_TIMEOUT_MS = 15 * 60 * 1000;
const USER_CODE_GRANT = 'urn:ietf:params:oauth:grant-type:user_code';

function codeUrl(flow: ProviderFlowConfig): string {
  return flow.deviceCodeUrl ?? `${flow.oauthHost.replace(/\/$/, '')}/oauth/code`;
}

function tokenUrl(flow: ProviderFlowConfig): string {
  return flow.tokenUrl ?? `${flow.oauthHost.replace(/\/$/, '')}/oauth/token`;
}

function pickError(data: Record<string, unknown>, status: number): string {
  return extractApiErrorMessage(data) ?? `HTTP ${status}`;
}

/** `expired_in`: seconds TTL, or an absolute unix-ms deadline when ≥1e12. */
function normalizeExpiredIn(value: unknown, now: () => number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  if (value >= 1e12) {
    return Math.max(0, Math.round((value - now()) / 1000));
  }
  return Math.round(value);
}

/** MiniMax has served stale `www.minimax.io` verification hosts; normalize. */
function normalizeVerificationUri(uri: unknown): string {
  if (typeof uri !== 'string' || uri.length === 0) return '';
  try {
    const parsed = new URL(uri);
    if (parsed.hostname === 'www.minimax.io') {
      parsed.hostname = 'platform.minimax.io';
      return parsed.toString();
    }
    return uri;
  } catch {
    return uri;
  }
}

function minimaxTokenFromResponse(data: Record<string, unknown>): TokenInfo {
  const accessToken = data['access_token'];
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    throw new OAuthError('MiniMax token response missing access_token');
  }
  const refreshToken = typeof data['refresh_token'] === 'string' ? data['refresh_token'] : '';
  const expiresIn =
    normalizeExpiredIn(data['expired_in'], () => Date.now()) ??
    (typeof data['expires_in'] === 'number' ? data['expires_in'] : 0);
  if (expiresIn <= 0) {
    throw new OAuthError('MiniMax token response missing or invalid expired_in');
  }
  return {
    accessToken,
    refreshToken,
    expiresAt: Math.floor(Date.now() / 1000) + expiresIn,
    scope: typeof data['scope'] === 'string' ? data['scope'] : '',
    tokenType: typeof data['token_type'] === 'string' ? data['token_type'] : 'Bearer',
    expiresIn,
  };
}

export interface RunMinimaxUserCodeFlowOptions {
  readonly onDeviceCode?: (auth: DeviceAuthorization) => Promise<void> | void;
  readonly signal?: AbortSignal;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
}

/**
 * Runs the MiniMax user-code login: code request → `onDeviceCode` (user opens
 * the portal URL and enters the code) → poll until success/timeout.
 */
export async function runMinimaxUserCodeFlow(
  flow: ProviderFlowConfig,
  options: RunMinimaxUserCodeFlowOptions = {},
): Promise<TokenInfo> {
  const sleep =
    options.sleep ??
    ((ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      }));
  const now = options.now ?? (() => Date.now());

  const pkce = generatePkcePair();
  const state = generateState();
  const { status, data } = await postForm(
    codeUrl(flow),
    {
      response_type: 'code',
      client_id: flow.clientId,
      ...(flow.scope === undefined ? {} : { scope: flow.scope }),
      code_challenge: pkce.challenge,
      code_challenge_method: pkce.method,
      state,
    },
    { signal: options.signal, headers: { 'x-request-id': globalThis.crypto.randomUUID() } },
  );
  if (status !== 200) {
    throw new OAuthError(`MiniMax authorization request failed: ${pickError(data, status)}`);
  }
  const userCode = data['user_code'];
  if (typeof userCode !== 'string' || userCode.length === 0) {
    throw new OAuthError('MiniMax authorization response missing user_code');
  }
  const echoedState = typeof data['state'] === 'string' ? data['state'] : '';
  if (echoedState.length > 0 && echoedState !== state) {
    throw new OAuthError('MiniMax authorization response state mismatch.');
  }

  const expiresIn = normalizeExpiredIn(data['expired_in'], now);
  const deadline =
    expiresIn === null
      ? now() + USER_CODE_FLOW_TIMEOUT_MS
      : now() + Math.min(expiresIn * 1000, USER_CODE_FLOW_TIMEOUT_MS);
  const verificationUri = normalizeVerificationUri(data['verification_uri']);
  await options.onDeviceCode?.({
    userCode,
    deviceCode: userCode,
    verificationUri,
    verificationUriComplete: verificationUri,
    expiresIn,
    interval: Math.max(Number(data['interval'] ?? 0) / 1000, DEFAULT_POLL_INTERVAL_S),
  });

  let intervalMs = Math.max(Number(data['interval'] ?? 0), DEFAULT_POLL_INTERVAL_S * 1000);
  for (;;) {
    if (options.signal?.aborted === true) throw new OAuthError('Login aborted by caller');
    if (now() >= deadline) throw new OAuthError('MiniMax authorization timed out.');
    await sleep(intervalMs);

    const poll = await postForm(
      tokenUrl(flow),
      {
        grant_type: USER_CODE_GRANT,
        client_id: flow.clientId,
        user_code: userCode,
        code_verifier: pkce.verifier,
      },
      { signal: options.signal },
    );
    if (poll.status === 200) {
      const statusField = poll.data['status'];
      if (statusField === 'success' || typeof poll.data['access_token'] === 'string') {
        return minimaxTokenFromResponse(poll.data);
      }
      if (statusField === 'pending') continue;
    }
    const errorCode = typeof poll.data['error'] === 'string' ? poll.data['error'] : '';
    if (errorCode === 'authorization_pending' || poll.data['status'] === 'pending') continue;
    if (errorCode === 'slow_down') {
      intervalMs += 5000;
      continue;
    }
    if (errorCode === 'access_denied') {
      throw new OAuthError(`Authorization denied: ${pickError(poll.data, poll.status)}`);
    }
    if (poll.status === 400 || poll.status === 401 || poll.status === 403) {
      throw new OAuthUnauthorizedError(`MiniMax token polling failed: ${pickError(poll.data, poll.status)}`);
    }
    throw new OAuthError(`MiniMax token polling failed: ${pickError(poll.data, poll.status)}`);
  }
}

/** MiniMax refresh: standard `refresh_token` grant against `/oauth/token`. */
export async function refreshMinimaxToken(
  flow: ProviderFlowConfig,
  refreshToken: string,
  options: { readonly signal?: AbortSignal } = {},
): Promise<TokenInfo> {
  const { status, data } = await postForm(
    tokenUrl(flow),
    {
      grant_type: 'refresh_token',
      client_id: flow.clientId,
      refresh_token: refreshToken,
    },
    { signal: options.signal },
  );
  if (status === 200 && typeof data['access_token'] === 'string') {
    return minimaxTokenFromResponse(data);
  }
  const errorCode = typeof data['error'] === 'string' ? data['error'] : '';
  // `refresh_token_reused` means a one-time-use token was replayed — the
  // session is revoked server-side and only a fresh login recovers.
  if (
    status === 401 ||
    status === 403 ||
    errorCode === 'invalid_grant' ||
    errorCode === 'refresh_token_reused'
  ) {
    throw new OAuthUnauthorizedError(`MiniMax token refresh unauthorized: ${pickError(data, status)}`);
  }
  throw new OAuthError(`MiniMax token refresh failed: ${pickError(data, status)}`);
}
