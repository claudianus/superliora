/** A single quota / usage row for a provider. */
export interface ProviderUsageRow {
  readonly label: string;
  readonly used: number;
  readonly limit: number;
  readonly resetHint?: string | undefined;
}

/** Per-provider usage snapshot rendered by the TUI quota dashboard. */
export interface ProviderUsageSnapshot {
  /** Provider config key (e.g. `managed:kimi-api`, `openai-codex`). */
  readonly providerKey: string;
  /** Human-readable provider name. */
  readonly displayName: string;
  /** Whether the provider exposes a queryable usage API. */
  readonly available: boolean;
  /** Primary summary row (e.g. "Weekly limit"). Null when unavailable. */
  readonly summary: ProviderUsageRow | null;
  /** Additional rate-limit / quota rows. */
  readonly limits: readonly ProviderUsageRow[];
  /** Error message when the fetch failed. */
  readonly error?: string | undefined;
  /** Unix-ms timestamp of the last successful fetch. */
  readonly fetchedAtMs: number;
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
}
