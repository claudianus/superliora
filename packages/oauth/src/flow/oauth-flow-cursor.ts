/**
 * Cursor deep-link PKCE OAuth flow.
 *
 * Unlike loopback PKCE, Cursor CLI login opens a browser URL with a challenge
 * + uuid, then the CLI polls `GET {oauthHost}/auth/poll` until the user
 * confirms in the browser. Refresh uses `POST {oauthHost}/auth/refresh` with
 * the refresh token as a Bearer credential.
 *
 * Endpoints mirror the official Cursor CLI / community clients (shunt,
 * pi-cursor). Unofficial — Cursor may change the contract.
 */

import { randomUUID } from 'node:crypto';

import { OAuthConnectionError, OAuthError, OAuthUnauthorizedError } from '../errors';
import type { TokenInfo } from '../types';
import { isRecord } from '../utils';
import { generatePkcePair, postJson } from './oauth-flow-http';
import type { ProviderFlowConfig } from '../profiles';

const DEFAULT_POLL_ATTEMPTS = 150;
const DEFAULT_POLL_INTERVAL_MS = 1_000;
const MAX_POLL_INTERVAL_MS = 10_000;
const POLL_BACKOFF = 1.2;
const DEFAULT_EXPIRES_IN_SEC = 3_600;
/** Refresh a few minutes before JWT expiry when we can read `exp`. */
const EXPIRY_SKEW_SEC = 120;

export interface CursorTokenExchange {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
  readonly apiKey?: string;
}

export interface RunCursorDeepLinkFlowOptions {
  readonly onAuthorizeUrl?: (url: string) => Promise<void> | void;
  readonly signal?: AbortSignal;
  /** Override poll attempts (tests). */
  readonly maxAttempts?: number;
  /** Override initial poll interval ms (tests). */
  readonly initialIntervalMs?: number;
}

/** Builds the Cursor deep-control login URL for a PKCE challenge + uuid. */
export function buildCursorLoginUrl(
  challenge: string,
  uuid: string,
  loginHost = 'https://cursor.com',
): string {
  const base = loginHost.replace(/\/$/, '');
  const params = new URLSearchParams({
    challenge,
    uuid,
    mode: 'login',
    redirectTarget: 'cli',
  });
  return `${base}/loginDeepControl?${params.toString()}`;
}

/**
 * Runs the Cursor deep-link PKCE login: open browser URL, poll until tokens
 * arrive, return a {@link CursorTokenExchange}.
 */
export async function runCursorDeepLinkFlow(
  flow: ProviderFlowConfig,
  options: RunCursorDeepLinkFlowOptions = {},
): Promise<CursorTokenExchange> {
  const { verifier, challenge } = generatePkcePair();
  const uuid = randomUUID();
  const loginHost = flow.authorizeUrl?.replace(/\/loginDeepControl.*$/, '') ?? 'https://cursor.com';
  const loginUrl = buildCursorLoginUrl(challenge, uuid, loginHost);

  await options.onAuthorizeUrl?.(loginUrl);

  return pollCursorAuth(flow.oauthHost, uuid, verifier, {
    signal: options.signal,
    maxAttempts: options.maxAttempts,
    initialIntervalMs: options.initialIntervalMs,
  });
}

/** Polls Cursor auth until the browser login completes or times out. */
export async function pollCursorAuth(
  oauthHost: string,
  uuid: string,
  verifier: string,
  options: {
    readonly signal?: AbortSignal;
    readonly maxAttempts?: number;
    readonly initialIntervalMs?: number;
  } = {},
): Promise<CursorTokenExchange> {
  const host = oauthHost.replace(/\/$/, '');
  const maxAttempts = options.maxAttempts ?? DEFAULT_POLL_ATTEMPTS;
  let delayMs = options.initialIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  let lastNetworkError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (options.signal?.aborted) {
      throw new OAuthError('Cursor login cancelled.');
    }

    const url = `${host}/auth/poll?uuid=${encodeURIComponent(uuid)}&verifier=${encodeURIComponent(verifier)}`;
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        signal: options.signal,
      });
    } catch (error) {
      if (options.signal?.aborted) {
        throw new OAuthError('Cursor login cancelled.');
      }
      lastNetworkError = error;
      await sleep(delayMs, options.signal);
      delayMs = Math.min(delayMs * POLL_BACKOFF, MAX_POLL_INTERVAL_MS);
      continue;
    }

    if (response.status === 404) {
      await sleep(delayMs, options.signal);
      delayMs = Math.min(delayMs * POLL_BACKOFF, MAX_POLL_INTERVAL_MS);
      continue;
    }

    const data = await readJsonObject(response);
    if (!response.ok) {
      throw new OAuthError(
        `Cursor login poll failed (HTTP ${response.status}): ${JSON.stringify(data)}`,
      );
    }

    const parsed = parseCursorTokenResponse(data);
    if (parsed === undefined) {
      throw new OAuthError('Cursor login response missing accessToken.');
    }
    return parsed;
  }

  if (lastNetworkError !== undefined) {
    throw new OAuthConnectionError(
      `Cursor login timed out after repeated network errors: ${
        lastNetworkError instanceof Error ? lastNetworkError.message : String(lastNetworkError)
      }`,
    );
  }
  throw new OAuthError('Cursor login timed out; try again.');
}

