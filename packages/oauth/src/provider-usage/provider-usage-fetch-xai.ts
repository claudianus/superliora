import { isRecord } from '../utils';
import {
  resolveXaiGrokRoute,
  XAI_GROK_BUILD_BASE_URL,
  xaiGrokBuildAuthHeaders,
} from '../profiles/xai';
import { finalizeUsageSnapshot, providerDisplayName } from './provider-usage-display';
import { headerNum, headerResetHint, numField } from './provider-usage-parse';
import type { ProviderUsageRow, ProviderUsageSnapshot } from './provider-usage-types';

export const XAI_BILLING_URL = 'https://cli-chat-proxy.grok.com/v1/billing?format=credits';

function parseBillingCredits(payload: unknown): ProviderUsageRow | null {
  if (!isRecord(payload)) return null;
  const data = isRecord(payload['data']) ? payload['data'] : payload;
  const remaining =
    numField(data, 'credits') ??
    numField(data, 'remaining') ??
    numField(data, 'balance') ??
    numField(data, 'credits_remaining');
  if (remaining === null || remaining < 0) return null;
  return { label: 'Credits', used: 0, limit: remaining };
}

function headersFromModels(res: Response): ProviderUsageRow[] {
  const limits: ProviderUsageRow[] = [];
  const reqLimit = headerNum(res, 'x-ratelimit-limit-requests');
  const reqRemaining = headerNum(res, 'x-ratelimit-remaining-requests');
  if (reqLimit !== null && reqRemaining !== null && reqLimit > 0) {
    const used = reqLimit - reqRemaining;
    const resetHint = headerResetHint(res, 'x-ratelimit-reset-requests');
    limits.push({ label: 'Requests', used, limit: reqLimit, ...(resetHint !== undefined ? { resetHint } : {}) });
  }
  const tokLimit = headerNum(res, 'x-ratelimit-limit-tokens');
  const tokRemaining = headerNum(res, 'x-ratelimit-remaining-tokens');
  if (tokLimit !== null && tokRemaining !== null && tokLimit > 0) {
    const used = tokLimit - tokRemaining;
    const resetHint = headerResetHint(res, 'x-ratelimit-reset-tokens');
    limits.push({ label: 'Tokens/min', used, limit: tokLimit, ...(resetHint !== undefined ? { resetHint } : {}) });
  }
  return limits;
}

function fail(providerKey: string, error: string): ProviderUsageSnapshot {
  return finalizeUsageSnapshot({
    providerKey,
    displayName: providerDisplayName(providerKey),
    available: false,
    summary: null,
    limits: [],
    error,
    fetchedAtMs: Date.now(),
    kind: 'subscription',
    source: 'oauth-api',
  });
}

export async function fetchXaiGrokUsage(
  providerKey: string,
  accessToken: string,
  baseUrl?: string,
  opts: { timeoutMs?: number } = {},
): Promise<ProviderUsageSnapshot> {
  const base = (baseUrl ?? XAI_GROK_BUILD_BASE_URL).replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, opts.timeoutMs ?? 8000);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
  };
  if (resolveXaiGrokRoute(baseUrl) === 'build') {
    Object.assign(headers, xaiGrokBuildAuthHeaders());
  }
  try {
    try {
      const billing = await fetch(XAI_BILLING_URL, { headers, signal: controller.signal });
      if (billing.ok) {
        const row = parseBillingCredits(await billing.json());
        if (row !== null) {
          return finalizeUsageSnapshot({
            providerKey,
            displayName: providerDisplayName(providerKey),
            available: true,
            summary: row,
            limits: [],
            fetchedAtMs: Date.now(),
            kind: 'api-credits',
            source: 'oauth-api',
            remainingDisplay: `Grok $${row.limit >= 100 ? row.limit.toFixed(0) : row.limit.toFixed(2)}`,
          });
        }
      }
    } catch {
      // Undocumented billing probe — fall through to /models headers.
    }

    const res = await fetch(`${base}/models`, {
      headers,
      signal: controller.signal,
    });
    if (!res.ok) {
      return fail(
        providerKey,
        res.status === 401 ? 'Token expired. Try /login.' : `HTTP ${String(res.status)}`,
      );
    }
    const limits = headersFromModels(res);
    const summary = limits[0] ?? null;
    return finalizeUsageSnapshot({
      providerKey,
      displayName: providerDisplayName(providerKey),
      available: limits.length > 0,
      summary,
      limits: summary === null ? limits : limits.slice(1),
      fetchedAtMs: Date.now(),
      kind: 'rate-limit',
      source: 'response-headers',
    });
  } catch (error) {
    return fail(
      providerKey,
      error instanceof Error && error.name === 'AbortError'
        ? 'Request timed out.'
        : error instanceof Error
          ? error.message
          : String(error),
    );
  } finally {
    clearTimeout(timer);
  }
}
