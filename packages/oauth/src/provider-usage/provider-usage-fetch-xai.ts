import { providerDisplayName } from './provider-usage-display';
import { headerNum, headerResetHint } from './provider-usage-parse';
import type { ProviderUsageRow, ProviderUsageSnapshot } from './provider-usage-types';

export async function fetchXaiGrokUsage(
  providerKey: string,
  accessToken: string,
  baseUrl?: string,
  opts: { timeoutMs?: number } = {},
): Promise<ProviderUsageSnapshot> {
  // xAI returns x-ratelimit-* headers on every successful API response.
  // A lightweight GET /models call captures the current rate-limit state.
  const base = (baseUrl ?? 'https://cli-chat-proxy.grok.com/v1').replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000);
  try {
    const res = await fetch(`${base}/models`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'X-XAI-Token-Auth': 'xai-grok-cli',
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      return {
        providerKey,
        displayName: providerDisplayName(providerKey),
        available: true,
        summary: null,
        limits: [],
        error: res.status === 401 ? 'Token expired. Try /login.' : `HTTP ${String(res.status)}`,
        fetchedAtMs: Date.now(),
      };
    }
    // Parse rate-limit headers returned by the xAI API.
    const limits: ProviderUsageRow[] = [];
    const reqLimit = headerNum(res, 'x-ratelimit-limit-requests');
    const reqRemaining = headerNum(res, 'x-ratelimit-remaining-requests');
    if (reqLimit !== null && reqRemaining !== null && reqLimit > 0) {
      const used = reqLimit - reqRemaining;
      const resetHint = headerResetHint(res, 'x-ratelimit-reset-requests');
      limits.push({ label: 'Requests', used, limit: reqLimit, resetHint });
    }
    const tokLimit = headerNum(res, 'x-ratelimit-limit-tokens');
    const tokRemaining = headerNum(res, 'x-ratelimit-remaining-tokens');
    if (tokLimit !== null && tokRemaining !== null && tokLimit > 0) {
      const used = tokLimit - tokRemaining;
      const resetHint = headerResetHint(res, 'x-ratelimit-reset-tokens');
      limits.push({ label: 'Tokens/min', used, limit: tokLimit, resetHint });
    }
    const summary: ProviderUsageRow | null = limits.length > 0 ? limits[0]! : null;
    return {
      providerKey,
      displayName: providerDisplayName(providerKey),
      available: limits.length > 0,
      summary,
      limits: limits.slice(summary !== null ? 1 : 0),
      fetchedAtMs: Date.now(),
    };
  } catch (error) {
    return {
      providerKey,
      displayName: providerDisplayName(providerKey),
      available: true,
      summary: null,
      limits: [],
      error: error instanceof Error && error.name === 'AbortError'
        ? 'Request timed out.'
        : error instanceof Error ? error.message : String(error),
      fetchedAtMs: Date.now(),
    };
  } finally {
    clearTimeout(timer);
  }
}
