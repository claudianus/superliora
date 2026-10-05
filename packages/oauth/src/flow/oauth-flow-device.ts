/**
 * Generic RFC 8628 device-authorization flow.
 *
 * Unlike `oauth.ts` (which is hardwired to the Kimi `/api/oauth/*` paths and
 * device headers), this flow takes explicit endpoints off the profile's
 * {@link ProviderFlowConfig}: `deviceCodeUrl` and `tokenUrl`. It covers the
 * variants third-party providers ship:
 *
 *  - optional `scope` on the device-code request (Qwen, Nous),
 *  - optional PKCE S256 — `code_challenge` on the request, `code_verifier`
 *    on the poll (Qwen requires it),
 *  - `resource_url`/`endpoint` capture on the token response (Qwen assigns a
 *    per-account inference endpoint),
 *  - an extra refresh-token header when the provider requires it
 *    (`refreshTokenHeader`, e.g. Nous Portal's `x-nous-refresh-token`).
 */

import { OAuthError, OAuthUnauthorizedError } from '../errors';
import { extractApiErrorMessage } from '../api-error';
import { isRecord } from '../utils';
import type { DeviceAuthorization, TokenInfo } from '../types';
import type { ProviderFlowConfig } from '../profiles/provider-profile';
import { generatePkcePair, postForm, postJson } from './oauth-flow-http';

const DEFAULT_POLL_INTERVAL_S = 5;
const DEVICE_FLOW_TIMEOUT_MS = 15 * 60 * 1000;

function deviceCodeUrl(flow: ProviderFlowConfig): string {
  return flow.deviceCodeUrl ?? `${flow.oauthHost.replace(/\/$/, '')}/api/oauth/device/code`;
}

function tokenUrl(flow: ProviderFlowConfig): string {
  return flow.tokenUrl ?? `${flow.oauthHost.replace(/\/$/, '')}/api/oauth/token`;
}

function pickError(data: Record<string, unknown>, status: number): string {
  return extractApiErrorMessage(data) ?? `HTTP ${status}`;
}

/**
 * Derives a TTL from a JWT access token's `exp` claim. Some portals (Nous)
 * issue a JWT and omit `expires_in`; the claim is authoritative for the
 * token's real lifetime.
 */
function jwtExpiresInSeconds(accessToken: string): number | undefined {
  const parts = accessToken.split('.');
  if (parts.length !== 3 || parts[1] === undefined) return undefined;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    const exp = payload['exp'];
    if (typeof exp !== 'number' || !Number.isFinite(exp)) return undefined;
    const ttl = Math.floor(exp - Date.now() / 1000);
    return ttl > 0 ? ttl : undefined;
  } catch {
    return undefined;
  }
}

function tokenFromResponse(
  payload: Record<string, unknown>,
  expiry: ProviderFlowConfig['tokenExpiry'],
): TokenInfo {
  const accessToken = payload['access_token'];
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    throw new OAuthError('OAuth response missing access_token');
  }
  const refreshToken = payload['refresh_token'];
  const expiresIn = Number(payload['expires_in']);
  const ttl =
    Number.isFinite(expiresIn) && expiresIn > 0
      ? expiresIn
      : jwtExpiresInSeconds(accessToken);
  if (ttl === undefined) {
    // `jwt_or_never` providers (Meta Muse Code) omit `expires_in` and issue no
    // JWT exp — the credential is session-bound and never expires client-side.
    if (expiry === 'jwt_or_never') {
      return {
        accessToken,
        refreshToken: typeof refreshToken === 'string' ? refreshToken : '',
        expiresAt: 0,
        scope: typeof payload['scope'] === 'string' ? payload['scope'] : '',
        tokenType: typeof payload['token_type'] === 'string' ? payload['token_type'] : 'Bearer',
        expiresIn: 0,
      };
    }
    throw new OAuthError('OAuth response missing or invalid expires_in');
  }
  // Qwen returns the per-account inference endpoint as `resource_url` (or the
  // legacy `endpoint` alias); persist it so connect can adopt it as baseUrl.
  const resourceUrl =
    typeof payload['resource_url'] === 'string' && payload['resource_url'].length > 0
      ? payload['resource_url']
      : typeof payload['endpoint'] === 'string' && payload['endpoint'].length > 0
        ? payload['endpoint']
        : undefined;
  return {
    accessToken,
    refreshToken: typeof refreshToken === 'string' ? refreshToken : '',
    expiresAt: Math.floor(Date.now() / 1000) + ttl,
    scope: typeof payload['scope'] === 'string' ? payload['scope'] : '',
    tokenType: typeof payload['token_type'] === 'string' ? payload['token_type'] : 'Bearer',
    expiresIn: ttl,
    ...(resourceUrl === undefined ? {} : { resourceUrl }),
  };
}

