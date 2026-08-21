import { isRecord } from '../utils';
import { finalizeUsageSnapshot, providerDisplayName } from './provider-usage-display';
import { formatResetHint, numField } from './provider-usage-parse';
import type { ProviderUsageRow, ProviderUsageSnapshot } from './provider-usage-types';

function parseReset(raw: unknown): string | undefined {
  if (typeof raw === 'string') {
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) return formatResetHint(parsed);
    return undefined;
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const ms = raw > 1e11 ? raw : raw * 1000;
    return formatResetHint(ms);
  }
  return undefined;
}

/** Pure parser for GET /api/v1/key. */
export function parseOpenRouterKeyPayload(payload: unknown): {
  readonly rows: ProviderUsageRow[];
  readonly remainingDisplay: string;
  readonly accountLabel?: string;
} {
  if (!isRecord(payload)) return { rows: [], remainingDisplay: '' };
  const data = isRecord(payload['data']) ? payload['data'] : payload;
  const remaining = numField(data, 'limit_remaining') ?? numField(data, 'limitRemaining');
  const limit = numField(data, 'limit');
  const usage = numField(data, 'usage');
  const resetHint = parseReset(data['limit_reset'] ?? data['limitReset']);
  const accountLabel = typeof data['label'] === 'string' ? data['label'] : undefined;
  const rows: ProviderUsageRow[] = [];

  if (remaining !== null && remaining >= 0) {
    const used = limit !== null && limit > 0 ? Math.max(0, limit - remaining) : 0;
    const resolvedLimit = limit !== null && limit > 0 ? limit : remaining;
    rows.push({
      label: 'Credits',
      used,
      limit: resolvedLimit,
      ...(resetHint !== undefined ? { resetHint } : {}),
    });
  } else if (limit !== null && usage !== null && limit > 0) {
    rows.push({
      label: 'Credits',
      used: usage,
      limit,
      ...(resetHint !== undefined ? { resetHint } : {}),
    });
  }

  for (const [key, label] of [
    ['usage_daily', 'Daily usage'],
    ['usage_weekly', 'Weekly usage'],
    ['usage_monthly', 'Monthly usage'],
  ] as const) {
    const value = numField(data, key);
    if (value === null) continue;
    rows.push({ label, used: value, limit: Math.max(value, 1) });
  }

  const remainingDisplay =
    remaining !== null && remaining >= 0 ? `OR $${remaining >= 100 ? remaining.toFixed(0) : remaining.toFixed(2)}` : '';
  return {
    rows,
    remainingDisplay,
    ...(accountLabel !== undefined ? { accountLabel } : {}),
  };
}

export async function fetchOpenRouterUsage(
  providerKey: string,
  accessToken: string,
  baseUrl?: string,
  opts: { timeoutMs?: number } = {},
): Promise<ProviderUsageSnapshot> {
  const base = (baseUrl ?? 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, opts.timeoutMs ?? 8000);
  try {
    const res = await fetch(`${base}/key`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      const error =
        res.status === 401
          ? 'Invalid OpenRouter API key.'
          : res.status === 404
            ? 'Usage API not available.'
            : `HTTP ${String(res.status)}`;
      return finalizeUsageSnapshot({
        providerKey,
        displayName: providerDisplayName(providerKey),
        available: false,
        summary: null,
        limits: [],
        error,
        fetchedAtMs: Date.now(),
        kind: 'api-credits',
        source: 'oauth-api',
        status: res.status === 401 ? 'auth-required' : res.status === 404 ? 'unavailable' : 'error',
      });
    }
    const parsed = parseOpenRouterKeyPayload(await res.json());
    const summary = parsed.rows[0] ?? null;
    return finalizeUsageSnapshot({
      providerKey,
      displayName: providerDisplayName(providerKey),
      available: parsed.rows.length > 0,
      summary,
      limits: summary === null ? parsed.rows : parsed.rows.slice(1),
      fetchedAtMs: Date.now(),
      kind: 'api-credits',
      source: 'oauth-api',
      remainingDisplay: parsed.remainingDisplay,
      ...(parsed.accountLabel !== undefined ? { accountLabel: parsed.accountLabel } : {}),
    });
  } catch (error) {
    return finalizeUsageSnapshot({
      providerKey,
      displayName: providerDisplayName(providerKey),
      available: false,
      summary: null,
      limits: [],
      error:
        error instanceof Error && error.name === 'AbortError'
          ? 'Request timed out.'
          : error instanceof Error
            ? error.message
            : String(error),
      fetchedAtMs: Date.now(),
      kind: 'api-credits',
      source: 'oauth-api',
      status: 'error',
    });
  } finally {
    clearTimeout(timer);
  }
}
