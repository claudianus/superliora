/**
 * GLM ZCode OAuth flow (UNOFFICIAL, opt-in).
 *
 * Mirrors how the ZCode desktop app turns a Z.AI login into usable GLM model
 * access. This is NOT an official Z.AI OAuth client: it reuses ZCode's
 * authorize page, broker, and a custom-protocol redirect, so the CLI cannot
 * catch the callback and the user pastes the final redirect URL (or the bare
 * code) instead. It may break at any time and may violate ZCode/Z.AI Terms of
 * Service. Endpoints / client id are overridable via `SUPERLIORA_ZCODE_OAUTH_*`
 * environment variables.
 *
 * Flow shape (ported from the gajae-code reference implementation):
 *   1. Authorize: GET {authorize}?redirect_uri=zcode://oauth/callback&response_type=code&client_id=...&state=...
 *   2. Broker:    POST {broker} { provider: "zai", code, redirect_uri, state }
 *                → { data: { token: <ZCode JWT>, zai: { access_token: <upstream Z.AI token> } } }
 *   3. Business:  POST {z/login} { token: <upstream Z.AI token> }
 *                → { data: { access_token: <business token> } }
 *   4. Provision: GET getCustomerInfo → default org/project,
 *                GET/POST .../api_keys (find/create "zcode-api-key"),
 *                GET .../api_keys/copy/{id} → secretKey ⇒ Z.AI API key "{id}.{secret}".
 *
 * Token mapping (superliora `TokenInfo`):
 *   - `accessToken`  = the provisioned Z.AI API key ("{id}.{secret}"). Requests go
 *     to `https://api.z.ai/api/anthropic` with `Authorization: Bearer <key>`
 *     (exactly like a dashboard key) — no zcode.z.ai gateway involved.
 *   - `refreshToken` = the upstream Z.AI OAuth access token, used to re-provision
 *     the API key when it is revoked. The key itself is long-lived, so `expiresAt`
 *     is pinned far in the future.
 */

import { OAuthError } from '../errors';
import type { TokenInfo } from '../types';
import { parseOAuthCallbackInput } from './oauth-flow-http';

const GLM_ZCODE_TOKEN_TIMEOUT_MS = 30_000;
/** Provisioned API keys are long-lived; pin expiry far out so refresh never races. */
const GLM_ZCODE_API_KEY_TTL_SEC = 10 * 365 * 24 * 60 * 60;
/** Name ZCode gives the API key it auto-provisions. */
const GLM_ZCODE_API_KEY_NAME = 'zcode-api-key';

/** Default endpoints / client id; each is overridable via the matching env var. */
export const GLM_ZCODE_OAUTH_AUTHORIZE_URL = 'https://chat.z.ai/api/oauth/authorize';
export const GLM_ZCODE_OAUTH_CLIENT_ID = 'client_P8X5CMWmlaRO9gyO-KSqtg';
export const GLM_ZCODE_OAUTH_REDIRECT_URI = 'zcode://oauth/callback';
export const GLM_ZCODE_OAUTH_BROKER_TOKEN_URL = 'https://zcode.z.ai/api/v1/oauth/token';
export const GLM_ZCODE_ZAI_LOGIN_URL = 'https://api.z.ai/api/auth/z/login';
export const GLM_ZCODE_USERINFO_URL = 'https://chat.z.ai/api/oauth/userinfo';
/** Z.AI business API base (customer / org / project / api-key management). */
export const GLM_ZCODE_ZAI_API_BASE = 'https://api.z.ai';
/** Model API base — the provisioned key is used here, exactly like a dashboard key. */
export const GLM_ZCODE_ANTHROPIC_BASE_URL = 'https://api.z.ai/api/anthropic';

type FetchImpl = typeof globalThis.fetch;

export interface GlmZcodeEndpoints {
  readonly authorizeUrl: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly brokerTokenUrl: string;
  readonly zaiLoginUrl: string;
  readonly userinfoUrl: string;
  readonly zaiApiBase: string;
}