function parseDeviceAuthorization(data: Record<string, unknown>): DeviceAuthorization {
  const userCode = data['user_code'];
  const deviceCode = data['device_code'];
  if (typeof userCode !== 'string' || userCode.length === 0) {
    throw new OAuthError('Device authorization response missing user_code');
  }
  if (typeof deviceCode !== 'string' || deviceCode.length === 0) {
    throw new OAuthError('Device authorization response missing device_code');
  }
  const verificationUri =
    typeof data['verification_uri'] === 'string' ? data['verification_uri'] : '';
  const verificationUriComplete =
    typeof data['verification_uri_complete'] === 'string' &&
    data['verification_uri_complete'].length > 0
      ? data['verification_uri_complete']
      : verificationUri;
  return {
    userCode,
    deviceCode,
    verificationUri,
    verificationUriComplete,
    expiresIn: typeof data['expires_in'] === 'number' ? data['expires_in'] : null,
    interval: Number(data['interval'] ?? DEFAULT_POLL_INTERVAL_S),
  };
}

/**
 * Runs the full device flow: request → `onDeviceCode` → poll until approved.
 * Restarts on `expired_token` until the 15-minute budget runs out.
 */
export async function runDeviceCodeFlow(
  flow: ProviderFlowConfig,
  options: {
    readonly onDeviceCode?: (auth: DeviceAuthorization) => Promise<void> | void;
    readonly signal?: AbortSignal;
    readonly sleep?: (ms: number) => Promise<void>;
    readonly now?: () => number;
  } = {},
): Promise<TokenInfo> {
  const sleep =
    options.sleep ??
    ((ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      }));
  const now = options.now ?? (() => Date.now());
  const deadline = now() + DEVICE_FLOW_TIMEOUT_MS;

  const pkce = flow.pkce === true ? generatePkcePair() : undefined;
  // Read through a function so TS does not narrow `aborted` after the first
  // check — the flag flips asynchronously between polls.
  const isAborted = (): boolean => options.signal?.aborted === true;

  for (;;) {
    if (isAborted()) throw new OAuthError('Login aborted by caller');
    const params: Record<string, string> = { client_id: flow.clientId };
    if (flow.scope !== undefined && flow.scope.length > 0) params['scope'] = flow.scope;
    if (pkce !== undefined) {
      params['code_challenge'] = pkce.challenge;
      params['code_challenge_method'] = pkce.method;
    }
    const { status, data } = await postForm(deviceCodeUrl(flow), params, {
      signal: options.signal,
      headers: { 'x-request-id': globalThis.crypto.randomUUID(), ...flow.requestHeaders },
    });
    if (status !== 200) {
      throw new OAuthError(`Device authorization failed: ${pickError(data, status)}`);
    }
    const auth = parseDeviceAuthorization(data);
    await options.onDeviceCode?.(auth);

    let interval = Math.max(auth.interval, 1);
    for (;;) {
      if (isAborted()) throw new OAuthError('Login aborted by caller');
      if (now() >= deadline) {
        throw new OAuthError('Device authorization timed out.');
      }
      const pollParams: Record<string, string> = {
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        client_id: flow.clientId,
        device_code: auth.deviceCode,
      };
      if (pkce !== undefined) pollParams['code_verifier'] = pkce.verifier;
      const poll = await postForm(tokenUrl(flow), pollParams, {
        signal: options.signal,
        ...(flow.requestHeaders !== undefined ? { headers: { ...flow.requestHeaders } } : {}),
      });
      if (poll.status === 200 && typeof poll.data['access_token'] === 'string') {
        const granted = tokenFromResponse(poll.data, flow.tokenExpiry);
        return runPostExchange(flow, granted, options.signal);
      }
      const errorCode = typeof poll.data['error'] === 'string' ? poll.data['error'] : '';
      if (errorCode === 'authorization_pending' || errorCode === 'slow_down') {
        if (errorCode === 'slow_down') interval += 5;
        await sleep(interval * 1000);
        continue;
      }
      if (errorCode === 'expired_token') break; // outer loop re-requests a code
      if (errorCode === 'access_denied') {
        throw new OAuthError(
          `Authorization denied${pickError(poll.data, poll.status) ? `: ${pickError(poll.data, poll.status)}` : ''}`,
        );
      }
      throw new OAuthError(`Device token polling failed: ${pickError(poll.data, poll.status)}`);
    }
  }
}

