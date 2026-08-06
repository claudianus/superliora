/**
 * Provider route failure classification and rate-limit header parsing.
 *
 * Pure helpers extracted from kosong-llm so failover policy can be tested
 * and evolved independently of the LLM chat lifecycle.
 */

import {
  APIConnectionError,
  APIEmptyResponseError,
  APIStatusError,
  APITimeoutError,
  isProviderCapacityError,
  isProviderRateLimitError,
  isTransientNoBodyStatusError,
  isTransientTryAgainError,
} from '@superliora/kosong';

import { ErrorCodes, isKimiError } from '../../errors';
import type { ProviderRouteRateLimitStatus } from '#/rpc';
import type { ProviderRouteFailure } from './provider-route-types';

const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 60_000;
const DEFAULT_AUTH_COOLDOWN_MS = 5 * 60_000;
const DEFAULT_QUOTA_COOLDOWN_MS = 60 * 60_000;
const DEFAULT_SERVER_COOLDOWN_MS = 30_000;
const DEFAULT_CONNECTION_COOLDOWN_MS = 30_000;
const DEFAULT_EMPTY_COOLDOWN_MS = 5_000;
const MAX_RETRY_AFTER_COOLDOWN_MS = 24 * 60 * 60_000;
const RATE_LIMIT_HEADER_BUCKETS = [
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
    name: 'project_tokens',
    limit: 'x-ratelimit-limit-project-tokens',
    remaining: 'x-ratelimit-remaining-project-tokens',
    reset: 'x-ratelimit-reset-project-tokens',
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
  {
    name: 'priority_input_tokens',
    limit: 'anthropic-priority-input-tokens-limit',
    remaining: 'anthropic-priority-input-tokens-remaining',
    reset: 'anthropic-priority-input-tokens-reset',
  },
  {
    name: 'priority_output_tokens',
    limit: 'anthropic-priority-output-tokens-limit',
    remaining: 'anthropic-priority-output-tokens-remaining',
    reset: 'anthropic-priority-output-tokens-reset',
  },
  {
    name: 'generic',
    limit: 'ratelimit-limit',
    remaining: 'ratelimit-remaining',
    reset: 'ratelimit-reset',
  },
  {
    name: 'generic',
    limit: 'rate-limit-limit',
    remaining: 'rate-limit-remaining',
    reset: 'rate-limit-reset',
  },
  {
    name: 'generic',
    limit: 'x-ratelimit-limit',
    remaining: 'x-ratelimit-remaining',
    reset: 'x-ratelimit-reset',
  },
  {
    name: 'generic',
    limit: 'x-rate-limit-limit',
    remaining: 'x-rate-limit-remaining',
    reset: 'x-rate-limit-reset',
  },
] as const satisfies readonly RateLimitHeaderBucket[];
const RATE_LIMIT_RESET_HEADERS_WITHOUT_REMAINING = [
  'ratelimit-reset',
  'rate-limit-reset',
  'x-ratelimit-reset',
  'x-rate-limit-reset',
] as const;
const PROVIDER_QUOTA_MESSAGE_PATTERNS = [
  /insufficient[_\s-]?quota/,
  /quota\s+exceed(?:ed|s|ing)?/,
  /exceed(?:ed|s|ing)?\s+(?:your\s+)?(?:current\s+)?quota/,
  /credit[_\s-]?balance[_\s-]?too[_\s-]?low/,
  /credit balance is too low/,
  /balance .*too low/,
  /insufficient.*(?:credit|balance|funds|quota)/,
  /(?:credit|credits).*(?:exhausted|depleted|expired|limit|spent)/,
  /(?:no|zero)\s+(?:credit|credits)\s+(?:remaining|left|available)/,
  /usage.*limit.*(?:reached|exceed(?:ed|s|ing)?)/,
  /spend.*limit.*(?:reached|exceed(?:ed|s|ing)?)/,
  /billing.*(?:limit|quota|credit|payment)/,
  /monthly.*(?:budget|spend).*limit/,
  /hard[_\s-]?limit/,
] as const;

interface RateLimitHeaderBucket {
  readonly name: string;
  readonly limit: string;
  readonly remaining: string;
  readonly reset: string;
}

