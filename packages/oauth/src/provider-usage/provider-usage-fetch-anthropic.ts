import { isRecord } from '../utils';
import { finalizeUsageSnapshot, providerDisplayName } from './provider-usage-display';
import { formatResetHint, numField } from './provider-usage-parse';
import type { ProviderUsageRow, ProviderUsageSnapshot } from './provider-usage-types';

const ANTHROPIC_USAGE_PATH = '/api/oauth/usage';
const ANTHROPIC_BETA = 'oauth-2025-04-20';
/** Required by the usage endpoint — other UAs 429 immediately. */
const ANTHROPIC_USAGE_UA = 'claude-code/';

const BUCKETS = [
  { key: 'five_hour', label: '5-hour limit' },
  { key: 'seven_day', label: 'Weekly limit' },
  { key: 'seven_day_opus', label: 'Weekly Opus' },
  { key: 'seven_day_sonnet', label: 'Weekly Sonnet' },
  { key: 'extra_usage', label: 'Extra usage' },
] as const;

function resetAtMs(bucket: Record<string, unknown>): number | null {
  const raw =
    bucket['resets_at'] ?? bucket['reset_at'] ?? bucket['resetsAt'] ?? bucket['resetAt'];
  if (typeof raw === 'string') {
    const parsed = Date.parse(raw);
    return Number.isNaN(parsed) ? null : parsed;
  }
  const num = numField(bucket, 'resets_at') ?? numField(bucket, 'reset_at');
  if (num === null) return null;
  return num > 1e11 ? num : num * 1000;
}

function parseUtilizationBucket(
  data: unknown,
  label: string,
): ProviderUsageRow | null {
  if (!isRecord(data)) return null;
  const utilization = numField(data, 'utilization') ?? numField(data, 'used_percent');
  if (utilization === null) return null;
  const used = Math.max(0, Math.min(100, utilization));
  const resetHint = formatResetHint(resetAtMs(data));
  return { label, used, limit: 100, ...(resetHint !== undefined ? { resetHint } : {}) };
}

/** Pure parser: fixture JSON → quota rows. Null buckets are omitted. */
export function parseAnthropicOAuthUsage(payload: unknown): ProviderUsageRow[] {
  if (!isRecord(payload)) return [];
  const root = isRecord(payload['data']) ? payload['data'] : payload;
  const rows: ProviderUsageRow[] = [];
  for (const bucket of BUCKETS) {
    const row = parseUtilizationBucket(root[bucket.key], bucket.label);
    if (row !== null) rows.push(row);
  }
  return rows;
}

function snapshotFromRows(
  providerKey: string,
  rows: ProviderUsageRow[],
  extra: Partial<ProviderUsageSnapshot> = {},
): ProviderUsageSnapshot {
  const summary = rows[0] ?? null;
  return finalizeUsageSnapshot({
    providerKey,
    displayName: providerDisplayName(providerKey),
    available: rows.length > 0,
    summary,
    limits: summary === null ? rows : rows.slice(1),
    fetchedAtMs: Date.now(),
    kind: 'subscription',
    source: 'oauth-api',
    ...extra,
  });
}

export async function fetchAnthropicUsage(
  providerKey: string,
  accessToken: string,
  baseUrl?: string,
  opts: { timeoutMs?: number } = {},
): Promise<ProviderUsageSnapshot> {
  const base = (baseUrl ?? 'https://api.anthropic.com').replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, opts.timeoutMs ?? 8000);
  try {
    const res = await fetch(`${base}${ANTHROPIC_USAGE_PATH}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'anthropic-beta': ANTHROPIC_BETA,
        'User-Agent': ANTHROPIC_USAGE_UA,
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      const status =
        res.status === 401
          ? 'auth-required'
          : res.status === 429
            ? 'rate-limited'
            : res.status === 404
              ? 'unavailable'
              : 'error';
      const error =
        res.status === 401
          ? 'API-key or expired token — Claude subscription usage needs OAuth. Try /login.'
          : res.status === 429
            ? 'Usage endpoint rate-limited. Try again in a few minutes.'
            : res.status === 404
              ? 'Usage API not available for this account.'
              : `HTTP ${String(res.status)}`;
      return snapshotFromRows(providerKey, [], {
        available: false,
        status,
        error,
      });
    }
    const json: unknown = await res.json();
    return snapshotFromRows(providerKey, parseAnthropicOAuthUsage(json));
  } catch (error) {
    return snapshotFromRows(providerKey, [], {
      available: false,
      status: 'error',
      error:
        error instanceof Error && error.name === 'AbortError'
          ? 'Request timed out.'
          : error instanceof Error
            ? error.message
            : String(error),
    });
  } finally {
    clearTimeout(timer);
  }
}
