/** Last-response rate-limit window captured from chat HTTP headers. */
export interface ResponseRateLimit {
  readonly name: string;
  readonly limit?: number;
  readonly remaining?: number;
  readonly resetAt?: number;
}

const BUCKETS = [
  {
    name: 'requests',
    limit: 'x-ratelimit-limit-requests',
    remaining: 'x-ratelimit-remaining-requests',
    reset: 'x-ratelimit-reset-requests',
  },
  {
    name: 'tokens',
    limit: 'x-ratelimit-limit-tokens',
    remaining: 'x-ratelimit-remaining-tokens',
    reset: 'x-ratelimit-reset-tokens',
  },
  {
    name: 'requests',
    limit: 'anthropic-ratelimit-requests-limit',
    remaining: 'anthropic-ratelimit-requests-remaining',
    reset: 'anthropic-ratelimit-requests-reset',
  },
  {
    name: 'tokens',
    limit: 'anthropic-ratelimit-tokens-limit',
    remaining: 'anthropic-ratelimit-tokens-remaining',
    reset: 'anthropic-ratelimit-tokens-reset',
  },
  {
    name: 'input_tokens',
    limit: 'anthropic-ratelimit-input-tokens-limit',
    remaining: 'anthropic-ratelimit-input-tokens-remaining',
    reset: 'anthropic-ratelimit-input-tokens-reset',
  },
  {
    name: 'output_tokens',
    limit: 'anthropic-ratelimit-output-tokens-limit',
    remaining: 'anthropic-ratelimit-output-tokens-remaining',
    reset: 'anthropic-ratelimit-output-tokens-reset',
  },
] as const;

function headerValue(headers: unknown, name: string): string | undefined {
  if (headers === undefined || headers === null) return undefined;
  if (typeof (headers as { get?: unknown }).get === 'function') {
    const value = (headers as { get(name: string): unknown }).get(name);
    return typeof value === 'string' ? value : undefined;
  }
  if (typeof headers !== 'object') return undefined;
  const record = headers as Record<string, unknown>;
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(record)) {
    if (key.toLowerCase() === lower && typeof value === 'string') return value;
  }
  return undefined;
}

function parseNumeric(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value.trim());
  return Number.isFinite(n) ? n : undefined;
}

function parseResetAt(raw: string | undefined, nowMs: number): number | undefined {
  if (raw === undefined) return undefined;
  const asDate = Date.parse(raw);
  if (!Number.isNaN(asDate)) return asDate;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  if (n > 1e11) return n;
  if (n > 1e9) return n * 1000;
  return nowMs + n * 1000;
}

/** Parse `x-ratelimit-*` / `anthropic-ratelimit-*` from a chat response. */
export function parseResponseRateLimits(
  headers: unknown,
  nowMs: number = Date.now(),
): ResponseRateLimit[] {
  if (headers === undefined || headers === null) return [];
  const out: ResponseRateLimit[] = [];
  const seen = new Set<string>();
  for (const bucket of BUCKETS) {
    const limit = parseNumeric(headerValue(headers, bucket.limit));
    const remaining = parseNumeric(headerValue(headers, bucket.remaining));
    const resetAt = parseResetAt(headerValue(headers, bucket.reset), nowMs);
    if (limit === undefined && remaining === undefined && resetAt === undefined) continue;
    if (seen.has(bucket.name)) continue;
    seen.add(bucket.name);
    out.push({
      name: bucket.name,
      ...(limit !== undefined ? { limit } : {}),
      ...(remaining !== undefined ? { remaining } : {}),
      ...(resetAt !== undefined ? { resetAt } : {}),
    });
  }
  const retryAfter = headerValue(headers, 'retry-after');
  if (retryAfter !== undefined) {
    // `retry-after` is the server's explicit backoff directive: always surface
    // it, even when bucket headers are also present (they describe quota state,
    // not when to retry). Routers prefer this entry for 429 scheduling.
    const resetAt = parseResetAt(retryAfter, nowMs);
    out.push({ name: 'retry-after', ...(resetAt !== undefined ? { resetAt } : {}) });
  }
  return out;
}