/** Standard `refresh_token` grant against the provider's token endpoint. */
export async function refreshDeviceCodeToken(
  flow: ProviderFlowConfig,
  refreshToken: string,
  options: { readonly signal?: AbortSignal } = {},
): Promise<TokenInfo> {
  const headers: Record<string, string> = {};
  if (flow.refreshTokenHeader !== undefined) {
    headers[flow.refreshTokenHeader] = refreshToken;
  }
  const { status, data } = await postForm(
    tokenUrl(flow),
    {
      grant_type: 'refresh_token',
      client_id: flow.clientId,
      refresh_token: refreshToken,
    },
    { signal: options.signal, headers },
  );
  if (status === 200 && typeof data['access_token'] === 'string') {
    return tokenFromResponse(data, flow.tokenExpiry);
  }
  const errorCode = typeof data['error'] === 'string' ? data['error'] : '';
  if (status === 401 || status === 403 || errorCode === 'invalid_grant') {
    throw new OAuthUnauthorizedError(`Token refresh unauthorized: ${pickError(data, status)}`);
  }
  throw new OAuthError(`Token refresh failed: ${pickError(data, status)}`);
}

const MUSE_CODE_KEY_URL = 'https://api.meta.ai/muse-code/key';
const MUSE_CODE_API_VERSION = '1.0.0';

/**
 * Post-exchange hook dispatch. `muse_key` exchanges the Meta account token for
 * the Muse Code model API key and stores `{ accessToken: apiKey,
 * refreshToken: oauthAccessToken }` — model requests authenticate with the
 * minted key while the account token stays available for re-minting.
 */
async function runPostExchange(
  flow: ProviderFlowConfig,
  granted: TokenInfo,
  signal: AbortSignal | undefined,
): Promise<TokenInfo> {
  if (flow.postExchange === 'muse_key') {
    return mintMuseCodeKey(granted, signal);
  }
  if (flow.postExchange === 'factory_region') {
    return resolveFactoryDroidScope(granted, signal);
  }
  return granted;
}

const FACTORY_WHOAMI_TIMEOUT_MS = 15_000;

/**
 * `GET {factoryHost}/api/cli/whoami` — resolves the Factory account scope:
 * `orgId` (the `X-Factory-Org-Id` header value), residency `region` (selects
 * the API host) and `inferenceRegion` (eligible upstreams). Falls back to the
 * WorkOS JWT's `external_org_id` claim when the response omits `orgId`.
 * Login fails closed when no organization resolves.
 */