function envOr(name: string, fallback: string): string {
  const value = process.env[name];
  return value !== undefined && value.trim().length > 0 ? value.trim() : fallback;
}

/** Resolves the endpoints, applying the `SUPERLIORA_ZCODE_OAUTH_*` overrides. */
export function resolveGlmZcodeEndpoints(): GlmZcodeEndpoints {
  return {
    authorizeUrl: envOr('SUPERLIORA_ZCODE_OAUTH_AUTHORIZE_URL', GLM_ZCODE_OAUTH_AUTHORIZE_URL),
    clientId: envOr('SUPERLIORA_ZCODE_OAUTH_CLIENT_ID', GLM_ZCODE_OAUTH_CLIENT_ID),
    redirectUri: envOr('SUPERLIORA_ZCODE_OAUTH_REDIRECT_URI', GLM_ZCODE_OAUTH_REDIRECT_URI),
    brokerTokenUrl: envOr('SUPERLIORA_ZCODE_OAUTH_BROKER_TOKEN_URL', GLM_ZCODE_OAUTH_BROKER_TOKEN_URL),
    zaiLoginUrl: envOr('SUPERLIORA_ZCODE_OAUTH_ZAI_LOGIN_URL', GLM_ZCODE_ZAI_LOGIN_URL),
    userinfoUrl: envOr('SUPERLIORA_ZCODE_OAUTH_USERINFO_URL', GLM_ZCODE_USERINFO_URL),
    zaiApiBase: envOr('SUPERLIORA_ZCODE_OAUTH_ZAI_API_BASE', GLM_ZCODE_ZAI_API_BASE).replace(/\/+$/, ''),
  };
}

/** Builds the authorize URL the user must open in a browser. */
export function buildGlmZcodeAuthorizeUrl(state: string, endpoints = resolveGlmZcodeEndpoints()): string {
  const params = new URLSearchParams({
    redirect_uri: endpoints.redirectUri,
    response_type: 'code',
    client_id: endpoints.clientId,
    state,
  });
  return `${endpoints.authorizeUrl}?${params.toString()}`;
}

/** Mask token-like substrings so broker / upstream / business tokens never leak into errors. */
export function redactGlmZcodeSecrets(text: string): string {
  return text
    .replaceAll(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted-jwt]')
    .replaceAll(/[A-Za-z0-9_-]{40,}/g, '[redacted]');
}

function validateHttpsEndpoint(rawUrl: string, label: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new OAuthError(`GLM ZCode ${label} endpoint is not a valid URL.`);
  }
  if (parsed.protocol !== 'https:') {
    throw new OAuthError(`GLM ZCode ${label} endpoint must use https.`);
  }
  return parsed.toString().replace(/\/+$/, '');
}

function requestSignal(signal: AbortSignal | undefined): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(GLM_ZCODE_TOKEN_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function postJson(
  fetchImpl: FetchImpl,
  url: string,
  body: Record<string, unknown>,
  label: string,
  signal: AbortSignal | undefined,
  bearer?: string,
): Promise<unknown> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (bearer !== undefined) headers['Authorization'] = `Bearer ${bearer}`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: requestSignal(signal),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new OAuthError(`GLM ZCode ${label} request failed: ${redactGlmZcodeSecrets(String(error))}`);
  }
  if (!response.ok) {
    throw new OAuthError(
      `GLM ZCode ${label} request failed: ${response.status} ${redactGlmZcodeSecrets(await response.text())}`,
    );
  }
  return (await response.json()) as unknown;
}

