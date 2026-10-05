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
 *
 * Covers every wire `createProvider` implements: OAuth profiles for
 * API-key-first backends (e.g. a future Google OAuth login on `google-genai`)
 * must type-check today instead of forcing a union widening at connect time.
 */
export type OAuthProviderWire =
  | 'anthropic'
  | 'openai'
  | 'openai_responses'
  | 'kimi'
  | 'cursor'
  | 'google-genai'
  | 'code-assist'
  | 'codewhisperer'
  | 'vertexai'
  | 'bedrock'
  | 'vertex_claude'
  | 'devin'
  | 'factory-droid';

/** The OAuth authorization strategy a provider uses. */
export type OAuthFlowKind =
  /** Kimi-style device-code grant (RFC 8628) against `/api/oauth/*`. */
  | 'device_code_kimi'
  /** OpenAI Codex custom device-code flow (usercode → poll → token exchange). */
  | 'device_code_openai'
  /** AWS SSO OIDC device-code grant (Kiro / Amazon Q). */
  | 'device_code_kiro'
  /**
   * Generic RFC 8628 device-code grant against explicit `deviceCodeUrl` /
   * `tokenUrl` endpoints. Optional PKCE (`pkce: true`) sends the
   * `code_challenge` on the device request and the `code_verifier` on the
   * token poll (Qwen). A `resource_url` in the token response is captured
   * onto the stored token so the connect flow can adopt the account's
   * assigned inference endpoint.
   */
  | 'device_code'
  /**
   * MiniMax-style user-code grant: `POST {oauthHost}/oauth/code` issues a
   * `user_code` + portal URL; the client polls `{oauthHost}/oauth/token`
   * with `grant_type=urn:ietf:params:oauth:grant-type:user_code` and the
   * PKCE `code_verifier`.
   */
  | 'user_code'
  /**
   * OpenRouter-style PKCE consent that mints a durable API key instead of
   * OAuth tokens: loopback `?code=` → `POST {tokenUrl}` `{code,
   * code_verifier}` → `{key}`. Stored as a non-expiring token bundle.
   */
  | 'pkce_api_key'
  /** OAuth 2.0 PKCE authorization-code with a loopback browser callback. */
  | 'pkce_browser'
  /** Cursor deep-link PKCE: open login URL, poll `/auth/poll` (no loopback). */
  | 'deep_link_poll'
  /**
   * No third-party OAuth app. Persist a user-pasted / env token, then exchange
   * it at request time (GitHub Copilot session tokens).
   */
  | 'paste_token'
  /** Google authorization-code flow (client secret + Code Assist project discovery). */
  | 'google_oauth'
  /**
   * Browser authorize URL with a custom-protocol redirect a CLI cannot catch:
   * the user pastes the final redirect URL (or bare code) and a
   * provider-specific exchange runs on it (GLM ZCode).
   */
  | 'code_paste'
  /**
   * Devin CLI login: PKCE loopback (`127.0.0.1:59653/callback`) with a JSON
   * token exchange `{code, code_verifier}` returning `{ token }`. The session
   * JWT is long-lived; expiry comes from its `exp` claim (1-year fallback).
   */
  | 'devin_pkce'
  /**
   * Kilo Gateway device authorization: `POST {oauthHost}/api/device-auth/codes`
   * returns `{code, verificationUrl, expiresIn}`; the client polls
   * `GET /api/device-auth/codes/{code}` until `{status: 'approved', token}`.
   * The minted token is a gateway API key, not an OAuth grant — no refresh.
   */
  | 'kilo_device';

/**
 * Which implementation runs a `pkce_browser` flow. Providers sharing the
 * standard authorization-code shape use the generic loopback path; providers
 * with bespoke token-exchange payloads keep their dedicated impl.
 */
export type PkceFlowVariant =
  /** Standard OAuth 2.0 PKCE (Anthropic, GitLab Duo). */
  | 'generic'
  /** OpenAI-style token exchange payload. */
  | 'openai'
  /** xAI token exchange with OIDC endpoint discovery. */
  | 'xai';

/**
 * How the resolved OAuth token is attached to wire requests. `undefined`
 * (default) means the wire's native credential style — e.g. `x-api-key` for
 * the `anthropic` wire. `'bearer'` providers (Z.AI, GitLab Duo proxy) expect
 * `Authorization: Bearer` instead, so the runtime injects that header and the
 * anthropic adapter suppresses `x-api-key`.
 */
