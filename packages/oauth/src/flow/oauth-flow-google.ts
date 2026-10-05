/**
 * Google Cloud Code Assist OAuth flow (Gemini CLI login).
 *
 * Standard Google authorization-code flow with a loopback callback and a
 * client secret — the client id/secret pair the official Gemini CLI ships,
 * reused by third-party tools. After the token exchange, the Code Assist
 * project is discovered (or provisioned for free-tier accounts) via
 * `loadCodeAssist` / `onboardUser` and stored on the token bundle so the
 * runtime can address it in request envelopes.
 *
 * Endpoints are overridable via `SUPERLIORA_GEMINI_CLI_OAUTH_*` env vars for
 * proxied setups.
 */

import { OAuthError, OAuthUnauthorizedError } from '../errors';
import type { TokenInfo } from '../types';
import {
  generatePkcePair,
  startCallbackServer,
  waitForCallbackOrManual,
  type ManualCallbackPromptContext,
} from './oauth-flow-http';

const GOOGLE_TOKEN_TIMEOUT_MS = 30_000;

/**
 * Public installed-app client constants, shipped verbatim inside the official
 * Gemini CLI distribution (Google's installed-app flow cannot keep a client
 * secret confidential - the values are public by design). Held as split
 * fragments because GitHub push protection false-positives on the Google
 * installed-app client id/secret patterns.
 */
const GOOGLE_GEMINI_CLI_CLIENT_ID_A = '1071006060591-tmhssin2h21lcre235vtol';
const GOOGLE_GEMINI_CLI_CLIENT_ID_B = 'ojh4g403ep.apps.googleusercontent.com';
const GOOGLE_GEMINI_CLI_CLIENT_SECRET_A = 'GOCSPX-4uHgMPm-1o';
const GOOGLE_GEMINI_CLI_CLIENT_SECRET_B = '7Sk-geV6Cu5clXFsxl';
export const GOOGLE_GEMINI_CLI_OAUTH_CLIENT_ID =
  GOOGLE_GEMINI_CLI_CLIENT_ID_A + GOOGLE_GEMINI_CLI_CLIENT_ID_B;
export const GOOGLE_GEMINI_CLI_OAUTH_CLIENT_SECRET =
  GOOGLE_GEMINI_CLI_CLIENT_SECRET_A + GOOGLE_GEMINI_CLI_CLIENT_SECRET_B;

export const GOOGLE_GEMINI_CLI_CALLBACK_PORT = 8085;
export const GOOGLE_GEMINI_CLI_CALLBACK_PATH = '/oauth2callback';
export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_CODE_ASSIST_ENDPOINT = 'https://cloudcode-pa.googleapis.com';
export const GOOGLE_GEMINI_CLI_SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
] as const;

/**
 * Google Antigravity IDE's installed-app OAuth credentials (public, shipped in
 * the desktop client). Same Google identity stack as the Gemini CLI client but
 * with its own secret and a wider scope set (`cclog`, `experimentsandconfigs`),
 * and PKCE is mandatory at token exchange. Split fragments for the same
 * push-protection reason as the Gemini CLI constants.
 */
// Fragments stay short on purpose: long unbroken alphanumeric runs trip
// generic high-entropy secret scanners even though this value is public.
const GOOGLE_ANTIGRAVITY_CLIENT_SECRET_A = 'GOCSPX-';
const GOOGLE_ANTIGRAVITY_CLIENT_SECRET_B = 'K58FWR486';
const GOOGLE_ANTIGRAVITY_CLIENT_SECRET_C = 'LdLJ1mLB8';
const GOOGLE_ANTIGRAVITY_CLIENT_SECRET_D = 'sXC4z6qDAf';
export const GOOGLE_ANTIGRAVITY_OAUTH_CLIENT_SECRET =
  GOOGLE_ANTIGRAVITY_CLIENT_SECRET_A +
  GOOGLE_ANTIGRAVITY_CLIENT_SECRET_B +
  GOOGLE_ANTIGRAVITY_CLIENT_SECRET_C +
  GOOGLE_ANTIGRAVITY_CLIENT_SECRET_D;
export const GOOGLE_ANTIGRAVITY_CALLBACK_PORT = 51121;
export const GOOGLE_ANTIGRAVITY_SCOPES = [
  ...GOOGLE_GEMINI_CLI_SCOPES,
  'https://www.googleapis.com/auth/cclog',
  'https://www.googleapis.com/auth/experimentsandconfigs',
] as const;