async function resolveFactoryDroidScope(
  granted: TokenInfo,
  signal: AbortSignal | undefined,
): Promise<TokenInfo> {
  const orgFromJwt = jwtClaimString(granted.accessToken, 'external_org_id');
  const response = await fetch('https://api.factory.ai/api/cli/whoami', {
    headers: {
      Authorization: `Bearer ${granted.accessToken}`,
      Accept: 'application/json',
      ...(orgFromJwt !== undefined ? { 'X-Factory-Org-Id': orgFromJwt } : {}),
    },
    signal: signal !== undefined ? AbortSignal.any([signal, AbortSignal.timeout(FACTORY_WHOAMI_TIMEOUT_MS)]) : AbortSignal.timeout(FACTORY_WHOAMI_TIMEOUT_MS),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new OAuthError(
      `Factory identity check failed (${response.status})${text.length > 0 ? `: ${text.slice(0, 200)}` : ''}`,
    );
  }
  const body: unknown = await response.json();
  if (!isRecord(body)) {
    throw new OAuthError('Factory identity check returned an invalid response');
  }
  const orgId =
    typeof body['orgId'] === 'string' && body['orgId'].length > 0 ? body['orgId'] : orgFromJwt;
  if (orgId === undefined) {
    throw new OAuthError('Factory login did not resolve an organization');
  }
  const region =
    body['region'] === 'eu' || body['region'] === 'global' ? body['region'] : undefined;
  const inferenceRegion =
    body['inferenceRegion'] === 'global' ||
    body['inferenceRegion'] === 'eu' ||
    body['inferenceRegion'] === 'us'
      ? body['inferenceRegion']
      : region === 'eu'
        ? 'eu'
        : 'global';
  return { ...granted, orgId, region, inferenceRegion };
}

/** Reads a string claim from a JWT payload without verifying the signature (the server verifies). */
function jwtClaimString(token: string, claim: string): string | undefined {
  const segment = token.split('.')[1];
  if (segment === undefined) return undefined;
  try {
    const payload: unknown = JSON.parse(
      Buffer.from(segment, 'base64url').toString('utf8'),
    );
    if (!isRecord(payload)) return undefined;
    const value = payload[claim];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * `POST api.meta.ai/muse-code/key` — mints the subscription-authorized model
 * API key. Fails the login on an inactive subscription or a payment-required
 * response so a keyless bundle is never stored.
 */
async function mintMuseCodeKey(
  granted: TokenInfo,
  signal: AbortSignal | undefined,
): Promise<TokenInfo> {
  const { status, data } = await postJson(
    MUSE_CODE_KEY_URL,
    { onboard: true },
    {
      signal,
      headers: {
        Authorization: `Bearer ${granted.accessToken}`,
        'x-api-version': MUSE_CODE_API_VERSION,
      },
    },
  );
  const apiKey = data['api_key'];
  const isActive = data['is_subs_active'];
  if (status === 200 && typeof apiKey === 'string' && apiKey.length > 0) {
    return { ...granted, accessToken: apiKey, refreshToken: granted.accessToken };
  }
  if (isActive === false) {
    throw new OAuthError('Muse Code subscription is inactive.');
  }
  const actionUrl =
    typeof data['action_url'] === 'string' && data['action_url'].length > 0
      ? data['action_url']
      : typeof data['require_payment_action_url'] === 'string'
        ? data['require_payment_action_url']
        : undefined;
  if (data['require_payment'] === true || actionUrl !== undefined) {
    throw new OAuthError(
      `Muse Code requires a subscription action${actionUrl !== undefined ? `: ${actionUrl}` : ''}`,
    );
  }
  const detail =
    typeof data['error'] === 'string'
      ? data['error']
      : typeof data['message'] === 'string'
        ? data['message']
        : `HTTP ${String(status)}`;
  throw new OAuthError(`Muse Code key exchange failed: ${detail}`);
}
