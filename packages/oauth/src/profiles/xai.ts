/**
 * xAI (Grok) profile. Uses standard OAuth 2.0 PKCE authorization-code flow
 * with a loopback callback (port 56121). Endpoints are resolved via OIDC
 * discovery at runtime rather than hard-coded paths.
 *
 * xAI bills OAuth traffic by request host:
 *   - Grok Build (subscription quota): `https://cli-chat-proxy.grok.com/v1`
 *     with the CLI session headers the official `grok` CLI sends.
 *   - Grok API (API usage / prepaid credits): `https://api.x.ai/v1`
 *
 * SuperLiora defaults OAuth login to the Build proxy so account logins land
 * on the same quota as `grok`. Users who want the public API path can set
 * `providers.xai-grok.base_url` to {@link XAI_GROK_API_BASE_URL}.
 *
 * Client id and discovery URL mirror the official Grok CLI, reused by
 * third-party tools as a public client.
 */

import type { ProviderProfile } from './provider-profile';

const XAI_OAUTH_HOST = 'https://auth.x.ai';
const XAI_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828';
const XAI_CALLBACK_PORT = 56121;
// The official Grok CLI OAuth app registers `127.0.0.1` (not `localhost`) as
// the redirect host. xAI matches redirect URIs by exact string, so this must
// agree with the registered value.
const XAI_CALLBACK_HOST = '127.0.0.1';
const XAI_SCOPE = 'openid profile email offline_access grok-cli:access api:access';

/** Official Grok Build CLI chat proxy (subscription / Build usage). */
export const XAI_GROK_BUILD_BASE_URL = 'https://cli-chat-proxy.grok.com/v1';

/** Public xAI inference API (API key / API usage metering). */
export const XAI_GROK_API_BASE_URL = 'https://api.x.ai/v1';

/** Auth middleware value the Build proxy expects for CLI session tokens. */
export const XAI_GROK_BUILD_TOKEN_AUTH = 'xai-grok-cli';

export type XaiGrokRoute = 'build' | 'api';

export interface XaiGrokRouteConfig {
  readonly route: XaiGrokRoute;
  readonly baseUrl: string;
  /**
   * Headers required by the Build proxy for CLI OAuth tokens. Empty for the
   * public API path. Callers may still add `x-grok-model-override` at request
   * time for non-default Build models.
   */
  readonly customHeaders?: Readonly<Record<string, string>>;
}

/** Static headers that identify a Grok Build CLI session token. */
export function xaiGrokBuildAuthHeaders(): Record<string, string> {
  return { 'X-XAI-Token-Auth': XAI_GROK_BUILD_TOKEN_AUTH };
}

/**
 * Headers the Build proxy expects on inference requests. When `model` is set,
 * also emits `x-grok-model-override` so the proxy can route off the default
 * `grok-build` inference cluster.
 */
export function xaiGrokBuildRequestHeaders(model?: string): Record<string, string> {
  const headers = xaiGrokBuildAuthHeaders();
  const override = model?.trim();
  if (override !== undefined && override.length > 0) {
    headers['x-grok-model-override'] = override;
  }
  return headers;
}

function hostOf(baseUrl: string | undefined): string | undefined {
  if (baseUrl === undefined) return undefined;
  const trimmed = baseUrl.trim();
  if (trimmed.length === 0) return undefined;
  try {
    return new URL(trimmed).host.toLowerCase();
  } catch {
    // Accept bare host-ish strings or values missing a scheme.
    const withoutPath = trimmed.replace(/^https?:\/\//i, '').split('/')[0];
    return withoutPath?.toLowerCase();
  }
}

/** True when `baseUrl` points at the official Grok Build chat proxy. */
export function isXaiGrokBuildBaseUrl(baseUrl: string | undefined): boolean {
  return hostOf(baseUrl) === 'cli-chat-proxy.grok.com';
}

/** True when `baseUrl` points at the public xAI API. */
export function isXaiGrokApiBaseUrl(baseUrl: string | undefined): boolean {
  return hostOf(baseUrl) === 'api.x.ai';
}

/**
 * Classifies an xAI provider base URL as Build vs API. Unknown / unset URLs
 * default to Build so OAuth logins stay on subscription quota.
 */
export function resolveXaiGrokRoute(baseUrl?: string): XaiGrokRoute {
  if (isXaiGrokApiBaseUrl(baseUrl)) return 'api';
  if (isXaiGrokBuildBaseUrl(baseUrl)) return 'build';
  // Unset or custom: keep Build as the OAuth default. Callers that pointed a
  // custom reverse proxy at api.x.ai should set the host to api.x.ai.
  if (baseUrl === undefined || baseUrl.trim().length === 0) return 'build';
  return isXaiGrokApiBaseUrl(baseUrl) ? 'api' : 'build';
}

/** Returns the base URL + optional static headers for a Grok route. */
export function xaiGrokRouteConfig(route: XaiGrokRoute = 'build'): XaiGrokRouteConfig {
  if (route === 'api') {
    return { route: 'api', baseUrl: XAI_GROK_API_BASE_URL };
  }
  return {
    route: 'build',
    baseUrl: XAI_GROK_BUILD_BASE_URL,
    customHeaders: xaiGrokBuildAuthHeaders(),
  };
}

export const XAI_PROFILE: ProviderProfile = {
  id: 'xai-grok',
  displayName: 'xAI Grok (account login)',
  description:
    'Sign in with your xAI account to use Grok via the Grok Build proxy (subscription quota). Set base_url to https://api.x.ai/v1 for Grok API usage metering.',
  authType: 'oauth',
  flow: {
    name: 'xai-grok',
    oauthHost: XAI_OAUTH_HOST,
    clientId: XAI_CLIENT_ID,
    kind: 'pkce_browser',
    scope: XAI_SCOPE,
    callbackPort: XAI_CALLBACK_PORT,
    callbackHost: XAI_CALLBACK_HOST,
    discoveryUrl: `${XAI_OAUTH_HOST}/.well-known/openid-configuration`,
    tokenUrl: `${XAI_OAUTH_HOST}/oauth2/token`,
    authorizeUrl: `${XAI_OAUTH_HOST}/oauth/authorize`,
    userAgent: 'liora-cli',
  },
  wire: 'openai',
  // Default OAuth login to the same Build proxy the official `grok` CLI uses
  // so usage counts against Grok Build, not Grok API credits.
  apiBaseUrl: XAI_GROK_BUILD_BASE_URL,
  customHeaders: xaiGrokBuildAuthHeaders(),
  signupUrl: 'https://x.ai',
  docUrl: 'https://docs.x.ai/build/overview',
  models: [
    {
      id: 'grok-4.5',
      displayName: 'Grok 4.5',
      maxContextSize: 500000,
      capabilities: ['thinking', 'tool_use'],
    },
    {
      id: 'grok-4',
      displayName: 'Grok 4',
      maxContextSize: 256000,
      capabilities: ['thinking', 'tool_use'],
    },
    {
      id: 'grok-4-fast',
      displayName: 'Grok 4 Fast',
      maxContextSize: 2000000,
      capabilities: ['thinking', 'tool_use'],
    },
  ],
};
