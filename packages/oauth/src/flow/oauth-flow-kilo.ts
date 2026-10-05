/**
 * Kilo Gateway device authorization — Kilo's bespoke flow, not RFC 8628:
 *
 *   POST {oauthHost}/api/device-auth/codes        → {code, verificationUrl, expiresIn}
 *   GET  {oauthHost}/api/device-auth/codes/{code} → 202 pending |
 *                                                  {status: 'approved', token}
 *
 * The minted token is a gateway API key (not an OAuth grant), so there is no
 * refresh path — the bundle reports a ~1-year expiry and an expired credential
 * re-runs login.
 */

import { OAuthError } from '../errors';
import { isRecord } from '../utils';
import type { DeviceAuthorization, TokenInfo } from '../types';
import type { ProviderFlowConfig } from '../profiles/provider-profile';

const KILO_DEVICE_AUTH_PATH = '/api/device-auth/codes';
const KILO_POLL_INTERVAL_MS = 5_000;
const KILO_TOKEN_TTL_S = 365 * 24 * 60 * 60;

interface KiloDeviceCodeResponse {
  readonly code?: string;
  readonly verificationUrl?: string;
  readonly expiresIn?: number;
}

interface KiloDevicePollResponse {
  readonly status?: string;
  readonly token?: string;
}

export async function runKiloDeviceFlow(
  flow: ProviderFlowConfig,
  options: {
    readonly onDeviceCode?: (auth: DeviceAuthorization) => Promise<void> | void;
    readonly signal?: AbortSignal;
    readonly sleep?: (ms: number) => Promise<void>;
    readonly now?: () => number;
    readonly fetchImpl?: typeof fetch;
  } = {},
): Promise<TokenInfo> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep =
    options.sleep ??
    ((ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      }));
  const now = options.now ?? (() => Date.now());
  const base = `${flow.oauthHost.replace(/\/+$/, '')}${KILO_DEVICE_AUTH_PATH}`;
  const isAborted = (): boolean => options.signal?.aborted === true;

  const initiate = await fetchImpl(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: options.signal,
  });
  if (initiate.status === 429) {
    throw new OAuthError('Too many pending Kilo authorization requests. Please try again later.');
  }
  if (!initiate.ok) {
    throw new OAuthError(`Kilo device authorization failed (HTTP ${initiate.status}).`);
  }
  const body: unknown = await initiate.json();
  const data = isRecord(body) ? (body as KiloDeviceCodeResponse) : {};
  if (
    typeof data.code !== 'string' ||
    data.code.length === 0 ||
    typeof data.verificationUrl !== 'string' ||
    data.verificationUrl.length === 0 ||
    typeof data.expiresIn !== 'number' ||
    data.expiresIn <= 0
  ) {
    throw new OAuthError('Kilo device authorization response is missing required fields.');
  }

  const auth: DeviceAuthorization = {
    userCode: data.code,
    deviceCode: data.code,
    verificationUri: data.verificationUrl,
    verificationUriComplete: data.verificationUrl,
    expiresIn: data.expiresIn,
    interval: KILO_POLL_INTERVAL_MS / 1000,
  };
  await options.onDeviceCode?.(auth);

  const deadline = now() + data.expiresIn * 1000;
  const pollUrl = `${base}/${encodeURIComponent(data.code)}`;
  while (now() < deadline) {
    if (isAborted()) throw new OAuthError('Login aborted by caller');
    await sleep(KILO_POLL_INTERVAL_MS);
    const poll = await fetchImpl(pollUrl, { signal: options.signal });
    if (poll.status === 202) continue;
    if (poll.status === 403) {
      throw new OAuthError('Kilo authorization was denied.');
    }
    if (poll.status === 410) {
      throw new OAuthError('Kilo authorization code expired. Please try again.');
    }
    if (!poll.ok) {
      throw new OAuthError(`Kilo device polling failed (HTTP ${poll.status}).`);
    }
    const pollBody: unknown = await poll.json();
    const pollData = isRecord(pollBody) ? (pollBody as KiloDevicePollResponse) : {};
    if (pollData.status === 'approved' && typeof pollData.token === 'string' && pollData.token.length > 0) {
      const nowS = Math.floor(now() / 1000);
      return {
        accessToken: pollData.token,
        refreshToken: '',
        expiresAt: nowS + KILO_TOKEN_TTL_S,
        scope: '',
        tokenType: 'Bearer',
        expiresIn: KILO_TOKEN_TTL_S,
      };
    }
    if (pollData.status === 'denied') {
      throw new OAuthError('Kilo authorization was denied.');
    }
    if (pollData.status === 'expired') {
      throw new OAuthError('Kilo authorization code expired. Please try again.');
    }
  }
  throw new OAuthError('Kilo authentication timed out. Please try again.');
}