export function classifyProviderRouteFailure(
  error: unknown,
  configuredCooldownMs: number | undefined,
): ProviderRouteFailure | undefined {
  const cooldownMs = (fallbackMs: number): number =>
    retryAfterCooldownMs(error) ?? configuredCooldownMs ?? fallbackMs;

  if (isKimiError(error)) {
    if (
      error.code === ErrorCodes.AUTH_LOGIN_REQUIRED ||
      error.code === ErrorCodes.PROVIDER_AUTH_ERROR
    ) {
      return { kind: 'auth', cooldownMs: cooldownMs(DEFAULT_AUTH_COOLDOWN_MS) };
    }
    if (isProviderQuotaError(error)) {
      return { kind: 'quota', cooldownMs: cooldownMs(DEFAULT_QUOTA_COOLDOWN_MS) };
    }
    if (error.code === ErrorCodes.PROVIDER_RATE_LIMIT) {
      return {
        kind: 'rate_limit',
        cooldownMs: cooldownMs(DEFAULT_RATE_LIMIT_COOLDOWN_MS),
      };
    }
    if (error.code === ErrorCodes.PROVIDER_CONNECTION_ERROR) {
      return {
        kind: 'connection',
        cooldownMs: cooldownMs(DEFAULT_CONNECTION_COOLDOWN_MS),
      };
    }
  }
  if (isProviderQuotaError(error)) {
    return { kind: 'quota', cooldownMs: cooldownMs(DEFAULT_QUOTA_COOLDOWN_MS) };
  }
  if (isProviderRateLimitError(error)) {
    return {
      kind: 'rate_limit',
      cooldownMs: cooldownMs(DEFAULT_RATE_LIMIT_COOLDOWN_MS),
    };
  }
  if (error instanceof APIConnectionError) {
    return {
      kind: 'connection',
      cooldownMs: cooldownMs(DEFAULT_CONNECTION_COOLDOWN_MS),
    };
  }
  if (error instanceof APITimeoutError) {
    return { kind: 'timeout', cooldownMs: cooldownMs(DEFAULT_CONNECTION_COOLDOWN_MS) };
  }
  if (error instanceof APIEmptyResponseError) {
    return { kind: 'empty', cooldownMs: cooldownMs(DEFAULT_EMPTY_COOLDOWN_MS) };
  }
  // xAI capacity / high-demand often surfaces as plain ChatProviderError without
  // a 5xx statusCode — still fail over / cooldown like a transient server blip.
  if (isProviderCapacityError(error)) {
    return { kind: 'server', cooldownMs: cooldownMs(DEFAULT_SERVER_COOLDOWN_MS) };
  }
  // Provider-declared "temporary / try again" signals (e.g. a 400
  // resource_exhausted) fail over like a transient server blip too.
  if (isTransientTryAgainError(error)) {
    return { kind: 'server', cooldownMs: cooldownMs(DEFAULT_SERVER_COOLDOWN_MS) };
  }
  if (!(error instanceof APIStatusError)) return undefined;

  if (error.statusCode === 401 || error.statusCode === 403) {
    return { kind: 'auth', cooldownMs: cooldownMs(DEFAULT_AUTH_COOLDOWN_MS) };
  }
  if (error.statusCode === 402) {
    return { kind: 'quota', cooldownMs: cooldownMs(DEFAULT_QUOTA_COOLDOWN_MS) };
  }
  if (error.statusCode >= 500 && error.statusCode <= 504) {
    return { kind: 'server', cooldownMs: cooldownMs(DEFAULT_SERVER_COOLDOWN_MS) };
  }
  // Body-less 400 gateway glitches fail over / cool down like a transient
  // server blip instead of ending the route immediately.
  if (isTransientNoBodyStatusError(error)) {
    return { kind: 'server', cooldownMs: cooldownMs(DEFAULT_SERVER_COOLDOWN_MS) };
  }
  return undefined;
}

export function classifyProviderRouteHeaders(headers: unknown): ProviderRouteFailure | undefined {
  const cooldownMs = exhaustedRateLimitCooldownMs([headers]);
  if (cooldownMs === undefined) return undefined;
  return { kind: 'rate_limit', cooldownMs };
}

