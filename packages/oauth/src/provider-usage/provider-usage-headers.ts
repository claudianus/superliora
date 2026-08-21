import { formatResetHint } from './provider-usage-parse';
import type { ProviderUsageRow, RouteRateLimitInput } from './provider-usage-types';

const HEADER_BUCKETS = [
  {
    label: 'Requests',
    limit: ['x-ratelimit-limit-requests', 'x-ratelimit-limit'],
    remaining: ['x-ratelimit-remaining-requests', 'x-ratelimit-remaining'],
    reset: ['x-ratelimit-reset-requests', 'x-ratelimit-reset'],
  },
  {
    label: 'Tokens',
    limit: ['x-ratelimit-limit-tokens'],
    remaining: ['x-ratelimit-remaining-tokens'],
    reset: ['x-ratelimit-reset-tokens'],
  },
  {
    label: 'Requests',
    limit: ['anthropic-ratelimit-requests-limit'],
    remaining: ['anthropic-ratelimit-requests-remaining'],
    reset: ['anthropic-ratelimit-requests-reset'],
  },
  {
    label: 'Tokens',
    limit: ['anthropic-ratelimit-tokens-limit'],
    remaining: ['anthropic-ratelimit-tokens-remaining'],
    reset: ['anthropic-ratelimit-tokens-reset'],
  },
  {
    label: 'Input tokens',
    limit: ['anthropic-ratelimit-input-tokens-limit'],
    remaining: ['anthropic-ratelimit-input-tokens-remaining'],
    reset: ['anthropic-ratelimit-input-tokens-reset'],
  },
  {
    label: 'Output tokens',
    limit: ['anthropic-ratelimit-output-tokens-limit'],
    remaining: ['anthropic-ratelimit-output-tokens-remaining'],
    reset: ['anthropic-ratelimit-output-tokens-reset'],
  },
] as const;

function headerValue(headers: unknown, name: string): string | undefined {
  if (headers === undefined || headers === null) return undefined;
  if (typeof (headers as { get?: unknown }).get === 'function') {
    const value = (headers as { get(name: string): unknown }).get(name);
    return normalizeHeaderValue(value);
  }
  if (headers instanceof Map) {
    return normalizeHeaderValue(headers.get(name) ?? headers.get(name.toLowerCase()));
  }
  if (typeof headers !== 'object') return undefined;
  const record = headers as Record<string, unknown>;
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(record)) {
    if (key.toLowerCase() === lowerName) return normalizeHeaderValue(value);
  }
  return undefined;
}

function normalizeHeaderValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) {
    const first = value.find((entry) => typeof entry === 'string' || typeof entry === 'number');
    return normalizeHeaderValue(first);
  }
  return undefined;
}

function parseNumeric(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value.trim());
  return Number.isFinite(n) ? n : undefined;
}

function firstHeader(headers: unknown, names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = headerValue(headers, name);
    if (value !== undefined) return value;
  }
  return undefined;
}

function resetHintFromHeader(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const asDate = Date.parse(raw);
  if (!Number.isNaN(asDate)) return formatResetHint(asDate);
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) {
    const ms = numeric > 1e11 ? numeric : numeric > 1e9 ? numeric * 1000 : numeric * 1000;
    return formatResetHint(Date.now() + (numeric > 1e9 ? ms - Date.now() : numeric * 1000));
  }
  return `resets in ${raw}`;
}

/** Parse last-response rate-limit headers into usage rows. Empty when unknown. */
export function parseRateLimitHeaders(headers: unknown): ProviderUsageRow[] {
  if (headers === undefined || headers === null) return [];
  const rows: ProviderUsageRow[] = [];
  const seen = new Set<string>();
  for (const bucket of HEADER_BUCKETS) {
    const limit = parseNumeric(firstHeader(headers, bucket.limit));
    const remaining = parseNumeric(firstHeader(headers, bucket.remaining));
    if (limit === undefined || remaining === undefined || !(limit > 0)) continue;
    if (seen.has(bucket.label)) continue;
    seen.add(bucket.label);
    const used = Math.max(0, limit - remaining);
    const resetHint = resetHintFromHeader(firstHeader(headers, bucket.reset));
    rows.push({
      label: bucket.label,
      used,
      limit,
      ...(resetHint !== undefined ? { resetHint } : {}),
    });
  }
  const retryAfter = headerValue(headers, 'retry-after');
  if (retryAfter !== undefined && rows.length === 0) {
    const hint = resetHintFromHeader(retryAfter);
    rows.push({
      label: 'Retry-After',
      used: 0,
      limit: 1,
      ...(hint !== undefined ? { resetHint: hint } : {}),
    });
  }
  return rows;
}

export function usageRowsFromRouteRateLimits(
  rateLimits: readonly RouteRateLimitInput[] | undefined,
): ProviderUsageRow[] {
  if (rateLimits === undefined || rateLimits.length === 0) return [];
  const rows: ProviderUsageRow[] = [];
  for (const item of rateLimits) {
    if (item.limit === undefined || item.remaining === undefined || !(item.limit > 0)) continue;
    const used = Math.max(0, item.limit - item.remaining);
    const resetHint =
      item.resetAt !== undefined && Number.isFinite(item.resetAt)
        ? formatResetHint(item.resetAt)
        : undefined;
    rows.push({
      label: item.name,
      used,
      limit: item.limit,
      ...(resetHint !== undefined ? { resetHint } : {}),
    });
  }
  return rows;
}