/**
 * Refreshes a Cursor access token. The refresh token is sent as a Bearer
 * credential (not a standard OAuth refresh_token form body).
 */
export async function refreshCursorToken(
  flow: ProviderFlowConfig,
  refreshToken: string,
  options: { readonly signal?: AbortSignal } = {},
): Promise<CursorTokenExchange> {
  if (refreshToken.trim().length === 0) {
    throw new OAuthUnauthorizedError('Cursor refresh token missing; re-login required.');
  }
  const host = flow.oauthHost.replace(/\/$/, '');
  // Recent Cursor CLI clients use exchange_user_api_key; older ones used
  // /auth/refresh. Try the current endpoint first, then fall back.
  const endpoints = [`${host}/auth/exchange_user_api_key`, `${host}/auth/refresh`];
  let status = 0;
  let data: Record<string, unknown> = {};
  for (const url of endpoints) {
    const result = await postJson(
      url,
      {},
      {
        signal: options.signal,
        headers: {
          Authorization: `Bearer ${refreshToken}`,
        },
      },
    );
    status = result.status;
    data = result.data;
    if (status >= 200 && status < 300) break;
    if (status === 401 || status === 403) break;
  }
  if (status === 401 || status === 403) {
    throw new OAuthUnauthorizedError(
      `Cursor token refresh unauthorized (HTTP ${status}); re-login required.`,
    );
  }
  if (status < 200 || status >= 300) {
    throw new OAuthError(`Cursor token refresh failed (HTTP ${status}).`);
  }
  const parsed = parseCursorTokenResponse(data, refreshToken);
  if (parsed === undefined) {
    throw new OAuthError('Cursor refresh response missing accessToken.');
  }
  return parsed;
}

/** Maps a Cursor token exchange into the shared {@link TokenInfo} shape. */
export function toCursorTokenInfo(token: CursorTokenExchange): TokenInfo {
  const fromJwt = jwtExpiresInSeconds(token.accessToken);
  const expiresIn = fromJwt ?? token.expiresIn;
  return {
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    expiresAt: Math.floor(Date.now() / 1000) + expiresIn,
    scope: '',
    tokenType: 'Bearer',
    expiresIn,
  };
}

/** Parses Cursor camelCase token JSON; preserves prior refresh when omitted. */
export function parseCursorTokenResponse(
  data: Record<string, unknown>,
  previousRefreshToken = '',
): CursorTokenExchange | undefined {
  const accessToken = typeof data['accessToken'] === 'string' ? data['accessToken'] : '';
  if (accessToken.length === 0) return undefined;
  const refreshFromResponse =
    typeof data['refreshToken'] === 'string' ? data['refreshToken'] : undefined;
  const refreshToken = refreshFromResponse ?? previousRefreshToken;
  const fromJwt = jwtExpiresInSeconds(accessToken);
  const apiKey = typeof data['apiKey'] === 'string' ? data['apiKey'] : undefined;
  return {
    accessToken,
    refreshToken,
    expiresIn: fromJwt ?? DEFAULT_EXPIRES_IN_SEC,
    ...(apiKey === undefined ? {} : { apiKey }),
  };
}

/** Reads JWT `exp` and returns seconds until expiry (minus skew), or undefined. */
export function jwtExpiresInSeconds(jwt: string): number | undefined {
  const exp = readJwtExp(jwt);
  if (exp === undefined) return undefined;
  const remaining = exp - Math.floor(Date.now() / 1000) - EXPIRY_SKEW_SEC;
  return Math.max(remaining, 60);
}

function readJwtExp(jwt: string): number | undefined {
  const parts = jwt.split('.');
  if (parts.length < 2 || parts[1] === undefined) return undefined;
  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf8');
    const payload: unknown = JSON.parse(json);
    if (!isRecord(payload)) return undefined;
    const exp = payload['exp'];
    return typeof exp === 'number' && Number.isFinite(exp) ? exp : undefined;
  } catch {
    return undefined;
  }
}

async function readJsonObject(response: Response): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await response.json();
    if (isRecord(parsed)) return parsed;
  } catch {
    // Non-JSON body.
  }
  return {};
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new OAuthError('Cursor login cancelled.'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new OAuthError('Cursor login cancelled.'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
