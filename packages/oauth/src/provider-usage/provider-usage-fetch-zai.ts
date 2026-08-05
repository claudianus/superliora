import { isRecord } from '../utils';
import { providerDisplayName } from './provider-usage-display';
import { formatResetHint, numField } from './provider-usage-parse';
import type { ProviderUsageRow, ProviderUsageSnapshot } from './provider-usage-types';

export const ZAI_QUOTA_API_BASE = 'https://api.z.ai';

/**
 * Z.AI GLM Coding Plan quota endpoint (undocumented but stable; the same one
 * z.ai's own subscription UI calls):
 *
 *   GET {base}/api/monitor/usage/quota/limit
 *   → { data: { limits: [ { type, unit, number, usage, currentValue,
 *       remaining, percentage, nextResetTime } ] } }
 *
 * TOKENS_LIMIT windows: unit 3 = 5-hour session, unit 6 = 7-day weekly.
 * TIME_LIMIT: monthly web search / reader / zread tool-call count.
 */
export async function fetchZaiUsage(
  providerKey: string,
  accessToken: string,
  baseUrl?: string,
  opts: { timeoutMs?: number } = {},
): Promise<ProviderUsageSnapshot> {
  const base = (baseUrl ?? ZAI_QUOTA_API_BASE).replace(/\/+$/, '');
  const url = `${base}/api/monitor/usage/quota/limit`;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, opts.timeoutMs ?? 8000);
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Accept-Language': 'en-US,en',
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      const hint =
        res.status === 401
          ? 'Invalid API key or session expired.'
          : res.status === 403
            ? 'No active GLM Coding Plan on this key.'
            : `HTTP ${String(res.status)}`;
      return errorSnapshot(providerKey, hint);
    }
    const json = (await res.json()) as Record<string, unknown>;
    const data = isRecord(json['data']) ? json['data'] : json;
    const rawLimits = Array.isArray(data['limits']) ? data['limits'] : [];

    const rows: ProviderUsageRow[] = [];
    for (const entry of rawLimits) {
      if (!isRecord(entry)) continue;
      const row = parseZaiLimitEntry(entry);
      if (row !== null) rows.push(row);
    }

    // Weekly token window is the most stable summary; fall back to 5-hour,
    // then to the monthly tool-call meter.
    const summary =
      rows.find((row) => row.label === 'Weekly limit') ??
      rows.find((row) => row.label === '5-hour limit') ??
      rows[0] ??
      null;
    return {
      providerKey,
      displayName: providerDisplayName(providerKey),
      available: rows.length > 0,
      summary,
      limits: summary === null ? rows : rows.filter((row) => row !== summary),
      fetchedAtMs: Date.now(),
    };
  } catch (error) {
    return errorSnapshot(
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

function parseZaiLimitEntry(entry: Record<string, unknown>): ProviderUsageRow | null {
  const type = typeof entry['type'] === 'string' ? entry['type'] : '';
  const unit = numField(entry, 'unit');
  const used = numField(entry, 'currentValue') ?? numField(entry, 'used');
  const limit = numField(entry, 'usage') ?? numField(entry, 'limit');
  if (used === null || limit === null || limit <= 0) return null;

  let label: string;
  if (type === 'TOKENS_LIMIT') {
    label = unit === 6 ? 'Weekly limit' : '5-hour limit';
  } else if (type === 'TIME_LIMIT') {
    label = 'Monthly tool calls (search/reader/zread)';
  } else {
    label = type.length > 0 ? type : 'Usage';
  }

  let resetHint: string | undefined;
  const nextReset = numField(entry, 'nextResetTime');
  if (nextReset !== null && nextReset > 0) {
    resetHint = formatResetHint(nextReset);
  }
  return { label, used, limit, ...(resetHint !== undefined ? { resetHint } : {}) };
}

function errorSnapshot(providerKey: string, error: string): ProviderUsageSnapshot {
  return {
    providerKey,
    displayName: providerDisplayName(providerKey),
    available: true,
    summary: null,
    limits: [],
    error,
    fetchedAtMs: Date.now(),
  };
}