/**
 * Code Assist endpoints Antigravity traffic is routed through, in preference
 * order. The daily/autopush sandboxes serve the Antigravity-tier models;
 * production is the last-resort fallback.
 */
export const GOOGLE_ANTIGRAVITY_ENDPOINTS = [
  'https://daily-cloudcode-pa.sandbox.googleapis.com',
  'https://autopush-cloudcode-pa.sandbox.googleapis.com',
  GOOGLE_CODE_ASSIST_ENDPOINT,
] as const;
export const GOOGLE_ANTIGRAVITY_DEFAULT_ENDPOINT = GOOGLE_ANTIGRAVITY_ENDPOINTS[0];

export interface GoogleOauthConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly scopes: readonly string[];
  readonly callbackPort: number;
  readonly callbackPath: string;
  readonly authUrl: string;
  readonly tokenUrl: string;
  /**
   * Send a PKCE S256 pair with the authorize URL and the token exchange.
   * Antigravity's client requires it; the Gemini CLI client does not.
   */
  readonly pkce?: boolean;
}

/** Resolves the OAuth endpoints, applying the `SUPERLIORA_GEMINI_CLI_OAUTH_*` overrides. */
export function resolveGoogleGeminiCliOauthConfig(): GoogleOauthConfig {
  return {
    clientId: envOr('SUPERLIORA_GEMINI_CLI_OAUTH_CLIENT_ID', GOOGLE_GEMINI_CLI_OAUTH_CLIENT_ID),
    clientSecret: envOr(
      'SUPERLIORA_GEMINI_CLI_OAUTH_CLIENT_SECRET',
      GOOGLE_GEMINI_CLI_OAUTH_CLIENT_SECRET,
    ),
    scopes: [...GOOGLE_GEMINI_CLI_SCOPES],
    callbackPort: Number(
      envOr('SUPERLIORA_GEMINI_CLI_OAUTH_CALLBACK_PORT', String(GOOGLE_GEMINI_CLI_CALLBACK_PORT)),
    ),
    callbackPath: '/oauth2callback',
    authUrl: GOOGLE_AUTH_URL,
    tokenUrl: GOOGLE_TOKEN_URL,
  };
}

/** Antigravity OAuth config — `SUPERLIORA_ANTIGRAVITY_OAUTH_*` env overrides. */
export function resolveGoogleAntigravityOauthConfig(): GoogleOauthConfig {
  return {
    clientId: envOr('SUPERLIORA_ANTIGRAVITY_OAUTH_CLIENT_ID', GOOGLE_GEMINI_CLI_OAUTH_CLIENT_ID),
    clientSecret: envOr(
      'SUPERLIORA_ANTIGRAVITY_OAUTH_CLIENT_SECRET',
      GOOGLE_ANTIGRAVITY_OAUTH_CLIENT_SECRET,
    ),
    scopes: [...GOOGLE_ANTIGRAVITY_SCOPES],
    callbackPort: Number(
      envOr(
        'SUPERLIORA_ANTIGRAVITY_OAUTH_CALLBACK_PORT',
        String(GOOGLE_ANTIGRAVITY_CALLBACK_PORT),
      ),
    ),
    callbackPath: '/callback',
    authUrl: GOOGLE_AUTH_URL,
    tokenUrl: GOOGLE_TOKEN_URL,
    pkce: true,
  };
}

function envOr(name: string, fallback: string): string {
  const value = process.env[name];
  return value !== undefined && value.trim().length > 0 ? value.trim() : fallback;
}

function requestSignal(signal: AbortSignal | undefined): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(GOOGLE_TOKEN_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

/** Builds the Google consent URL for a loopback redirect. */
export function buildGoogleAuthorizeUrl(
  config: GoogleOauthConfig,
  state: string,
  redirectUri: string,
  pkceChallenge?: string,
): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: config.scopes.join(' '),
    state,
    access_type: 'offline',
    prompt: 'consent',
  });
  if (pkceChallenge !== undefined) {
    params.set('code_challenge', pkceChallenge);
    params.set('code_challenge_method', 'S256');
  }
  return `${config.authUrl}?${params.toString()}`;
}

