/** A single quota / usage row for a provider. */
export interface ProviderUsageRow {
  readonly label: string;
  readonly used: number;
  readonly limit: number;
  readonly resetHint?: string | undefined;
}

export type ProviderUsageKind = 'subscription' | 'api-credits' | 'rate-limit' | 'local-estimate';
export type ProviderUsageStatus =
  | 'ok'
  | 'unavailable'
  | 'auth-required'
  | 'rate-limited'
  | 'error';
export type ProviderUsageSource =
  | 'oauth-api'
  | 'response-headers'
  | 'local-history'
  | 'catalog-pricing';

/** Per-provider usage snapshot rendered by the TUI quota dashboard. */
export interface ProviderUsageSnapshot {
  /** Provider config key (e.g. `managed:kimi-api`, `openai-codex`). */
  readonly providerKey: string;
  /** Human-readable provider name. */
  readonly displayName: string;
  /**
   * Whether the provider exposes a queryable usage API (not whether the
   * credential itself is valid — auth failures surface via `status` /
   * credential-health from real requests).
   *
   * Convention per fetcher kind:
   * - usage-stats endpoints (kimi, xai, anthropic, …) fail open
   *   (`available: true` + `error`): a stats outage must not route away from
   *   a healthy chat credential.
   * - key-check endpoints (openrouter `/key`, deepseek balance) fail closed
   *   (`available: false`): the check IS the credential validation.
   */
  readonly available: boolean;
  /** Primary summary row (e.g. "Weekly limit"). Null when unavailable. */
  readonly summary: ProviderUsageRow | null;
  /** Additional rate-limit / quota rows. */
  readonly limits: readonly ProviderUsageRow[];
  /** Error message when the fetch failed. */
  readonly error?: string | undefined;
  /** Unix-ms timestamp of the last successful fetch. */
  readonly fetchedAtMs: number;
  /** Compact footer chip. Empty when remaining is unknown — never a fake %. */
  readonly remainingDisplay?: string;
  readonly kind?: ProviderUsageKind;
  readonly status?: ProviderUsageStatus;
  readonly source?: ProviderUsageSource;
  readonly accountLabel?: string;
}

/** Aggregate snapshot across all configured providers. */
export interface AllProvidersUsageSnapshot {
  readonly providers: readonly ProviderUsageSnapshot[];
  /** The provider key that contributed the primary summary (first ok). */
  readonly primaryProviderKey: string | null;
  /** Worst usage ratio across all providers (0..1), for footer badge severity. */
  readonly worstRatio: number;
  readonly fetchedAtMs: number;
}

export interface FetchProviderUsageOptions {
  readonly timeoutMs?: number;
  /** Bypass the per-provider TTL cache. */
  readonly refresh?: boolean;
}

/** Last-response rate-limit window (from LLM headers or route status). */
export interface RouteRateLimitInput {
  readonly name: string;
  readonly limit?: number;
  readonly remaining?: number;
  readonly resetAt?: number;
}

export interface OverlayRouteRateLimitsInput {
  readonly providerName: string;
  readonly rateLimits?: readonly RouteRateLimitInput[];
}
