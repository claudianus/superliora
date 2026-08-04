/**
 * Multi-provider usage / quota querying.
 *
 * Queries real usage data for every OAuth-capable provider SuperLiora supports:
 *
 *   - **Kimi managed** (`managed:kimi-api`): first-class `/usages` endpoint
 *     with weekly + rate-limit windows.
 *   - **OpenAI Codex** (`openai-codex`): ChatGPT's private wham/usage endpoint
 *     returns 5-hour and weekly quota windows with used_percent, reset_at,
 *     credits balance, and per-model additional_rate_limits.
 *   - **xAI Grok** (`xai-grok`): rate-limit headers (x-ratelimit-limit-requests,
 *     x-ratelimit-remaining-requests, x-ratelimit-limit-tokens, etc.) captured
 *     from a lightweight GET /models call.
 *   - **Anthropic** (`anthropic-oauth`): rate-limit headers
 *     (anthropic-ratelimit-*-limit/remaining/reset) captured from the
 *     lightweight /v1/messages/count_tokens endpoint.
 *
 * The unified {@link ProviderUsageSnapshot} shape lets the TUI render a
 * consistent quota dashboard regardless of which providers are configured.
 */

import { isManagedKimiCode } from '../kimi/managed-usage';
import { snapshotWorstRatio, providerDisplayName } from './provider-usage-display';
import { fetchAnthropicUsage } from './provider-usage-fetch-anthropic';
import { fetchClinePassUsage } from './provider-usage-fetch-clinepass';
import { fetchOpenAiCodexUsage } from './provider-usage-fetch-codex';
import { fetchKimiManagedUsage } from './provider-usage-fetch-kimi';
import { fetchQwenTokenPlanUsage } from './provider-usage-fetch-qwen';
import { fetchXaiGrokUsage } from './provider-usage-fetch-xai';
import type {
  AllProvidersUsageSnapshot,
  FetchProviderUsageOptions,
  ProviderUsageRow,
  ProviderUsageSnapshot,
} from './provider-usage-types';

export type {
  AllProvidersUsageSnapshot,
  FetchProviderUsageOptions,
  ProviderUsageRow,
  ProviderUsageSnapshot,
} from './provider-usage-types';

export {
  providerDisplayName,
  snapshotWorstRatio,
  usageRowRatio,
} from './provider-usage-display';

/**
 * Fetch usage for a single provider by key. Routes to the appropriate
 * provider-specific fetcher based on the provider key prefix / id.
 */
export async function fetchProviderUsage(
  providerKey: string,
  accessToken: string,
  baseUrl?: string,
  opts: FetchProviderUsageOptions = {},
): Promise<ProviderUsageSnapshot> {
  if (isManagedKimiCode(providerKey)) {
    return fetchKimiManagedUsage(providerKey, accessToken, baseUrl, opts);
  }
  if (providerKey === 'openai-codex') {
    return fetchOpenAiCodexUsage(providerKey, accessToken, baseUrl, opts);
  }
  if (providerKey === 'xai-grok') {
    return fetchXaiGrokUsage(providerKey, accessToken, baseUrl, opts);
  }
  if (providerKey === 'anthropic-oauth') {
    return fetchAnthropicUsage(providerKey, accessToken, baseUrl, opts);
  }
  if (providerKey === 'clinepass') {
    return fetchClinePassUsage(providerKey, accessToken, baseUrl, opts);
  }
  if (
    providerKey === 'qwen-token-plan' ||
    providerKey === 'alibaba-token-plan' ||
    providerKey === 'alibaba-token-plan-cn'
  ) {
    return fetchQwenTokenPlanUsage(providerKey, accessToken, baseUrl, opts);
  }
  // Unknown provider — report as unavailable.
  return {
    providerKey,
    displayName: providerDisplayName(providerKey),
    available: false,
    summary: null,
    limits: [],
    fetchedAtMs: Date.now(),
  };
}

/**
 * Build an aggregate snapshot from individual provider snapshots.
 * Computes the worst usage ratio for footer badge severity.
 */
export function buildAllProvidersUsageSnapshot(
  providers: readonly ProviderUsageSnapshot[],
): AllProvidersUsageSnapshot {
  let worst = 0;
  let primaryProviderKey: string | null = null;
  for (const snap of providers) {
    if (snap.error === undefined && snap.available && primaryProviderKey === null) {
      primaryProviderKey = snap.providerKey;
    }
    worst = Math.max(worst, snapshotWorstRatio(snap));
  }
  return {
    providers,
    primaryProviderKey,
    worstRatio: worst,
    fetchedAtMs: Date.now(),
  };
}
