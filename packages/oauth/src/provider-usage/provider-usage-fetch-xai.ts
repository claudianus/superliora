/**
 * xAI Grok usage — subscription credits window for Grok Build logins, with
 * response-header rate limits as the fallback / API-route probe.
 *
 * Grok Build subscription quota is a weekly credits pool that the Build proxy
 * bills (`grok` CLI sessions draw it down). The proxy exposes the live window:
 *
 *   GET {build}/v1/billing?format=credits
 *   → { config: { creditUsagePercent?, currentPeriod: { type:
 *       "USAGE_PERIOD_TYPE_WEEKLY", end } } }
 *
 * This mirrors the probe opencodex uses for SuperGrok accounts: the weekly
 * credits window is the number that actually gates prompting — far more
 * useful than the per-minute request headers a /models call returns. Legacy
 * monthly dollar envelopes (`monthlyLimit` / `used`, cents) stay supported
 * when the credits payload is absent.
 *
 * The public API route (`api.x.ai`) has no queryable usage endpoint, so it
 * keeps the existing response-header rate-limit probe.
 */

import {
  resolveXaiGrokRoute,
  XAI_GROK_BUILD_BASE_URL,
  xaiGrokBuildAuthHeaders,
} from '../profiles/xai';
import { isRecord } from '../utils';
import { providerDisplayName } from './provider-usage-display';
import { formatResetHint, headerNum, headerResetHint } from './provider-usage-parse';
import type { ProviderUsageRow, ProviderUsageSnapshot } from './provider-usage-types';

function normalizePercent(value: unknown): number | null {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : NaN;
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.min(100, numeric));
}

function resetAtMs(value: unknown): number | null {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : NaN;
  // 0 is the proto3 default ("unset"), not an epoch reset.
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric > 1e11 ? numeric : numeric * 1000;
}

function centsValue(value: unknown): number | null {
  const rec = isRecord(value) ? value : null;
  const val = rec?.['val'];
  if (typeof val !== 'number' || !Number.isFinite(val)) return null;
  return val;
}

/**
 * Decode the `sub` claim (xAI user id) from an OAuth access-token JWT. The
 * Build billing endpoint expects `x-userid` alongside the bearer token.
 */
export function xaiGrokUserIdFromAccessToken(accessToken: string): string | undefined {
  const parts = accessToken.split('.');
  if (parts.length < 2 || parts[1] === undefined) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as {
      sub?: unknown;
    };
    if (typeof payload.sub !== 'string') return undefined;
    const sub = payload.sub.trim();
    return sub.length > 0 ? sub : undefined;
  } catch {
    return undefined;
  }
}

export interface XaiGrokCreditsReading {
  /** 0..100 used share of the governing window. */
  readonly usedPercent: number;
  readonly resetAtMs: number | null;
  readonly label: string;
}

/**
 * Parse the Grok Build billing envelope. Prefers the weekly credits window
 * (`format=credits`); a legacy monthly dollar envelope is returned with a
 * Monthly label when the weekly shape is missing.
 *
 * Proto3 semantics: a `currentPeriod` of type `USAGE_PERIOD_TYPE_WEEKLY` with
 * no percent means 0 used, not "unknown".
 */
export function parseXaiGrokBillingCredits(payload: unknown): XaiGrokCreditsReading | null {
  const body = isRecord(payload) ? payload : null;
  if (body === null) return null;
  const config = isRecord(body['config']) ? body['config'] : null;
  if (config === null) return null;

  const period = isRecord(config['currentPeriod']) ? config['currentPeriod'] : null;
  if (period?.['type'] === 'USAGE_PERIOD_TYPE_WEEKLY') {
    let usedPercent = 0;
    if (config['creditUsagePercent'] !== undefined) {
      const normalized = normalizePercent(config['creditUsagePercent']);
      if (normalized === null) return null;
      usedPercent = normalized;
    }
    return {
      usedPercent,
      resetAtMs: resetAtMs(period['end']),
      label: 'Weekly credits',
    };
  }

  // Legacy monthly dollar pool: used / monthlyLimit (cents), optional
  // billingPeriodEnd. Kept as a fallback when weekly is unavailable.
  const limitCents = centsValue(config['monthlyLimit']);
  const usedCents = centsValue(config['used']);
  if (limitCents === null || usedCents === null || limitCents <= 0) return null;
  const normalized = normalizePercent((usedCents / limitCents) * 100);
  if (normalized === null) return null;
  return {
    usedPercent: normalized,
    resetAtMs: resetAtMs(config['billingPeriodEnd']),
    label: 'Monthly credits',
  };
}