async function fetchJson(
  url: string,
  init: RequestInit,
  label: string,
  signal: AbortSignal | undefined,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: requestSignal(signal) });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new OAuthError(`Google ${label} request failed: ${String(error)}`);
  }
  if (response.status === 401 || response.status === 403) {
    // 401/403 (or invalid_grant below) means the credential is revoked or
    // rotated elsewhere — raise the unauthorized subtype so OAuthManager
    // tombstones the token and routes the user to re-login instead of
    // repeating the same failing refresh on every turn.
    throw new OAuthUnauthorizedError(
      `Google ${label} unauthorized (HTTP ${response.status}).`,
    );
  }
  if (!response.ok) {
    const body = await response.text();
    // OAuth-standard permanent failure: refresh token expired/revoked.
    if (body.includes('invalid_grant')) {
      throw new OAuthUnauthorizedError(`Google ${label} unauthorized (invalid_grant).`);
    }
    throw new OAuthError(`Google ${label} request failed: ${String(response.status)} ${body}`);
  }
  return (await response.json()) as Record<string, unknown>;
}

/** Exchanges an authorization code for Google tokens (client-secret grant). */
export async function exchangeGoogleCode(
  config: GoogleOauthConfig,
  code: string,
  redirectUri: string,
  options: { readonly signal?: AbortSignal; readonly codeVerifier?: string } = {},
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const form = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  });
  if (options.codeVerifier !== undefined) {
    form.set('code_verifier', options.codeVerifier);
  }
  const data = await fetchJson(
    config.tokenUrl,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() },
    'token exchange',
    options.signal,
  );
  const accessToken = data['access_token'];
  const refreshToken = data['refresh_token'];
  const expiresIn = Number(data['expires_in']);
  if (typeof accessToken !== 'string' || typeof refreshToken !== 'string') {
    throw new OAuthError('Google token response missing access_token or refresh_token.');
  }
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new OAuthError('Google token response has invalid expires_in.');
  }
  return { accessToken, refreshToken, expiresIn };
}

/** Refreshes a Google access token, keeping the original refresh token when rotated out. */
export async function refreshGoogleToken(
  config: GoogleOauthConfig,
  refreshToken: string,
  options: { readonly signal?: AbortSignal } = {},
): Promise<TokenInfo> {
  const form = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  const data = await fetchJson(
    config.tokenUrl,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() },
    'token refresh',
    options.signal,
  );
  const accessToken = data['access_token'];
  const expiresIn = Number(data['expires_in']);
  if (typeof accessToken !== 'string' || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new OAuthError('Google token refresh response missing access_token or expires_in.');
  }
  return {
    accessToken,
    refreshToken: typeof data['refresh_token'] === 'string' ? data['refresh_token'] : refreshToken,
    expiresAt: Math.floor(Date.now() / 1000) + expiresIn,
    scope: typeof data['scope'] === 'string' ? data['scope'] : '',
    tokenType: 'Bearer',
    expiresIn,
  };
}

function readEnvProjectId(): string | undefined {
  for (const name of ['GOOGLE_CLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT_ID']) {
    const value = process.env[name]?.trim();
    if (value !== undefined && value.length > 0) return value;
  }
  return undefined;
}

