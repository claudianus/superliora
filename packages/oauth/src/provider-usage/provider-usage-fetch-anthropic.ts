import { isRecord } from '../utils';
import { providerDisplayName } from './provider-usage-display';
import { formatResetHint, headerNum, headerResetHint, numField } from './provider-usage-parse';
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

function anthropicOauthUsageEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env['SUPERLIORA_EXPERIMENTAL_ANTHROPIC_OAUTH'] ?? '1').trim().toLowerCase();
  return raw !== '0' && raw !== 'false' && raw !== 'off';
}

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

function parseUtilizationBucket(data: unknown, label: string): ProviderUsageRow | null {
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
  return {
    providerKey,
    displayName: providerDisplayName(providerKey),
    available: rows.length > 0,
    summary,
    limits: summary === null ? rows : rows.slice(1),
    fetchedAtMs: Date.now(),
    source: extra.source ?? 'response-headers',
    ...extra,
  };
}

function limitsFromAnthropicHeaders(res: Response): ProviderUsageRow[] {
  const limits: ProviderUsageRow[] = [];
  const reqLimit = headerNum(res, 'anthropic-ratelimit-requests-limit');
  const reqRemaining = headerNum(res, 'anthropic-ratelimit-requests-remaining');
  if (reqLimit !== null && reqRemaining !== null && reqLimit > 0) {
    const resetHint = headerResetHint(res, 'anthropic-ratelimit-requests-reset');
    limits.push({
      label: 'Requests/min',
      used: reqLimit - reqRemaining,
      limit: reqLimit,
      ...(resetHint !== undefined ? { resetHint } : {}),
    });
  }
  const inputLimit = headerNum(res, 'anthropic-ratelimit-input-tokens-limit');
  const inputRemaining = headerNum(res, 'anthropic-ratelimit-input-tokens-remaining');
  if (inputLimit !== null && inputRemaining !== null && inputLimit > 0) {
    const resetHint = headerResetHint(res, 'anthropic-ratelimit-input-tokens-reset');
    limits.push({
      label: 'Input tokens/min',
      used: inputLimit - inputRemaining,
      limit: inputLimit,
      ...(resetHint !== undefined ? { resetHint } : {}),
    });
  }
  const outputLimit = headerNum(res, 'anthropic-ratelimit-output-tokens-limit');
  const outputRemaining = headerNum(res, 'anthropic-ratelimit-output-tokens-remaining');
  if (outputLimit !== null && outputRemaining !== null && outputLimit > 0) {
    const resetHint = headerResetHint(res, 'anthropic-ratelimit-output-tokens-reset');
    limits.push({
      label: 'Output tokens/min',
      used: outputLimit - outputRemaining,
      limit: outputLimit,
      ...(resetHint !== undefined ? { resetHint } : {}),
    });
  }
  return limits;
}

async function fetchCountTokensHeaders(
  providerKey: string,
  accessToken: string,
  base: string,
  signal: AbortSignal,
): Promise<ProviderUsageSnapshot> {
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
    signal,
  });
  if (!res.ok && res.status !== 400) {
    return snapshotFromRows(providerKey, [], {
      available: true,
      error: res.status === 401 ? 'Token expired. Try /login.' : `HTTP ${String(res.status)}`,
      source: 'response-headers',
    });
  }
  const limits = limitsFromAnthropicHeaders(res);
  return snapshotFromRows(providerKey, limits, { source: 'response-headers' });
}

/**
 * Default: lightweight `count_tokens` + `anthropic-ratelimit-*` headers.
 * `/api/oauth/usage` is ToS-fragile — only tried when `anthropic_oauth` is on,
 * and count_tokens remains the fallback.
 */
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
    if (anthropicOauthUsageEnabled()) {
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
        if (res.ok) {
          const rows = parseAnthropicOAuthUsage(await res.json());
          if (rows.length > 0) {
            return snapshotFromRows(providerKey, rows, { source: 'oauth-api' });
          }
        }
      } catch {
        // Fall through to count_tokens — usage endpoint is optional.
      }
    }
    return await fetchCountTokensHeaders(providerKey, accessToken, base, controller.signal);
  } catch (error) {
    return snapshotFromRows(providerKey, [], {
      available: true,
      error:
        error instanceof Error && error.name === 'AbortError'
          ? 'Request timed out.'
          : error instanceof Error
            ? error.message
            : String(error),
      source: 'response-headers',
    });
  } finally {
    clearTimeout(timer);
  }
}
