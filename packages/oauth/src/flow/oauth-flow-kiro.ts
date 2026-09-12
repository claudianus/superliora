/**
 * Kiro (Amazon Q Developer) OAuth flow via AWS SSO OIDC.
 *
 * Implements the device-code authorization flow and token refresh using the
 * published AWS SSO OIDC service model (sso-oidc/2019-06-10): register a
 * public client, start device authorization, poll `createToken` until the user
 * completes the Browser Builder ID sign-in, then refresh with the same grant.
 * Refresh re-registers a public client when no registration is cached —
 * registration is free and avoids persisting client secrets.
 */

import { OAuthError } from '../errors';
import type { TokenInfo } from '../types';

const KIRO_TOKEN_TIMEOUT_MS = 30_000;
/** Default AWS region for SSO OIDC. */
export const KIRO_DEFAULT_REGION = 'us-east-1';
/** Builder ID start URL for device authorization. */
export const KIRO_BUILDER_ID_START_URL = 'https://view.awsapps.com/start';
const KIRO_CLIENT_NAME = 'liora-cli';
const KIRO_CLIENT_TYPE = 'public';
/** Published scopes for the CodeWhisperer service. */
export const KIRO_SCOPES = [
  'codewhisperer:completions',
  'codewhisperer:analysis',
  'codewhisperer:conversations',
  'codewhisperer:transformations',
  'codewhisperer:taskassist',
  'sso:account:access',
] as const;

interface KiroClientRegistration {
  clientId: string;
  clientSecret: string;
  clientSecretExpiresAt?: number;
}

interface KiroDeviceAuth {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}

interface KiroTokenResponse {
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  error?: string;
  error_description?: string;
}

function envOr(name: string, fallback: string): string {
  const value = process.env[name];
  return value !== undefined && value.trim().length > 0 ? value.trim() : fallback;
}

function resolveRegion(): string {
  return envOr('SUPERLIORA_KIRO_REGION', KIRO_DEFAULT_REGION);
}

function ssoOidcEndpoint(region: string, path: string): string {
  return `https://oidc.${region}.amazonaws.com${path}`;
}

