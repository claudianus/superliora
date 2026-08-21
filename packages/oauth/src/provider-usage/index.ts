/**
 * Multi-provider usage / quota querying.
 *
 * Queries real remaining quota for SuperLiora-logged-in providers:
 *
 *   - **Kimi managed** (`managed:kimi-api`): `/usages`
 *   - **OpenAI Codex** (`openai-codex`): ChatGPT `wham/usage`
 *   - **Anthropic** (`anthropic-oauth`): `count_tokens` + headers
 *     (`/api/oauth/usage` only when `anthropic_oauth` is on)
 *   - **OpenRouter** (`openrouter`): `GET /api/v1/key`
 *   - **DeepSeek** (`deepseek`): `GET /user/balance`
 *   - **Groq** (`groq`): `GET /openai/v1/models` + `x-ratelimit-*` (RPD)
 *   - **xAI Grok** (`xai-grok`): `GET /models` + `x-ratelimit-*`
 *   - **Cursor** (`cursor-oauth`): usage JSON when OAuth login exists
 *   - **ClinePass / Qwen / Z.AI**: existing plan / header probes
 *
 * models.dev catalog limits are never treated as account quota.
 */

import { isManagedKimiCode } from '../kimi/managed-usage';
import {
  providerUsageTtlMs,
  usageCacheKey,
  withProviderUsageCache,
} from './provider-usage-cache';
import {
  buildAllProvidersUsageSnapshot,
  finalizeUsageSnapshot,
  providerDisplayName,
} from './provider-usage-display';
import { fetchAnthropicUsage } from './provider-usage-fetch-anthropic';
import { fetchClinePassUsage } from './provider-usage-fetch-clinepass';
import { fetchOpenAiCodexUsage } from './provider-usage-fetch-codex';
import { fetchCursorUsage } from './provider-usage-fetch-cursor';
import { fetchDeepSeekUsage } from './provider-usage-fetch-deepseek';
import { fetchGroqUsage } from './provider-usage-fetch-groq';
import { fetchKimiManagedUsage } from './provider-usage-fetch-kimi';
import { fetchOpenRouterUsage } from './provider-usage-fetch-openrouter';
import { fetchQwenTokenPlanUsage } from './provider-usage-fetch-qwen';
import { fetchXaiGrokUsage } from './provider-usage-fetch-xai';
import { fetchZaiUsage } from './provider-usage-fetch-zai';
import type {
  AllProvidersUsageSnapshot,
  FetchProviderUsageOptions,
  ProviderUsageRow,
  ProviderUsageSnapshot,
} from './provider-usage-types';

export type {
  AllProvidersUsageSnapshot,
  FetchProviderUsageOptions,
  OverlayRouteRateLimitsInput,
  ProviderUsageKind,
  ProviderUsageRow,
  ProviderUsageSnapshot,
  ProviderUsageSource,
  ProviderUsageStatus,
  RouteRateLimitInput,
} from './provider-usage-types';

export {
  buildAllProvidersUsageSnapshot,
  finalizeUsageSnapshot,
  formatRemainingDisplay,
  providerDisplayName,
  providerShortName,
  snapshotRemainingRatio,
  snapshotWorstRatio,
  usageRowRatio,
} from './provider-usage-display';

export {
  parseRateLimitHeaders,
  usageRowsFromRouteRateLimits,
} from './provider-usage-headers';
export { overlayRouteRateLimits } from './provider-usage-merge';
export { resolveUsageProviderKey } from './provider-usage-key';
export {
  ANTHROPIC_USAGE_TTL_MS,
  clearProviderUsageCache,
  DEFAULT_USAGE_TTL_MS,
  peekProviderUsageCache,
  providerUsageTtlMs,
  usageCacheKey,
  withProviderUsageCache,
  writeProviderUsageCache,
} from './provider-usage-cache';
export {
  detectEnvUsageProviderKeys,
  envUsageAccessToken,
  ENV_USAGE_PROVIDERS,
} from './provider-usage-env';
export { parseAnthropicOAuthUsage } from './provider-usage-fetch-anthropic';
export { parseOpenRouterKeyPayload } from './provider-usage-fetch-openrouter';
export { parseDeepSeekBalancePayload } from './provider-usage-fetch-deepseek';
export { parseGroqRateLimitHeaders } from './provider-usage-fetch-groq';

async function fetchProviderUsageUncached(
  providerKey: string,
  accessToken: string,
  baseUrl: string | undefined,
  opts: FetchProviderUsageOptions,
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
  if (providerKey === 'cursor-oauth') {
    return fetchCursorUsage(providerKey, accessToken, baseUrl, opts);
  }
  if (providerKey === 'openrouter') {
    return fetchOpenRouterUsage(providerKey, accessToken, baseUrl, opts);
  }
  if (providerKey === 'deepseek') {
    return fetchDeepSeekUsage(providerKey, accessToken, baseUrl, opts);
  }
  if (providerKey === 'groq') {
    return fetchGroqUsage(providerKey, accessToken, baseUrl, opts);
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
  if (providerKey === 'zai-coding-plan' || providerKey === 'zai') {
    return fetchZaiUsage(providerKey, accessToken, baseUrl, opts);
  }
  return {
    providerKey,
    displayName: providerDisplayName(providerKey),
    available: false,
    summary: null,
    limits: [],
    fetchedAtMs: Date.now(),
    status: 'unavailable',
    remainingDisplay: '',
  };
}

/**
 * Fetch usage for a single provider by key. Cached (TTL 120s, Anthropic 180s)
 * with in-flight dedupe and stale-while-revalidate.
 */
export async function fetchProviderUsage(
  providerKey: string,
  accessToken: string,
  baseUrl?: string,
  opts: FetchProviderUsageOptions = {},
): Promise<ProviderUsageSnapshot> {
  const key = usageCacheKey(providerKey, accessToken, baseUrl);
  const snapshot = await withProviderUsageCache(
    key,
    providerUsageTtlMs(providerKey),
    opts.refresh === true,
    () => fetchProviderUsageUncached(providerKey, accessToken, baseUrl, opts),
  );
  return finalizeUsageSnapshot(snapshot);
}