export function providerRouteRateLimits(headers: unknown): ProviderRouteRateLimitStatus[] {
  const rateLimits: ProviderRouteRateLimitStatus[] = [];
  for (const bucket of RATE_LIMIT_HEADER_BUCKETS) {
    const limit = parseNumericHeader(headerValue(headers, bucket.limit));
    const remaining = parseNumericHeader(headerValue(headers, bucket.remaining));
    const resetMs = parseRateLimitResetMs(headerValue(headers, bucket.reset));
    if (limit === undefined && remaining === undefined && resetMs === undefined) continue;
    rateLimits.push({
      name: bucket.name,
      limit,
      remaining,
      resetAt: resetMs === undefined ? undefined : Date.now() + resetMs,
    });
  }
  return rateLimits;
}

function isProviderQuotaError(error: unknown): boolean {
  const text = errorSignalText(error).toLowerCase();
  return PROVIDER_QUOTA_MESSAGE_PATTERNS.some((pattern) => pattern.test(text));
}

function errorSignalText(value: unknown, depth = 0): string {
  if (depth > 5 || value === undefined || value === null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value instanceof Error) {
    const record = value as unknown as Record<string, unknown>;
    const parts = [value.name, value.message];
    for (const key of ['code', 'type', 'error', 'details', 'body', 'data', 'response']) {
      parts.push(errorSignalText(record[key], depth + 1));
    }
    return parts.filter((part) => part.length > 0).join(' ');
  }
  if (typeof value !== 'object') return '';

  const record = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of ['code', 'type', 'message', 'error', 'details', 'body', 'data', 'response']) {
    parts.push(errorSignalText(record[key], depth + 1));
  }
  return parts.filter((part) => part.length > 0).join(' ');
}

function retryAfterCooldownMs(error: unknown): number | undefined {
  const detailsRetryAfterMs = kimiErrorRetryAfterMs(error);
  if (detailsRetryAfterMs !== undefined) return detailsRetryAfterMs;

  const headerSources = errorHeaderSources(error);
  for (const headers of headerSources) {
    const retryAfterMs =
      headerValue(headers, 'retry-after-ms') ?? headerValue(headers, 'x-retry-after-ms');
    const parsedMs = parseRetryAfterMs(retryAfterMs, 'milliseconds');
    if (parsedMs !== undefined) return parsedMs;

    const retryAfter =
      headerValue(headers, 'retry-after') ??
      headerValue(headers, 'x-retry-after') ??
      headerValue(headers, 'llm_provider-retry-after');
    const parsed = parseRetryAfterMs(retryAfter, 'seconds-or-date');
    if (parsed !== undefined) return parsed;
  }
  return rateLimitResetCooldownMs(headerSources);
}

function rateLimitResetCooldownMs(headerSources: readonly unknown[]): number | undefined {
  const exhaustedResets: number[] = [];
  const fallbackResets: number[] = [];

  for (const headers of headerSources) {
    exhaustedResets.push(...exhaustedRateLimitResetCooldowns(headers));

    for (const resetHeader of RATE_LIMIT_RESET_HEADERS_WITHOUT_REMAINING) {
      const reset = parseRateLimitResetMs(headerValue(headers, resetHeader));
      if (reset !== undefined) fallbackResets.push(reset);
    }
  }

  if (exhaustedResets.length > 0) return Math.max(...exhaustedResets);
  if (fallbackResets.length > 0) return Math.min(...fallbackResets);
  return undefined;
}

function exhaustedRateLimitResetCooldownMs(
  headerSources: readonly unknown[],
): number | undefined {
  const exhaustedResets = headerSources.flatMap((headers) =>
    exhaustedRateLimitResetCooldowns(headers),
  );
  if (exhaustedResets.length === 0) return undefined;
  return Math.max(...exhaustedResets);
}

function exhaustedRateLimitCooldownMs(headerSources: readonly unknown[]): number | undefined {
  const resetCooldownMs = exhaustedRateLimitResetCooldownMs(headerSources);
  if (resetCooldownMs !== undefined) return resetCooldownMs;
  return headerSources.some((headers) => hasExhaustedRateLimitBucket(headers))
    ? DEFAULT_RATE_LIMIT_COOLDOWN_MS
    : undefined;
}

