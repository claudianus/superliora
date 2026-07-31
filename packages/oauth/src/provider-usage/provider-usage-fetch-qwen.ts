import { providerDisplayName } from './provider-usage-display';
import { headerNum, headerResetHint } from './provider-usage-parse';
import type { ProviderUsageRow, ProviderUsageSnapshot } from './provider-usage-types';

export async function fetchQwenTokenPlanUsage(
  providerKey: string,
  accessToken: string,
  baseUrl?: string,
  opts: { timeoutMs?: number } = {},
): Promise<ProviderUsageSnapshot> {
  const base = (baseUrl ?? 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1').replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() =>{  controller.abort(); }, opts.timeoutMs ?? 8000);
  try {
    const res = await fetch(`${base}/models`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
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
        error: res.status === 401
          ? 'Invalid API key.'
          : res.status === 429
            ? 'Rate limited — quota may be exhausted.'
            : `HTTP ${String(res.status)}`,
        fetchedAtMs: Date.now(),
      };
    }
    // Parse rate-limit headers if the gateway returns them.
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
    // Also check Alibaba-specific headers (x-dashscope-*).
    const dsTokLimit = headerNum(res, 'x-dashscope-ratelimit-tokens-limit');
    const dsTokRemaining = headerNum(res, 'x-dashscope-ratelimit-tokens-remaining');
    if (dsTokLimit !== null && dsTokRemaining !== null && dsTokLimit > 0) {
      const used = dsTokLimit - dsTokRemaining;
      limits.push({ label: 'Token Plan tokens', used, limit: dsTokLimit });
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