async function getJson(
  fetchImpl: FetchImpl,
  url: string,
  bearer: string,
  label: string,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${bearer}` },
      signal: requestSignal(signal),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new OAuthError(`GLM ZCode ${label} request failed: ${redactGlmZcodeSecrets(String(error))}`);
  }
  if (!response.ok) {
    throw new OAuthError(
      `GLM ZCode ${label} request failed: ${response.status} ${redactGlmZcodeSecrets(await response.text())}`,
    );
  }
  return (await response.json()) as unknown;
}

interface JwtPayload {
  readonly sub?: unknown;
  readonly email?: unknown;
}

function decodeJwtPayload(token: string): JwtPayload | undefined {
  const parts = token.split('.');
  const payload = parts[1];
  if (parts.length !== 3 || payload === undefined || payload.length === 0) return undefined;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as JwtPayload;
  } catch {
    return undefined;
  }
}

interface GlmZcodeIdentity {
  readonly email?: string;
  readonly accountId?: string;
}

function parseBrokerResponse(payload: unknown): { upstreamZaiAccess: string; zcodeToken: string } {
  const data = isRecord(payload) && isRecord(payload['data']) ? payload['data'] : undefined;
  const zcodeToken = data !== undefined && typeof data['token'] === 'string' ? data['token'] : undefined;
  const zai = data !== undefined && isRecord(data['zai']) ? data['zai'] : undefined;
  const upstreamZaiAccess =
    zai !== undefined && typeof zai['access_token'] === 'string' ? zai['access_token'] : undefined;
  if (zcodeToken === undefined || upstreamZaiAccess === undefined) {
    throw new OAuthError('GLM ZCode broker response missing data.token or data.zai.access_token.');
  }
  return { upstreamZaiAccess, zcodeToken };
}

async function resolveBusinessToken(
  fetchImpl: FetchImpl,
  upstreamZaiAccess: string,
  signal: AbortSignal | undefined,
  endpoints: GlmZcodeEndpoints,
): Promise<string> {
  const zaiLoginUrl = validateHttpsEndpoint(endpoints.zaiLoginUrl, 'z/login');
  const payload = await postJson(
    fetchImpl,
    zaiLoginUrl,
    { token: upstreamZaiAccess },
    'z/login',
    signal,
  );
  const data = isRecord(payload) && isRecord(payload['data']) ? payload['data'] : undefined;
  const access = data !== undefined && typeof data['access_token'] === 'string' ? data['access_token'] : undefined;
  if (access === undefined) throw new OAuthError('GLM ZCode z/login response missing data.access_token.');
  return access;
}

function pickDefaultOrgProject(customerInfo: unknown): {
  organizationId: string;
  projectId: string;
  email?: string;
  accountId?: string;
} {
  const data = isRecord(customerInfo) && isRecord(customerInfo['data']) ? customerInfo['data'] : customerInfo;
  const root = isRecord(data) ? data : {};
  const orgs = Array.isArray(root['organizations']) ? root['organizations'] : [];
  const org = orgs.find((entry) => isRecord(entry) && entry['isDefault'] === true) ?? orgs[0];
  const organizationId =
    isRecord(org) && typeof org['organizationId'] === 'string' ? org['organizationId'] : undefined;
  const projects = isRecord(org) && Array.isArray(org['projects']) ? org['projects'] : [];
  const project = projects.find((entry) => isRecord(entry) && entry['isDefault'] === true) ?? projects[0];
  const projectId =
    isRecord(project) && typeof project['projectId'] === 'string' ? project['projectId'] : undefined;
  if (organizationId === undefined || projectId === undefined) {
    throw new OAuthError('GLM ZCode getCustomerInfo response missing default organization/project.');
  }
  const email = typeof root['email'] === 'string' && root['email'].length > 0
    ? root['email'].toLowerCase()
    : undefined;
  const rawId = root['id'];
  const accountId = typeof rawId === 'string' ? rawId : typeof rawId === 'number' ? String(rawId) : undefined;
  return { organizationId, projectId, email, accountId };
}

/**
 * Provision (or reuse) a Z.AI API key named "zcode-api-key" using the business
 * token. Returns "{apiKeyId}.{secretKey}" plus identity hints from the
 * customer info response.
 */
async function provisionZaiApiKey(
  fetchImpl: FetchImpl,
  businessToken: string,
  signal: AbortSignal | undefined,
  endpoints: GlmZcodeEndpoints,
): Promise<{ apiKey: string; identity: GlmZcodeIdentity }> {
  const customerInfo = await getJson(
    fetchImpl,
    `${endpoints.zaiApiBase}/api/biz/customer/getCustomerInfo`,
    businessToken,
    'getCustomerInfo',
    signal,
  );
  const { organizationId, projectId, email, accountId } = pickDefaultOrgProject(customerInfo);
  const keysUrl = `${endpoints.zaiApiBase}/api/biz/v1/organization/${organizationId}/projects/${projectId}/api_keys`;

  const listPayload = await getJson(fetchImpl, keysUrl, businessToken, 'api_keys.list', signal);
  const listData = isRecord(listPayload) && Array.isArray(listPayload['data']) ? listPayload['data'] : [];
  const existing = listData.find(
    (entry) => isRecord(entry) && entry['name'] === GLM_ZCODE_API_KEY_NAME,
  );

  let entry: Record<string, unknown> | undefined = isRecord(existing) ? existing : undefined;
  if (entry === undefined) {
    const created = await postJson(
      fetchImpl,
      keysUrl,
      { name: GLM_ZCODE_API_KEY_NAME },
      'api_keys.create',
      signal,
      businessToken,
    );
    entry = isRecord(created) && isRecord(created['data']) ? created['data'] : isRecord(created) ? created : undefined;
  }
  if (entry === undefined) throw new OAuthError('GLM ZCode api_keys response missing the provisioned key.');

  const rawKeyId = typeof entry['apiKey'] === 'string' ? entry['apiKey'].trim() : typeof entry['id'] === 'string' ? entry['id'].trim() : '';
  if (rawKeyId.length === 0) throw new OAuthError('GLM ZCode api_keys response missing apiKey id.');

  const copyPayload = await getJson(
    fetchImpl,
    `${keysUrl}/copy/${encodeURIComponent(rawKeyId)}`,
    businessToken,
    'api_keys.copy',
    signal,
  );
  const copyData = isRecord(copyPayload) && isRecord(copyPayload['data']) ? copyPayload['data'] : copyPayload;
  const secretKey = isRecord(copyData) && typeof copyData['secretKey'] === 'string' ? copyData['secretKey'].trim() : '';
  if (secretKey.length === 0) throw new OAuthError('GLM ZCode api_keys copy response missing secretKey.');

  return { apiKey: `${rawKeyId}.${secretKey}`, identity: { email, accountId } };
}

async function resolveIdentity(
  fetchImpl: FetchImpl,
  upstreamZaiAccess: string,
  fallback: GlmZcodeIdentity,
  jwtCandidates: readonly string[],
  signal: AbortSignal | undefined,
  endpoints: GlmZcodeEndpoints,
): Promise<GlmZcodeIdentity> {
  if (fallback.email !== undefined || fallback.accountId !== undefined) return fallback;
  try {
    const userinfoUrl = validateHttpsEndpoint(endpoints.userinfoUrl, 'userinfo');
    const response = await fetchImpl(userinfoUrl, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${upstreamZaiAccess}` },
      signal: requestSignal(signal),
    });
    if (response.ok) {
      const payload = (await response.json()) as unknown;
      const data = isRecord(payload) && isRecord(payload['data']) ? payload['data'] : isRecord(payload) ? payload : {};
      const email = typeof data['email'] === 'string' && data['email'].length > 0
        ? data['email'].toLowerCase()
        : undefined;
      const rawSub = data['sub'];
      const accountId =
        (typeof data['id'] === 'string' && data['id'].length > 0 ? data['id'] : undefined) ??
        (typeof rawSub === 'string' && rawSub.length > 0 ? rawSub : undefined);
      if (email !== undefined || accountId !== undefined) return { email, accountId };
    }
  } catch {
    // Identity is optional; fall through to JWT hints.
  }
  for (const token of jwtCandidates) {
    const payload = decodeJwtPayload(token);
    const accountId = payload !== undefined && typeof payload.sub === 'string' ? payload.sub : undefined;
    const email = payload !== undefined && typeof payload.email === 'string' ? payload.email.toLowerCase() : undefined;
    if (accountId !== undefined || email !== undefined) return { accountId, email };
  }
  return {};
}

