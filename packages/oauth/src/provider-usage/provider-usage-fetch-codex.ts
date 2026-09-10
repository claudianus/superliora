/**
 * OpenAI Codex (ChatGPT subscription) usage — `GET {backend}/wham/usage`.
 *
 * Parsing mirrors the opencodex codex quota engine: WHAM reports up to three
 * windows (`primary` / `secondary` / `tertiary`) whose MEANING is carried by
 * their declared duration, never by their position alone:
 *
 *   - a declared duration shorter than 24h is a burst window (the 5-hour
 *     Codex limit) — folding it into the weekly reading reports the wrong
 *     bar and hides the window that actually gates the account;
 *   - a declared duration ≥ 28 days is a monthly/30-day window (primary on
 *     Go/Free plans, tertiary on Team/Plus monthly quotas);
 *   - everything else (including windows that omit `limit_window_seconds`,
 *     as legacy payloads do) is the weekly window.
 *
 * The Go and Free plans report a 30-day primary window only; all other plans
 * (plus/pro/team/business/edu/k12/…) report weekly. The response also carries
 * the account plan and email, which the TUI shows next to the bars.
 *
 * Older flat payloads (`five_hour` / `weekly` / `monthly` keys, epoch-ms or
 * epoch-s resets, `used_percent` aliases) stay supported.
 */

import { isRecord } from '../utils';
import { providerDisplayName } from './provider-usage-display';
import { formatResetHint, numField } from './provider-usage-parse';
import type { ProviderUsageRow, ProviderUsageSnapshot } from './provider-usage-types';

/** WHAM window durations: <24h is a burst window, ≥28d is a monthly window. */
const WEEKLY_WINDOW_MIN_SECONDS = 24 * 60 * 60;
const MONTHLY_WINDOW_MIN_SECONDS = 28 * 24 * 60 * 60;

/** Plans whose WHAM primary window is the 30-day window, not the weekly one. */
const MONTHLY_ONLY_PLAN_KEYS = new Set(['go', 'free']);

interface CodexUsageWindow {
  /** 0..100 used share. */
  readonly usedPercent: number;
  readonly resetAtMs: number | null;
  readonly windowSeconds: number | null;
}

interface CodexWindowBundle {
  short: ProviderUsageRow | null;
  weekly: ProviderUsageRow | null;
  monthly: ProviderUsageRow | null;
}

export interface OpenAiCodexWhamParse {
  /** Quota rows in display order: governing window first. */
  readonly rows: readonly ProviderUsageRow[];
  /** Account plan when the payload reports one (`plus`, `go`, …). */
  readonly plan?: string;
  /** Account email when the payload reports one. */
  readonly accountEmail?: string;
}

function planKey(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed.toLowerCase() : undefined;
}

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
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  // WHAM reports epoch seconds; older responses used epoch ms.
  return numeric > 1e11 ? numeric : numeric * 1000;
}