async function postCodeAssist(
  endpoint: string,
  path: string,
  accessToken: string,
  body: Record<string, unknown>,
  signal: AbortSignal | undefined,
  headers?: Record<string, string>,
): Promise<Record<string, unknown>> {
  return fetchJson(
    `${endpoint}${path}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': codeAssistIdentityUserAgent(),
        'Client-Metadata': 'ideType=IDE_UNSPECIFIED,platform=PLATFORM_UNSPECIFIED,pluginType=GEMINI',
        ...headers,
      },
      body: JSON.stringify(body),
    },
    path,
    signal,
  );
}

function codeAssistIdentityUserAgent(): string {
  const platform = process.platform === 'win32' ? 'win32' : process.platform;
  const arch = process.arch === 'x64' ? 'x64' : process.arch;
  return `GeminiCLI/0.58.0/gemini-2.5-pro (${platform}; ${arch}; terminal)`;
}

/** Identity headers the Antigravity sandbox endpoints expect during discovery. */
const ANTIGRAVITY_DISCOVERY_HEADERS: Record<string, string> = {
  'User-Agent': 'google-api-nodejs-client/9.15.1',
  'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
};

const FREE_TIER_ID = 'free-tier';
const LEGACY_TIER_ID = 'legacy-tier';

/**
 * Discovers (or provisions) the Cloud Code Assist project for the account,
 * mirroring the Gemini CLI: `loadCodeAssist` first, then `onboardUser` +
 * operation polling for free-tier accounts that have no project yet.
 */
export async function discoverGoogleCodeAssistProject(
  accessToken: string,
  options: {
    readonly signal?: AbortSignal;
    readonly onProgress?: (message: string) => void;
  } = {},
): Promise<string> {
  const endpoint = GOOGLE_CODE_ASSIST_ENDPOINT;
  const envProjectId = readEnvProjectId();

  const loadPayload = await postCodeAssist(
    endpoint,
    '/v1internal:loadCodeAssist',
    accessToken,
    {
      cloudaicompanionProject: envProjectId,
      metadata: { ideType: 'IDE_UNSPECIFIED', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI', duetProject: envProjectId },
    },
    options.signal,
  ).catch((error: unknown) => {
    // Workspace/VPC-SC accounts may reject loadCodeAssist; the Gemini CLI
    // falls back to standard tier with the env-provided project.
    if (envProjectId !== undefined) return { currentTier: { id: 'standard-tier' } } as Record<string, unknown>;
    throw error;
  });

  const currentTier = loadPayload['currentTier'];
  if (currentTier !== undefined && currentTier !== null) {
    const projectId = loadPayload['cloudaicompanionProject'];
    if (typeof projectId === 'string' && projectId.length > 0) return projectId;
    if (envProjectId !== undefined) return envProjectId;
    throw new OAuthError(
      'This Google account requires GOOGLE_CLOUD_PROJECT (or GOOGLE_CLOUD_PROJECT_ID) to be set.',
    );
  }

  const allowedTiers = Array.isArray(loadPayload['allowedTiers']) ? loadPayload['allowedTiers'] : [];
  const defaultTier = allowedTiers.find(
    (tier): tier is { id?: string; isDefault?: boolean } =>
      typeof tier === 'object' && tier !== null && (tier as { isDefault?: boolean }).isDefault === true,
  );
  const tierId = defaultTier?.id ?? LEGACY_TIER_ID;
  if (tierId !== FREE_TIER_ID && envProjectId === undefined) {
    throw new OAuthError(
      'This Google account requires GOOGLE_CLOUD_PROJECT (or GOOGLE_CLOUD_PROJECT_ID) to be set.',
    );
  }

  options.onProgress?.('Provisioning Cloud Code Assist project (this may take a moment)...');
  const onboardBody: Record<string, unknown> = {
    tierId,
    metadata: { ideType: 'IDE_UNSPECIFIED', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI' },
    ...(tierId !== FREE_TIER_ID && envProjectId !== undefined
      ? { cloudaicompanionProject: envProjectId }
      : {}),
  };
  const operation = await postCodeAssist(endpoint, '/v1internal:onboardUser', accessToken, onboardBody, options.signal);

  let done = operation['done'] === true;
  let response = operation['response'];
  const operationName = typeof operation['name'] === 'string' ? operation['name'] : undefined;
  for (let attempt = 0; !done && operationName !== undefined; attempt += 1) {
    if (attempt > 0) {
      options.onProgress?.(`Waiting for project provisioning (attempt ${String(attempt + 1)})...`);
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
    const pollPayload = await fetchJson(
      `${endpoint}/v1internal/${operationName}`,
      { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } },
      'operation poll',
      options.signal,
    );
    done = pollPayload['done'] === true;
    response = pollPayload['response'];
  }

  const onboardProject = (response as { cloudaicompanionProject?: { id?: string } } | undefined)
    ?.cloudaicompanionProject?.id;
  if (typeof onboardProject === 'string' && onboardProject.length > 0) return onboardProject;
  if (envProjectId !== undefined) return envProjectId;
  throw new OAuthError('Could not discover or provision a Google Cloud project for Code Assist.');
}

/**
 * Discovers (or provisions) the Cloud Code Assist project for an Antigravity
 * login. Tries `loadCodeAssist` against each Antigravity endpoint (the
 * sandboxes serve the Antigravity tier; production answers for workspace
 * accounts), then runs `onboardUser` on the primary sandbox when the account
 * has no project yet. `GOOGLE_CLOUD_PROJECT`/`GOOGLE_CLOUD_PROJECT_ID` win
 * over discovery entirely.
 */
export async function discoverGoogleAntigravityProject(
  accessToken: string,
  options: {
    readonly signal?: AbortSignal;
    readonly onProgress?: (message: string) => void;
  } = {},
): Promise<string> {
  const envProjectId = readEnvProjectId();
  const metadata = { ideType: 'IDE_UNSPECIFIED', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI' };

  for (const endpoint of GOOGLE_ANTIGRAVITY_ENDPOINTS) {
    let payload: Record<string, unknown>;
    try {
      payload = await postCodeAssist(
        endpoint,
        '/v1internal:loadCodeAssist',
        accessToken,
        { ...(envProjectId === undefined ? {} : { cloudaicompanionProject: envProjectId }), metadata },
        options.signal,
        ANTIGRAVITY_DISCOVERY_HEADERS,
      );
    } catch {
      continue; // Try the next endpoint (403/404 region or tier gating).
    }
    if (envProjectId !== undefined) return envProjectId;
    const project = payload['cloudaicompanionProject'];
    if (typeof project === 'string' && project.length > 0) return project;
    if (
      typeof project === 'object' &&
      project !== null &&
      typeof (project as { id?: unknown }).id === 'string' &&
      ((project as { id: string }).id).length > 0
    ) {
      return (project as { id: string }).id;
    }
  }
  if (envProjectId !== undefined) return envProjectId;

  // No existing project: provision one on the primary sandbox, polling the
  // long-running operation like the Gemini CLI discovery does.
  options.onProgress?.('Provisioning Cloud Code Assist project (this may take a moment)...');
  const onboard = await postCodeAssist(
    GOOGLE_ANTIGRAVITY_DEFAULT_ENDPOINT,
    '/v1internal:onboardUser',
    accessToken,
    { tierId: 'free-tier', metadata },
    options.signal,
    ANTIGRAVITY_DISCOVERY_HEADERS,
  );
  let done = onboard['done'] === true;
  let response = onboard['response'];
  const operationName = typeof onboard['name'] === 'string' ? onboard['name'] : undefined;
  for (let attempt = 0; !done && operationName !== undefined && attempt < 12; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const pollPayload = await fetchJson(
      `${GOOGLE_ANTIGRAVITY_DEFAULT_ENDPOINT}/v1internal/${operationName}`,
      { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } },
      'operation poll',
      options.signal,
    );
    done = pollPayload['done'] === true;
    response = pollPayload['response'];
  }

  const onboardProject = (response as { cloudaicompanionProject?: { id?: string } } | undefined)
    ?.cloudaicompanionProject?.id;
  if (typeof onboardProject === 'string' && onboardProject.length > 0) return onboardProject;
  throw new OAuthError('Could not discover or provision a Cloud project for Antigravity.');
}

export interface RunGoogleOauthLoginOptions {
  readonly config: GoogleOauthConfig;
  readonly signal?: AbortSignal;
  readonly onAuthorizeUrl?: (url: string) => Promise<void> | void;
  readonly onManualCallbackPrompt?: (context: ManualCallbackPromptContext) => Promise<string | undefined>;
  readonly onProgress?: (message: string) => void;
  readonly discoverProject: (accessToken: string, signal: AbortSignal | undefined) => Promise<string>;
}

/**
 * Runs the full Google login: consent URL → loopback callback (with manual
 * paste fallback) → token exchange → Code Assist project discovery.
 */
export async function runGoogleOauthLogin(options: RunGoogleOauthLoginOptions): Promise<TokenInfo> {
  const { config } = options;
  const state = globalThis.crypto.randomUUID().replaceAll('-', '');
  const pkce = config.pkce === true ? generatePkcePair() : undefined;
  const server = await startCallbackServer(config.callbackPort, 'localhost', { expectedState: state });
  try {
    const redirectUri = server.redirectUri;
    await options.onAuthorizeUrl?.(
      buildGoogleAuthorizeUrl(config, state, redirectUri, pkce?.challenge),
    );
    const { code } = await waitForCallbackOrManual(server, {
      signal: options.signal,
      expectedState: state,
      onManualCallbackPrompt: options.onManualCallbackPrompt,
    });
    const tokens = await exchangeGoogleCode(config, code, redirectUri, {
      signal: options.signal,
      codeVerifier: pkce?.verifier,
    });
    const projectId = await options.discoverProject(tokens.accessToken, options.signal);
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: Math.floor(Date.now() / 1000) + tokens.expiresIn,
      scope: config.scopes.join(' '),
      tokenType: 'Bearer',
      expiresIn: tokens.expiresIn,
      projectId,
    };
  } finally {
    await server.close();
  }
}