function snapshotFromRow(
  providerKey: string,
  row: ProviderUsageRow,
  extra: Partial<ProviderUsageSnapshot> = {},
): ProviderUsageSnapshot {
  return {
    providerKey,
    displayName: providerDisplayName(providerKey),
    available: true,
    summary: row,
    limits: [],
    fetchedAtMs: Date.now(),
    source: 'oauth-api',
    kind: 'subscription',
    ...extra,
  };
}

function errorSnapshot(
  providerKey: string,
  error: string,
  extra: Partial<ProviderUsageSnapshot> = {},
): ProviderUsageSnapshot {
  return {
    providerKey,
    displayName: providerDisplayName(providerKey),
    available: true,
    summary: null,
    limits: [],
    error,
    fetchedAtMs: Date.now(),
    ...extra,
  };
}

function rateLimitRows(res: Response): ProviderUsageRow[] {
  const limits: ProviderUsageRow[] = [];
  const reqLimit = headerNum(res, 'x-ratelimit-limit-requests');
  const reqRemaining = headerNum(res, 'x-ratelimit-remaining-requests');
  if (reqLimit !== null && reqRemaining !== null && reqLimit > 0) {
    limits.push({
      label: 'Requests',
      used: reqLimit - reqRemaining,
      limit: reqLimit,
      resetHint: headerResetHint(res, 'x-ratelimit-reset-requests'),
    });
  }
  const tokLimit = headerNum(res, 'x-ratelimit-limit-tokens');
  const tokRemaining = headerNum(res, 'x-ratelimit-remaining-tokens');
  if (tokLimit !== null && tokRemaining !== null && tokLimit > 0) {
    limits.push({
      label: 'Tokens/min',
      used: tokLimit - tokRemaining,
      limit: tokLimit,
      resetHint: headerResetHint(res, 'x-ratelimit-reset-tokens'),
    });
  }
  return limits;
}

/** GET /models probe — the public-API / fallback path for header rate limits. */
async function probeModelsRateLimits(
  providerKey: string,
  base: string,
  accessToken: string,
  buildRoute: boolean,
  signal: AbortSignal,
): Promise<ProviderUsageSnapshot> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
  };
  if (buildRoute) Object.assign(headers, xaiGrokBuildAuthHeaders());
  const res = await fetch(`${base}/models`, { headers, signal });
  if (!res.ok) {
    return errorSnapshot(
      providerKey,
      res.status === 401 ? 'Token expired. Try /login.' : `HTTP ${String(res.status)}`,
      { source: 'response-headers' },
    );
  }
  const limits = rateLimitRows(res);
  const summary = limits[0] ?? null;
  return {
    providerKey,
    displayName: providerDisplayName(providerKey),
    available: limits.length > 0,
    summary,
    limits: summary === null ? [] : limits.slice(1),
    fetchedAtMs: Date.now(),
    source: 'response-headers',
  };
}

/** Grok Build subscription: probe the live weekly credits window. */
async function probeBuildCredits(
  providerKey: string,
  base: string,
  accessToken: string,
  signal: AbortSignal,
): Promise<ProviderUsageSnapshot | null> {
  const userId = xaiGrokUserIdFromAccessToken(accessToken);
  try {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
      // The Grok CLI's response-authenticity marker. The Build proxy is billed
      // against CLI sessions, and the official client sends this on every
      // request (opencodex sends it on this same billing call).
      'x-authenticateresponse': 'authenticate-response',
      ...xaiGrokBuildAuthHeaders(),
    };
    if (userId !== undefined) headers['x-userid'] = userId;
    const res = await fetch(`${base}/billing?format=credits`, { headers, signal });
    if (!res.ok) return null;
    const reading = parseXaiGrokBillingCredits(await res.json());
    if (reading === null) return null;
    const row: ProviderUsageRow = {
      label: reading.label,
      used: reading.usedPercent,
      limit: 100,
      ...(reading.resetAtMs !== null ? { resetHint: formatResetHint(reading.resetAtMs) } : {}),
    };
    return snapshotFromRow(providerKey, row);
  } catch {
    return null;
  }
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
  try {
    const buildRoute = resolveXaiGrokRoute(baseUrl) === 'build';
    if (buildRoute) {
      // Prefer the live weekly credits window; fall through to the header
      // probe when billing is unavailable (API-metered key or a proxy
      // without the endpoint).
      const credits = await probeBuildCredits(providerKey, base, accessToken, controller.signal);
      if (credits !== null) return credits;
    }
    return await probeModelsRateLimits(
      providerKey,
      base,
      accessToken,
      buildRoute,
      controller.signal,
    );
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