function windowSeconds(value: unknown): number | null {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : NaN;
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function monthlyLabelFor(plan: string | undefined): string {
  return MONTHLY_ONLY_PLAN_KEYS.has(plan ?? '') ? '30-day limit' : 'Monthly limit';
}

/** Parse one window record; null when no usable used-percent is present. */
function parseWindowRecord(raw: Record<string, unknown>): CodexUsageWindow | null {
  const usedPercent =
    normalizePercent(raw['used_percent'] ?? raw['usedPercent']) ??
    (() => {
      const left = normalizePercent(raw['percent_left'] ?? raw['remaining_percent']);
      return left === null ? null : 100 - left;
    })();
  if (usedPercent === null) return null;
  const resetRaw = numField(raw, 'reset_at') ?? numField(raw, 'reset_time_ms') ?? raw['reset_at'];
  return {
    usedPercent,
    resetAtMs: resetAtMs(resetRaw),
    windowSeconds: windowSeconds(numField(raw, 'limit_window_seconds')),
  };
}

function toRow(
  window: CodexUsageWindow,
  label: string,
  resetAtMsOverride: number | null = window.resetAtMs,
): ProviderUsageRow {
  return {
    label,
    used: window.usedPercent,
    limit: 100,
    ...(resetAtMsOverride !== null ? { resetHint: formatResetHint(resetAtMsOverride) } : {}),
  };
}

/**
 * Pure WHAM payload → quota rows. Accepts both the modern nested shape
 * (`rate_limit.{primary,secondary,tertiary}_window`) and the legacy flat
 * shape (`five_hour` / `weekly` / `monthly`).
 */
export function parseOpenAiCodexWhamUsage(payload: unknown): OpenAiCodexWhamParse {
  if (!isRecord(payload)) return { rows: [] };
  const plan = planKey(payload['plan_type']);
  const accountEmail =
    typeof payload['email'] === 'string' && payload['email'].trim().length > 0
      ? payload['email'].trim()
      : undefined;

  const rateLimit = isRecord(payload['rate_limit']) ? payload['rate_limit'] : null;
  const bundle: CodexWindowBundle = { short: null, weekly: null, monthly: null };
  // First window of a kind wins (primary outranks tertiary for the same slot).
  const put = (window: CodexUsageWindow | null, kind: 'short' | 'weekly' | 'monthly'): void => {
    if (window === null) return;
    if (kind === 'short') {
      if (bundle.short === null) bundle.short = toRow(window, '5-hour limit');
    } else if (kind === 'weekly') {
      if (bundle.weekly === null) bundle.weekly = toRow(window, 'Weekly limit');
    } else if (bundle.monthly === null) {
      bundle.monthly = toRow(window, monthlyLabelFor(plan));
    }
  };

  /** Duration role of a parsed window. Missing duration falls back to role. */
  const kindOf = (
    window: CodexUsageWindow | null,
    role: 'primary' | 'secondary' | 'tertiary',
  ): 'short' | 'weekly' | 'monthly' => {
    if (window === null) return 'weekly';
    const seconds = window.windowSeconds;
    if (seconds !== null && seconds < WEEKLY_WINDOW_MIN_SECONDS) return 'short';
    if (seconds !== null && seconds >= MONTHLY_WINDOW_MIN_SECONDS) return 'monthly';
    if (role === 'primary') return MONTHLY_ONLY_PLAN_KEYS.has(plan ?? '') ? 'monthly' : 'weekly';
    return role === 'tertiary' ? 'monthly' : 'weekly';
  };

  if (rateLimit !== null) {
    // Modern nested shape: `rate_limit.{primary,secondary,tertiary}_window`.
    const parseOne = (
      raw: unknown,
      role: 'primary' | 'secondary' | 'tertiary',
    ): void => {
      const window = parseWindowRecord(isRecord(raw) ? raw : {});
      put(window, kindOf(window, role));
    };
    parseOne(rateLimit['primary_window'], 'primary');
    parseOne(rateLimit['secondary_window'], 'secondary');
    parseOne(rateLimit['tertiary_window'], 'tertiary');
  } else {
    // Legacy flat payloads: five_hour / weekly / monthly objects.
    for (const [key, kind] of [
      ['five_hour', 'short'],
      ['weekly', 'weekly'],
      ['monthly', 'monthly'],
    ] as const) {
      const raw = payload[key];
      put(parseWindowRecord(isRecord(raw) ? raw : {}), kind);
    }
  }

  // Display order: governing window first, then burst, then supplementary.
  const rows: ProviderUsageRow[] = [];
  const push = (row: ProviderUsageRow | null): void => {
    if (row !== null) rows.push(row);
  };
  push(bundle.weekly);
  push(bundle.monthly);
  push(bundle.short);
  return {
    rows,
    ...(plan !== undefined ? { plan } : {}),
    ...(accountEmail !== undefined ? { accountEmail } : {}),
  };
}

/**
 * Fetch the ChatGPT Codex usage endpoint. Fails open: an unavailable usage
 * API must never look like an exhausted account (`available: true` + error),
 * which keeps smart routing from avoiding a healthy credential.
 */
export async function fetchOpenAiCodexUsage(
  providerKey: string,
  accessToken: string,
  baseUrl?: string,
  opts: { timeoutMs?: number } = {},
): Promise<ProviderUsageSnapshot> {
  const base = (baseUrl ?? 'https://chatgpt.com/backend-api').replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, opts.timeoutMs ?? 8000);
  try {
    const res = await fetch(`${base}/wham/usage`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        Origin: 'https://chatgpt.com',
        Referer: 'https://chatgpt.com/',
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      const hint =
        res.status === 401
          ? 'Token expired. Try /login.'
          : res.status === 403
            ? 'Account cannot access Codex usage.'
            : `HTTP ${String(res.status)}`;
      return {
        providerKey,
        displayName: providerDisplayName(providerKey),
        available: true,
        summary: null,
        limits: [],
        error: hint,
        fetchedAtMs: Date.now(),
      };
    }
    const json: unknown = await res.json();
    const parsed = parseOpenAiCodexWhamUsage(json);
    const summary = parsed.rows[0] ?? null;
    return {
      providerKey,
      displayName: providerDisplayName(providerKey),
      available: true,
      summary,
      limits: summary === null ? [] : parsed.rows.slice(1),
      fetchedAtMs: Date.now(),
      source: 'oauth-api',
      kind: 'subscription',
      ...(parsed.plan !== undefined ? { plan: parsed.plan } : {}),
      ...(parsed.accountEmail !== undefined ? { accountLabel: parsed.accountEmail } : {}),
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