function requestSignal(signal: AbortSignal | undefined): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(KIRO_TOKEN_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

async function postOidc(
  region: string,
  path: string,
  body: Record<string, unknown>,
  label: string,
  signal: AbortSignal | undefined,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(ssoOidcEndpoint(region, path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: requestSignal(signal),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new OAuthError(`Kiro ${label} request failed: ${String(error)}`);
  }
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new OAuthError(`Kiro ${label} request failed: ${String(response.status)} ${JSON.stringify(data)}`);
  }
  return data;
}

async function registerClient(region: string, signal: AbortSignal | undefined): Promise<KiroClientRegistration> {
  const data = await postOidc(
    region,
    '/client/register',
    {
      clientName: KIRO_CLIENT_NAME,
      clientType: KIRO_CLIENT_TYPE,
      scopes: [...KIRO_SCOPES],
      grantTypes: ['urn:ietf:params:oauth:grant-type:device_code', 'refresh_token'],
      issuerUrl: KIRO_BUILDER_ID_START_URL,
    },
    'client register',
    signal,
  );
  const clientId = data['clientId'];
  const clientSecret = data['clientSecret'];
  if (typeof clientId !== 'string' || typeof clientSecret !== 'string') {
    throw new OAuthError('Kiro client registration response missing clientId/clientSecret.');
  }
  return {
    clientId,
    clientSecret,
    ...(typeof data['clientSecretExpiresAt'] === 'number'
      ? { clientSecretExpiresAt: data['clientSecretExpiresAt'] }
      : {}),
  };
}

/** Single-flight registration cache; a fresh public client costs nothing. */
let cachedRegistration: KiroClientRegistration | undefined;

/** Drops the cached public-client registration (tests / region switches). */
export function resetKiroRegistrationCache(): void {
  cachedRegistration = undefined;
}

/** Starts device authorization and returns the user-code prompt payload. */
export async function requestKiroDeviceAuthorization(
  options: { readonly signal?: AbortSignal } = {},
): Promise<{ authorization: KiroDeviceAuth; region: string }> {
  const region = resolveRegion();
  const registration = cachedRegistration ?? (await registerClient(region, options.signal));
  cachedRegistration = registration;
  const data = await postOidc(
    region,
    '/device_authorization',
    {
      clientId: registration.clientId,
      clientSecret: registration.clientSecret,
      startUrl: KIRO_BUILDER_ID_START_URL,
    },
    'device authorization',
    options.signal,
  );
  const deviceCode = data['deviceCode'];
  const userCode = data['userCode'];
  const verificationUri = data['verificationUri'];
  if (typeof deviceCode !== 'string' || typeof userCode !== 'string' || typeof verificationUri !== 'string') {
    throw new OAuthError('Kiro device authorization response missing deviceCode/userCode/verificationUri.');
  }
  return {
    region,
    authorization: {
      deviceCode,
      userCode,
      verificationUri,
      verificationUriComplete:
        typeof data['verificationUriComplete'] === 'string' ? data['verificationUriComplete'] : verificationUri,
      expiresIn: typeof data['expiresIn'] === 'number' ? data['expiresIn'] : 600,
      interval: typeof data['interval'] === 'number' ? data['interval'] : 5,
    },
  };
}

/** Polls `createToken` with the device code until the user approves or the code expires. */
export async function pollKiroDeviceToken(
  authorization: KiroDeviceAuth,
  region: string,
  options: {
    readonly signal?: AbortSignal;
    readonly onRetry?: (delayMs: number) => Promise<void> | void;
  } = {},
): Promise<TokenInfo> {
  const registration = cachedRegistration;
  if (registration === undefined) {
    throw new OAuthError('Kiro client registration missing; call requestKiroDeviceAuthorization first.');
  }
  const intervalMs = Math.max(authorization.interval, 1) * 1000;
  for (;;) {
    if (options.signal?.aborted) throw new OAuthError('Login cancelled.');
    const data = (await postOidc(
      region,
      '/token',
      {
        clientId: registration.clientId,
        clientSecret: registration.clientSecret,
        deviceCode: authorization.deviceCode,
        grantType: 'urn:ietf:params:oauth:grant-type:device_code',
      },
      'create token',
      options.signal,
    )) as KiroTokenResponse;
    if (typeof data.accessToken === 'string') {
      return kiroTokenFromResponse(data);
    }
    const error = data.error ?? '';
    if (error === 'authorization_pending' || error === 'slow_down') {
      const delay = error === 'slow_down' ? intervalMs * 2 : intervalMs;
      await (options.onRetry !== undefined ? options.onRetry(delay) : sleep(delay));
      continue;
    }
    if (error === 'expired_token') throw new OAuthError('Kiro device code expired; restart the login.');
    if (error === 'access_denied') throw new OAuthError('Kiro authorization was denied.');
    throw new OAuthError(`Kiro device token poll failed: ${error || JSON.stringify(data)}`);
  }
}

function kiroTokenFromResponse(data: KiroTokenResponse): TokenInfo {
  const expiresIn = typeof data.expiresIn === 'number' ? data.expiresIn : 28800;
  return {
    accessToken: data.accessToken ?? '',
    refreshToken: data.refreshToken ?? '',
    expiresAt: Math.floor(Date.now() / 1000) + expiresIn,
    scope: KIRO_SCOPES.join(' '),
    tokenType: 'Bearer',
    expiresIn,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Refreshes the access token; re-registers a public client when none is cached. */
export async function refreshKiroToken(
  refreshToken: string,
  options: { readonly signal?: AbortSignal } = {},
): Promise<TokenInfo> {
  const region = resolveRegion();
  const registration = cachedRegistration ?? (await registerClient(region, options.signal));
  cachedRegistration = registration;
  const data = (await postOidc(
    region,
    '/token',
    {
      clientId: registration.clientId,
      clientSecret: registration.clientSecret,
      grantType: 'refresh_token',
      refreshToken,
    },
    'token refresh',
    options.signal,
  )) as KiroTokenResponse;
  if (typeof data.accessToken !== 'string') {
    throw new OAuthError(`Kiro token refresh failed: ${data.error ?? 'missing access token'}`);
  }
  const expiresIn = typeof data.expiresIn === 'number' ? data.expiresIn : 28800;
  return {
    accessToken: data.accessToken,
    refreshToken: typeof data.refreshToken === 'string' ? data.refreshToken : refreshToken,
    expiresAt: Math.floor(Date.now() / 1000) + expiresIn,
    scope: KIRO_SCOPES.join(' '),
    tokenType: 'Bearer',
    expiresIn,
  };
}
