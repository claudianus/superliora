import { providerDisplayName } from './provider-usage-display';
import { headerNum, headerResetHint } from './provider-usage-parse';
import type { ProviderUsageRow, ProviderUsageSnapshot } from './provider-usage-types';

/** Groq `remaining-requests` is RPD (requests per day), not RPM. */
export function parseGroqRateLimitHeaders(res: Response): ProviderUsageRow[] {
  const limits: ProviderUsageRow[] = [];
  const reqLimit = headerNum(res, 'x-ratelimit-limit-requests');
  const reqRemaining = headerNum(res, 'x-ratelimit-remaining-requests');
  if (reqLimit !== null && reqRemaining !== null && reqLimit > 0) {
    const resetHint = headerResetHint(res, 'x-ratelimit-reset-requests');
    limits.push({
      label: 'Requests/day',
      used: reqLimit - reqRemaining,
      limit: reqLimit,
      ...(resetHint !== undefined ? { resetHint } : {}),
    });
  }
  const tokLimit = headerNum(res, 'x-ratelimit-limit-tokens');
  const tokRemaining = headerNum(res, 'x-ratelimit-remaining-tokens');
  if (tokLimit !== null && tokRemaining !== null && tokLimit > 0) {
    const resetHint = headerResetHint(res, 'x-ratelimit-reset-tokens');
    limits.push({
      label: 'Tokens/min',
      used: tokLimit - tokRemaining,
      limit: tokLimit,
      ...(resetHint !== undefined ? { resetHint } : {}),
    });
  }
  return limits;
}

export async function fetchGroqUsage(
  providerKey: string,
  accessToken: string,
  baseUrl?: string,
  opts: { timeoutMs?: number } = {},
): Promise<ProviderUsageSnapshot> {
  const base = (baseUrl ?? 'https://api.groq.com/openai/v1').replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, opts.timeoutMs ?? 8000);
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
        error: res.status === 401 ? 'Invalid API key.' : `HTTP ${String(res.status)}`,
        fetchedAtMs: Date.now(),
      };
    }
    const limits = parseGroqRateLimitHeaders(res);
    const summary = limits[0] ?? null;
    return {
      providerKey,
      displayName: providerDisplayName(providerKey),
      available: limits.length > 0,
      summary,
      limits: summary === null ? limits : limits.slice(1),
      fetchedAtMs: Date.now(),
      source: 'response-headers',
    };
  } catch (error) {
    return {
      providerKey,
      displayName: providerDisplayName(providerKey),
      available: true,
      summary: null,
      limits: [],
      error:
        error instanceof Error && error.name === 'AbortError'
          ? 'Request timed out.'
          : error instanceof Error
            ? error.message
            : String(error),
      fetchedAtMs: Date.now(),
    };
  } finally {
    clearTimeout(timer);
  }
}