export type ProviderWireAuth = 'bearer';

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
  /** Device authorization endpoint for `device_code` / `user_code` flows. */
  readonly deviceCodeUrl?: string;
  /**
   * Attach a PKCE S256 pair to `device_code`/`user_code` flows: the challenge
   * rides the code request, the verifier the token exchange. Required by Qwen
   * and MiniMax.
   */
  readonly pkce?: boolean;
  /**
   * Provider-specific header that carries the refresh token on refresh
   * requests (e.g. Nous Portal's `x-nous-refresh-token`). The form body still
   * carries `refresh_token` for RFC compliance.
   */
  readonly refreshTokenHeader?: string;
  /**
   * Extra headers sent on both the device-code request and the token poll
   * (e.g. Meta OIDC's `x-api-version`). Applied on top of the defaults.
   */
  readonly requestHeaders?: Readonly<Record<string, string>>;
  /**
   * Token expiry handling for providers that omit `expires_in`:
   * `jwt_or_never` reads the JWT `exp` claim when present and otherwise marks
   * the token non-expiring (`expiresAt: 0`). Default requires `expires_in` or
   * a JWT `exp`.
   */
  readonly tokenExpiry?: 'jwt_or_never';
  /**
   * Post-exchange hook run on the freshly granted token before it is stored.
   * `muse_key` mints the Muse Code model API key (`api.meta.ai/muse-code/key`)
   * and stores `{ accessToken: apiKey, refreshToken: oauthToken }` — model
   * requests authenticate with the minted key while the Meta account token is
   * retained for re-minting. `factory_region` resolves the Factory Droid
   * account scope (`/api/cli/whoami` → org id, residency, inference region)
   * onto the stored token.
   */
  readonly postExchange?: 'muse_key' | 'factory_region';
  /** OIDC discovery document URL (when the provider exposes one). */
  readonly discoveryUrl?: string;
  /** User-agent sent with OAuth HTTP requests. */
  readonly userAgent?: string;
  /** Which `pkce_browser` implementation runs the flow. Defaults to `'openai'`. */
  readonly variant?: PkceFlowVariant;
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
  /** Overrides the wire's default credential style (e.g. Bearer on `anthropic`). */
  readonly wireAuth?: ProviderWireAuth;
  /** Base URL persisted into the provider config for runtime requests. */
  readonly apiBaseUrl?: string;
  /**
   * Static request headers written into the provider config on connect
   * (for example Grok Build's `X-XAI-Token-Auth` CLI session marker).
   */
  readonly customHeaders?: Readonly<Record<string, string>>;
  /**
   * Env vars carrying a paste-token credential (`paste_token` flows), in
   * lookup order. Defaults to the GitHub Copilot set when omitted.
   */
  readonly pasteTokenEnvs?: readonly string[];
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
  /**
   * When true, the connect flow fetches `{apiBaseUrl}/models` with the fresh
   * access token and prefers the live list over `models` presets (aggregators
   * like Nous Portal whose catalog churns daily).
   */
  readonly liveModels?: boolean;
}

/** A model alias preset for an OAuth provider. */
export interface ProviderModelPreset {
  readonly id: string;
  readonly displayName?: string;
  readonly maxContextSize: number;
  readonly capabilities?: readonly string[];
  /** Declared discrete thinking efforts; an empty array means no effort UI. */
  readonly supportEfforts?: readonly string[];
  readonly defaultEffort?: string;
}

export const OAUTH_PROVIDER_IDS = [
  'managed:kimi-api',
  'openai-codex',
  'xai-grok',
  'anthropic-oauth',
  'cursor-oauth',
  'github-copilot',
  'gitlab-duo',
  'glm-zcode',
  'google-antigravity',
  'google-gemini-cli',
  'kiro',
  'minimax-oauth',
  'minimax-oauth-cn',
  'nous',
  'openrouter-oauth',
  'qwen-oauth',
  'devin',
  'muse-code',
  'kilo',
  'factory-droid',
] as const;
export type OAuthProviderId = (typeof OAUTH_PROVIDER_IDS)[number];