function tokenFromApiKey(apiKey: string, upstreamZaiAccess: string, identity: GlmZcodeIdentity): TokenInfo {
  return {
    accessToken: apiKey,
    refreshToken: upstreamZaiAccess,
    expiresAt: Math.floor(Date.now() / 1000) + GLM_ZCODE_API_KEY_TTL_SEC,
    scope: '',
    tokenType: 'Bearer',
    expiresIn: GLM_ZCODE_API_KEY_TTL_SEC,
  };
}

async function provisionFromUpstream(
  fetchImpl: FetchImpl,
  upstreamZaiAccess: string,
  zcodeTokenForIdentity: string | undefined,
  signal: AbortSignal | undefined,
  endpoints: GlmZcodeEndpoints,
): Promise<TokenInfo> {
  const businessToken = await resolveBusinessToken(fetchImpl, upstreamZaiAccess, signal, endpoints);
  const { apiKey, identity: keyIdentity } = await provisionZaiApiKey(fetchImpl, businessToken, signal, endpoints);
  const identity = await resolveIdentity(
    fetchImpl,
    upstreamZaiAccess,
    keyIdentity,
    [zcodeTokenForIdentity ?? '', businessToken].filter((token) => token.length > 0),
    signal,
    endpoints,
  );
  return tokenFromApiKey(apiKey, upstreamZaiAccess, identity);
}