function exhaustedRateLimitResetCooldowns(headers: unknown): number[] {
  const exhaustedResets: number[] = [];
  for (const bucket of RATE_LIMIT_HEADER_BUCKETS) {
    const reset = parseRateLimitResetMs(headerValue(headers, bucket.reset));
    if (reset === undefined) continue;
    const remaining = parseNumericHeader(headerValue(headers, bucket.remaining));
    if (remaining !== undefined && remaining <= 0) {
      exhaustedResets.push(reset);
    }
  }
  return exhaustedResets;
}

function hasExhaustedRateLimitBucket(headers: unknown): boolean {
  return RATE_LIMIT_HEADER_BUCKETS.some((bucket) => {
    const remaining = parseNumericHeader(headerValue(headers, bucket.remaining));
    return remaining !== undefined && remaining <= 0;
  });
}

function kimiErrorRetryAfterMs(error: unknown): number | undefined {
  if (!isKimiError(error)) return undefined;
  const value = error.details?.['retryAfterMs'];
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.min(Math.ceil(value), MAX_RETRY_AFTER_COOLDOWN_MS);
}

function errorHeaderSources(error: unknown): unknown[] {
  if (typeof error !== 'object' || error === null) return [];
  const record = error as Record<string, unknown>;
  const sources: unknown[] = [record['headers']];
  const response = record['response'];
  if (typeof response === 'object' && response !== null) {
    sources.push((response as Record<string, unknown>)['headers']);
  }
  const cause = record['cause'];
  if (typeof cause === 'object' && cause !== null) {
    sources.push((cause as Record<string, unknown>)['headers']);
  }
  return sources.filter((source) => source !== undefined);
}

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
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    const first = value.find((entry) => typeof entry === 'string' || typeof entry === 'number');
    return normalizeHeaderValue(first);
  }
  return undefined;
}

function parseRetryAfterMs(
  value: string | undefined,
  mode: 'milliseconds' | 'seconds-or-date',
): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;

  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && numeric > 0) {
    const ms = mode === 'milliseconds' ? numeric : numeric * 1000;
    return Math.min(Math.ceil(ms), MAX_RETRY_AFTER_COOLDOWN_MS);
  }

  if (mode !== 'seconds-or-date') return undefined;
  const dateMs = Date.parse(trimmed);
  if (!Number.isFinite(dateMs)) return undefined;
  const ms = dateMs - Date.now();
  if (ms <= 0) return undefined;
  return Math.min(Math.ceil(ms), MAX_RETRY_AFTER_COOLDOWN_MS);
}

function parseRateLimitResetMs(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;

  const durationMs = parseDurationMs(trimmed);
  if (durationMs !== undefined) return durationMs;

  const dateMs = Date.parse(trimmed);
  if (Number.isFinite(dateMs)) {
    const ms = dateMs - Date.now();
    if (ms > 0) return Math.min(Math.ceil(ms), MAX_RETRY_AFTER_COOLDOWN_MS);
  }

  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  const nowSeconds = Date.now() / 1000;
  const ms = numeric > nowSeconds ? numeric * 1000 - Date.now() : numeric * 1000;
  if (ms <= 0) return undefined;
  return Math.min(Math.ceil(ms), MAX_RETRY_AFTER_COOLDOWN_MS);
}

function parseDurationMs(value: string): number | undefined {
  const durationPattern = /(\d+(?:\.\d+)?)(ms|s|m|h|d)/gi;
  let total = 0;
  let matched = false;
  let end = 0;
  for (const match of value.matchAll(durationPattern)) {
    if (match.index !== end) return undefined;
    const amount = Number(match[1]);
    const unit = match[2]?.toLowerCase();
    if (!Number.isFinite(amount) || unit === undefined) return undefined;
    matched = true;
    end = match.index + match[0].length;
    switch (unit) {
      case 'ms':
        total += amount;
        break;
      case 's':
        total += amount * 1000;
        break;
      case 'm':
        total += amount * 60_000;
        break;
      case 'h':
        total += amount * 60 * 60_000;
        break;
      case 'd':
        total += amount * 24 * 60 * 60_000;
        break;
    }
  }
  if (!matched || end !== value.length || total <= 0) return undefined;
  return Math.min(Math.ceil(total), MAX_RETRY_AFTER_COOLDOWN_MS);
}

function parseNumericHeader(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : undefined;
}
export function maybeStatusCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return typeof statusCode === 'number' ? statusCode : undefined;
}
