import { providerDisplayName } from './provider-usage-display';
import { headerNum, headerResetHint } from './provider-usage-parse';
import type { ProviderUsageRow, ProviderUsageSnapshot } from './provider-usage-types';

export async function fetchAnthropicUsage(
  providerKey: string,
  accessToken: string,
  baseUrl?: string,
  opts: { timeoutMs?: number } = {},
): Promise<ProviderUsageSnapshot> {
  // Anthropic returns anthropic-ratelimit-* headers on every API response.
  // The /v1/messages/count_tokens endpoint is the lightest authenticated call
  // that still returns rate-limit headers without generating completions.
  const base = (baseUrl ?? 'https://api.anthropic.com').replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000);
  try {
    const res = await fetch(`${base}/v1/messages/count_tokens`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'hi' }],
      }),
      signal: controller.signal,
    });
    if (!res.ok && res.status !== 400) {
      // 400 may still carry rate-limit headers; other errors are fatal.
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
    // Parse Anthropic rate-limit headers.
    const limits: ProviderUsageRow[] = [];
    const reqLimit = headerNum(res, 'anthropic-ratelimit-requests-limit');
    const reqRemaining = headerNum(res, 'anthropic-ratelimit-requests-remaining');
    if (reqLimit !== null && reqRemaining !== null && reqLimit > 0) {
      const used = reqLimit - reqRemaining;
      const resetHint = headerResetHint(res, 'anthropic-ratelimit-requests-reset');
      limits.push({ label: 'Requests/min', used, limit: reqLimit, resetHint });
    }
    const inputLimit = headerNum(res, 'anthropic-ratelimit-input-tokens-limit');
    const inputRemaining = headerNum(res, 'anthropic-ratelimit-input-tokens-remaining');
    if (inputLimit !== null && inputRemaining !== null && inputLimit > 0) {
      const used = inputLimit - inputRemaining;
      const resetHint = headerResetHint(res, 'anthropic-ratelimit-input-tokens-reset');
      limits.push({ label: 'Input tokens/min', used, limit: inputLimit, resetHint });
    }
    const outputLimit = headerNum(res, 'anthropic-ratelimit-output-tokens-limit');
    const outputRemaining = headerNum(res, 'anthropic-ratelimit-output-tokens-remaining');
    if (outputLimit !== null && outputRemaining !== null && outputLimit > 0) {
      const used = outputLimit - outputRemaining;
      const resetHint = headerResetHint(res, 'anthropic-ratelimit-output-tokens-reset');
      limits.push({ label: 'Output tokens/min', used, limit: outputLimit, resetHint });
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
