/**
 * OAuth type definitions for managed providers.
 *
 * Only Device Code Flow (RFC 8628) is supported, against
 * `https://auth.kimi.com`.
 *
 * Wire format (on disk / server) uses snake_case to match the server
 * contract; in-process types use camelCase per TS convention.
 */

export type OAuthStorageBackend = 'file';

/** A persisted OAuth token bundle. */
export interface TokenInfo {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Unix seconds when access_token expires. */
  readonly expiresAt: number;
  readonly scope: string;
  readonly tokenType: string;
  /** Original expires_in from server response (seconds). */
  readonly expiresIn: number;
  /**
   * Provider-specific credential metadata (Google Cloud Code Assist project
   * id). Optional so every existing producer stays valid.
   */
  readonly projectId?: string;
  /**
   * Per-account inference base URL returned by some device flows (Qwen's
   * `resource_url`). When present, connect writes it as the provider's
   * `baseUrl` so requests follow the account's assigned endpoint.
   */
  readonly resourceUrl?: string;
  /**
   * Organization id the credential is scoped to (Factory Droid's
   * `X-Factory-Org-Id`, resolved from the WorkOS `external_org_id` claim or
   * the `/api/cli/whoami` exchange).
   */
  readonly orgId?: string;
  /**
   * Account residency region (Factory Droid `eu` | `global`); selects the API
   * host. Connect persists it as the provider's `region` config.
   */
  readonly region?: string;
  /**
   * Inference-serving region resolved by the provider's identity exchange
   * (Factory Droid `global` | `eu` | `us`); independent from `region`
   * residency — an EU-host account can serve global inference.
   */
  readonly inferenceRegion?: string;
}

/** RFC 8628 §3.2 device authorization response. */
export interface DeviceAuthorization {
  readonly userCode: string;
  readonly deviceCode: string;
  readonly verificationUri: string;
  readonly verificationUriComplete: string;
  /** Seconds until device_code expires (server-reported). May be null. */
  readonly expiresIn: number | null;
  /** Polling interval in seconds. */
  readonly interval: number;
}

/** OAuth flow endpoint + client configuration. */
export interface OAuthFlowConfig {
  /** Logical provider name for storage (e.g. "kimi-code"). */
  readonly name: string;
  /** Base URL of the OAuth server, no trailing slash. */
  readonly oauthHost: string;
  /** Client ID registered with the OAuth provider. */
  readonly clientId: string;
}

/** Device identification for `X-Msh-*` headers. */
export interface DeviceHeaders {
  readonly 'X-Msh-Platform': string;
  readonly 'X-Msh-Version': string;
  readonly 'X-Msh-Device-Name': string;
  readonly 'X-Msh-Device-Model': string;
  readonly 'X-Msh-Os-Version': string;
  readonly 'X-Msh-Device-Id': string;
}

/** JSON wire format for token persistence (snake_case, Python-compatible). */
export interface TokenInfoWire {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly expires_at: number;
  readonly scope: string;
  readonly token_type: string;
  readonly expires_in: number;
  readonly project_id?: string;
  readonly resource_url?: string;
  readonly org_id?: string;
  readonly region?: string;
  readonly inference_region?: string;
}

export function tokenToWire(token: TokenInfo): TokenInfoWire {
  return {
    access_token: token.accessToken,
    refresh_token: token.refreshToken,
    expires_at: token.expiresAt,
    scope: token.scope,
    token_type: token.tokenType,
    expires_in: token.expiresIn,
    ...(token.projectId === undefined ? {} : { project_id: token.projectId }),
    ...(token.resourceUrl === undefined ? {} : { resource_url: token.resourceUrl }),
    ...(token.orgId === undefined ? {} : { org_id: token.orgId }),
    ...(token.region === undefined ? {} : { region: token.region }),
    ...(token.inferenceRegion === undefined ? {} : { inference_region: token.inferenceRegion }),
  };
}

export function tokenFromWire(wire: Partial<TokenInfoWire>): TokenInfo {
  return {
    accessToken: wire.access_token ?? '',
    refreshToken: wire.refresh_token ?? '',
    expiresAt: typeof wire.expires_at === 'number' ? wire.expires_at : 0,
    scope: wire.scope ?? '',
    tokenType: wire.token_type ?? '',
    expiresIn: typeof wire.expires_in === 'number' ? wire.expires_in : 0,
    ...(typeof wire.project_id === 'string' && wire.project_id.length > 0
      ? { projectId: wire.project_id }
      : {}),
    ...(typeof wire.resource_url === 'string' && wire.resource_url.length > 0
      ? { resourceUrl: wire.resource_url }
      : {}),
    ...(typeof wire.org_id === 'string' && wire.org_id.length > 0 ? { orgId: wire.org_id } : {}),
    ...(typeof wire.region === 'string' && wire.region.length > 0
      ? { region: wire.region }
      : {}),
    ...(typeof wire.inference_region === 'string' && wire.inference_region.length > 0
      ? { inferenceRegion: wire.inference_region }
      : {}),
  };
}