/**
 * True when a broker rejection means the single-use authorization code is gone
 * (consumed by the ZCode desktop app opening from the browser redirect, or
 * expired). Such codes can never be pasted successfully — the flow must be
 * restarted with a fresh authorize URL.
 */
export function isGlmZcodeCodeConsumedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return GLM_ZCODE_CODE_CONSUMED_PATTERN.test(message);
}

const GLM_ZCODE_CODE_CONSUMED_PATTERN =
  /2007|already\s+(been\s+)?used|single.use|invalid_grant|expired/i;

export interface GlmZcodeExchangeOptions {
  readonly signal?: AbortSignal;
  readonly fetch?: FetchImpl;
}

/**
 * Exchanges a pasted authorization code (or full redirect URL) for a provisioned
 * Z.AI API key. `pastedCallback` may be the raw `zcode://oauth/callback?code=…&state=…`
 * redirect URL, a bare query string, or the bare code.
 */
export async function exchangeGlmZcodeCode(
  pastedCallback: string,
  expectedState: string,
  options: GlmZcodeExchangeOptions = {},
): Promise<TokenInfo> {
  const endpoints = resolveGlmZcodeEndpoints();
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const parsed = parseOAuthCallbackInput(pastedCallback, expectedState);
  const brokerUrl = validateHttpsEndpoint(endpoints.brokerTokenUrl, 'broker');
  const brokerPayload = await postJson(
    fetchImpl,
    brokerUrl,
    { provider: 'zai', code: parsed.code, redirect_uri: endpoints.redirectUri, state: parsed.state },
    'broker',
    options.signal,
  );
  const { upstreamZaiAccess, zcodeToken } = parseBrokerResponse(brokerPayload);
  return provisionFromUpstream(fetchImpl, upstreamZaiAccess, zcodeToken, options.signal, endpoints);
}

/**
 * Re-provisions the Z.AI API key from the stored upstream token. The key itself
 * is long-lived, so this rarely runs; if the upstream token has expired it
 * fails loudly and the user must re-login.
 */
export async function refreshGlmZcodeToken(
  refreshToken: string,
  options: GlmZcodeExchangeOptions = {},
): Promise<TokenInfo> {
  const upstream = refreshToken.trim();
  if (upstream.length === 0) {
    throw new OAuthError(
      'GLM ZCode credentials require re-login; no stored upstream Z.AI token.',
    );
  }
  try {
    return await provisionFromUpstream(
      options.fetch ?? globalThis.fetch,
      upstream,
      undefined,
      options.signal,
      resolveGlmZcodeEndpoints(),
    );
  } catch (error) {
    if (error instanceof OAuthError) {
      throw new OAuthError(
        `GLM ZCode credentials require re-login; re-provisioning the Z.AI API key failed (${error.message})`,
      );
    }
    throw error;
  }
}
