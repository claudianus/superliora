/**
 * Provider profile registry — declarative definitions of OAuth-capable
 * providers that complement the models.dev catalog (which models API-key auth
 * only). Each profile wires a provider id to an OAuth {@link OAuthFlowKind},
 * its flow configuration, and the wire type + base URL to persist on connect.
 *
 * The registry is consumed by:
 *   - the TUI provider picker (to badge a provider as "OAuth"),
 *   - the OAuth flow runner (to pick the right authorization strategy), and
 *   - the connect helper (to write the resulting provider config).
 */

import type { OAuthFlowConfig } from '../types';

/**
 * Wire protocol a provider speaks once authenticated. Kept as a local literal
 * union (mirroring `ProviderType` in `@superliora/kosong`) so this package does
 * not need to depend on kosong.
 */
export type OAuthProviderWire = 'anthropic' | 'openai' | 'openai_responses' | 'kimi';

/** The OAuth authorization strategy a provider uses. */
export type OAuthFlowKind =
  /** Kimi-style device-code grant (RFC 8628) against `/api/oauth/*`. */
  | 'device_code_kimi'
  /** OpenAI Codex custom device-code flow (usercode → poll → token exchange). */
  | 'device_code_openai'
  /** OAuth 2.0 PKCE authorization-code with a loopback browser callback. */
  | 'pkce_browser';

/**
 * Configuration needed to run an OAuth flow. The base {@link OAuthFlowConfig}
 * carries the storage name + host + clientId; the `pkce` branch adds the
 * pieces a browser callback flow needs.
 */
export interface ProviderFlowConfig extends OAuthFlowConfig {
  readonly kind: OAuthFlowKind;
  /** OAuth scopes to request (space-joined). */
  readonly scope?: string;
  /** Loopback callback port for `pkce_browser` flows. */
  readonly callbackPort?: number;
  /**
   * Host used in the `redirect_uri` for `pkce_browser` flows. The callback
   * server always binds to `127.0.0.1`, but providers match redirect URIs by
   * exact string, so some require `127.0.0.1` here. Defaults to `localhost`.
   */
  readonly callbackHost?: string;
  /** Override the authorize URL path (defaults to the OIDC discovery result). */
  readonly authorizeUrl?: string;
  /** Token exchange URL. */
  readonly tokenUrl?: string;
  /** OIDC discovery document URL (when the provider exposes one). */
  readonly discoveryUrl?: string;
  /** User-agent sent with OAuth HTTP requests. */
  readonly userAgent?: string;
}

/**
 * A declarative description of an OAuth-capable provider. Mirrors the shape
 * opencode/hermes-agent use, adapted to our config model.
 */
export interface ProviderProfile {
  /** Unique provider id (used as the config `providers` key). */
  readonly id: string;
  readonly displayName: string;
  readonly description?: string;
  readonly authType: 'oauth';
  readonly flow: ProviderFlowConfig;
  /** Wire protocol the provider speaks once authenticated. */
  readonly wire: OAuthProviderWire;
  /** Base URL persisted into the provider config for runtime requests. */
  readonly apiBaseUrl?: string;
  /** Where a user signs up / obtains access. */
  readonly signupUrl?: string;
  /** Favicon/docs link shown in the picker. */
  readonly docUrl?: string;
  /**
   * Known model aliases written to config on connect, so the OAuth provider is
   * immediately usable without a separate `/models` fetch. Each entry becomes a
   * `{providerId}/{modelId}` model alias.
   */
  readonly models?: readonly ProviderModelPreset[];
}

/** A model alias preset for an OAuth provider. */
export interface ProviderModelPreset {
  readonly id: string;
  readonly displayName?: string;
  readonly maxContextSize: number;
  readonly capabilities?: readonly string[];
}

export const OAUTH_PROVIDER_IDS = ['managed:kimi-api', 'openai-codex', 'xai-grok'] as const;
export type OAuthProviderId = (typeof OAUTH_PROVIDER_IDS)[number];
