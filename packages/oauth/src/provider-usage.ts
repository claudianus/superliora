/**
 * Multi-provider usage / quota querying.
 *
 * Queries real usage data for every OAuth-capable provider SuperLiora supports:
 *
 *   - **Kimi managed** (`managed:kimi-api`): first-class `/usages` endpoint
 *     with weekly + rate-limit windows.
 *   - **OpenAI Codex** (`openai-codex`): ChatGPT's private wham/usage endpoint
 *     returns 5-hour and weekly quota windows with used_percent, reset_at,
 *     credits balance, and per-model additional_rate_limits.
 *   - **xAI Grok** (`xai-grok`): rate-limit headers (x-ratelimit-limit-requests,
 *     x-ratelimit-remaining-requests, x-ratelimit-limit-tokens, etc.) captured
 *     from a lightweight GET /models call.
 *   - **Anthropic** (`anthropic-oauth`): rate-limit headers
 *     (anthropic-ratelimit-*-limit/remaining/reset) captured from the
 *     lightweight /v1/messages/count_tokens endpoint.
 *
 * The unified {@link ProviderUsageSnapshot} shape lets the TUI render a
 * consistent quota dashboard regardless of which providers are configured.
 */

import { readApiErrorMessage } from './api-error';
import { isManagedKimiCode, kimiCodeUsageUrl, parseManagedUsagePayload, type ParsedManagedUsage, type UsageRow } from './managed-usage';
import { isRecord } from './utils';

// ── Unified snapshot types ────────────────────────────────────────────

/** A single quota / usage row for a provider. */
export interface ProviderUsageRow {
  readonly label: string;
  readonly used: number;
  readonly limit: number;
  readonly resetHint?: string | undefined;
}

/** Per-provider usage snapshot rendered by the TUI quota dashboard. */
export interface ProviderUsageSnapshot {
  /** Provider config key (e.g. `managed:kimi-api`, `openai-codex`). */
  readonly providerKey: string;
  /** Human-readable provider name. */
  readonly displayName: string;
  /** Whether the provider exposes a queryable usage API. */
  readonly available: boolean;
  /** Primary summary row (e.g. "Weekly limit"). Null when unavailable. */
  readonly summary: ProviderUsageRow | null;
  /** Additional rate-limit / quota rows. */
  readonly limits: readonly ProviderUsageRow[];
  /** Error message when the fetch failed. */
  readonly error?: string | undefined;
  /** Unix-ms timestamp of the last successful fetch. */
  readonly fetchedAtMs: number;
}

/** Aggregate snapshot across all configured providers. */
export interface AllProvidersUsageSnapshot {
  readonly providers: readonly ProviderUsageSnapshot[];
  /** The provider key that contributed the primary summary (first ok). */
  readonly primaryProviderKey: string | null;
  /** Worst usage ratio across all providers (0..1), for footer badge severity. */
  readonly worstRatio: number;
  readonly fetchedAtMs: number;
}

// ── Provider display names ────────────────────────────────────────────

const PROVIDER_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  'managed:kimi-api': 'Kimi (Subscription)',
  'managed:kimi-code': 'Kimi (Subscription)',
  'openai-codex': 'OpenAI Codex',
  'xai-grok': 'xAI Grok',
  'anthropic-oauth': 'Anthropic Claude',
  'clinepass': 'ClinePass',
  'qwen-token-plan': 'Qwen Token Plan',
};

export function providerDisplayName(providerKey: string): string {
  return PROVIDER_DISPLAY_NAMES[providerKey] ?? providerKey;
}

// ── Usage ratio helpers ───────────────────────────────────────────────

export function usageRowRatio(row: ProviderUsageRow): number {
  return row.limit > 0 ? Math.max(0, Math.min(row.used / row.limit, 1)) : 0;
}

export function snapshotWorstRatio(snapshot: ProviderUsageSnapshot): number {
  let worst = 0;
  if (snapshot.summary !== null) {
    worst = Math.max(worst, usageRowRatio(snapshot.summary));
  }
  for (const row of snapshot.limits) {
    worst = Math.max(worst, usageRowRatio(row));
  }
  return worst;
}

// ── Fetch: Kimi managed ───────────────────────────────────────────────

async function fetchKimiManagedUsage(
  providerKey: string,
  accessToken: string,
  baseUrl?: string,
  opts: { timeoutMs?: number } = {},
): Promise<ProviderUsageSnapshot> {
  const url = baseUrl !== undefined
    ? `${baseUrl.replace(/\/+$/, '')}/usages`
    : kimiCodeUsageUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000);
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) {
      const hint = res.status === 401
        ? 'Authorization failed. Try /login.'
        : res.status === 404
          ? 'Usage endpoint not available.'
          : `HTTP ${String(res.status)}`;
      return {
        providerKey,
        displayName: providerDisplayName(providerKey),
        available: true,
        summary: null,
        limits: [],
        error: await readApiErrorMessage(res, hint),
        fetchedAtMs: Date.now(),
      };
    }
    const json: unknown = await res.json();
    const parsed: ParsedManagedUsage = parseManagedUsagePayload(json);
    return {
      providerKey,
      displayName: providerDisplayName(providerKey),
      available: true,
      summary: parsed.summary !== null ? toProviderUsageRow(parsed.summary) : null,
      limits: parsed.limits.map(toProviderUsageRow),
      fetchedAtMs: Date.now(),
    };
  } catch (error) {
    return {
      providerKey,
      displayName: providerDisplayName(providerKey),
      available: true,
      summary: null,
      limits: [],
      error: error instanceof Error && error.name === 'AbortError'
        ? 'Request timed out.'
        : error instanceof Error ? error.message : String(error),
      fetchedAtMs: Date.now(),
    };
  } finally {
    clearTimeout(timer);
  }
}

function toProviderUsageRow(row: UsageRow): ProviderUsageRow {
  return { label: row.label, used: row.used, limit: row.limit, resetHint: row.resetHint };
}

// ── Fetch: OpenAI Codex (wham/usage private endpoint) ─────────────────

interface CodexUsageWindow {
  readonly label: string;
  readonly usedPercent: number;
  readonly resetAtMs: number | null;
  readonly windowSeconds: number | null;
}

function parseCodexWindow(data: Record<string, unknown>, label: string): CodexUsageWindow | null {
  // The backend uses varying field names across releases.
  const usedPercent = numField(data, 'used_percent') ?? numField(data, 'usedPercent');
  const percentLeft = numField(data, 'percent_left') ?? numField(data, 'remaining_percent');
  const resolvedUsed = usedPercent !== null ? usedPercent : percentLeft !== null ? 100 - percentLeft : null;
  if (resolvedUsed === null) return null;
  const resetRaw = numField(data, 'reset_at') ?? numField(data, 'reset_time_ms');
  let resetAtMs: number | null = null;
  if (resetRaw !== null) {
    // Older responses use epoch ms, newer use epoch seconds.
    resetAtMs = resetRaw > 1e11 ? resetRaw : resetRaw * 1000;
  }
  const windowSeconds = numField(data, 'limit_window_seconds');
  return { label, usedPercent: Math.max(0, Math.min(100, resolvedUsed)), resetAtMs, windowSeconds };
}

function numField(obj: Record<string, unknown>, key: string): number | null {
  const v = obj[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function formatResetHint(resetAtMs: number | null): string | undefined {
  if (resetAtMs === null) return undefined;
  const deltaMs = resetAtMs - Date.now();
  if (deltaMs <= 0) return 'resetting…';
  const mins = Math.ceil(deltaMs / 60_000);
  if (mins < 60) return `resets in ${String(mins)}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours < 24) return `resets in ${String(hours)}h${remMins > 0 ? ` ${String(remMins)}m` : ''}`;
  const days = Math.floor(hours / 24);
  return `resets in ${String(days)}d ${String(hours % 24)}h`;
}

async function fetchOpenAiCodexUsage(
  providerKey: string,
  accessToken: string,
  baseUrl?: string,
  opts: { timeoutMs?: number } = {},
): Promise<ProviderUsageSnapshot> {
  // ChatGPT's private Codex usage endpoint returns 5-hour and weekly quota
  // windows with used_percent, reset_at, and credits balance.
  const base = (baseUrl ?? 'https://chatgpt.com/backend-api').replace(/\/+$/, '');
  const url = `${base}/wham/usage`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000);
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        Origin: 'https://chatgpt.com',
        Referer: 'https://chatgpt.com/',
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      const hint = res.status === 401
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
    const json = await res.json() as Record<string, unknown>;
    const limits: ProviderUsageRow[] = [];

    // Parse primary (5-hour) window.
    const primaryRaw = firstRecord(json, 'five_hour', 'five_hour_limit', 'five_hour_rate_limit', 'primary', 'primary_window');
    if (primaryRaw !== null) {
      const w = parseCodexWindow(primaryRaw, '5-hour limit');
      if (w !== null) {
        limits.push({ label: w.label, used: w.usedPercent, limit: 100, resetHint: formatResetHint(w.resetAtMs) });
      }
    }

    // Parse secondary (weekly) window.
    const secondaryRaw = firstRecord(json, 'weekly', 'weekly_limit', 'weekly_rate_limit', 'secondary', 'secondary_window');
    if (secondaryRaw !== null) {
      const w = parseCodexWindow(secondaryRaw, 'Weekly limit');
      if (w !== null) {
        limits.push({ label: w.label, used: w.usedPercent, limit: 100, resetHint: formatResetHint(w.resetAtMs) });
      }
    }

    // Credits balance.
    const credits = numField(json, 'credits');
    if (credits !== null) {
      limits.push({ label: 'Credits', used: 0, limit: credits, resetHint: `${String(Math.round(credits))} available` });
    }

    // Additional named per-model limits.
    const additional = json['additional_rate_limits'];
    if (Array.isArray(additional)) {
      for (const entry of additional) {
        if (!isRecord(entry)) continue;
        const name = typeof entry['name'] === 'string' ? entry['name'] : undefined;
        const w = parseCodexWindow(entry, name ?? 'Model limit');
        if (w !== null) {
          limits.push({ label: w.label, used: w.usedPercent, limit: 100, resetHint: formatResetHint(w.resetAtMs) });
        }
      }
    }

    const summary: ProviderUsageRow | null = limits.length > 0 ? limits[0]! : null;
    return {
      providerKey,
      displayName: providerDisplayName(providerKey),
      available: true,
      summary,
      limits: limits.slice(summary !== null ? 1 : 0),
      fetchedAtMs: Date.now(),
    };
  } catch (error) {
    return {
      providerKey,
      displayName: providerDisplayName(providerKey),
      available: true,
      summary: null,
      limits: [],
      error: error instanceof Error && error.name === 'AbortError'
        ? 'Request timed out.'
        : error instanceof Error ? error.message : String(error),
      fetchedAtMs: Date.now(),
    };
  } finally {
    clearTimeout(timer);
  }
}

function firstRecord(obj: Record<string, unknown>, ...keys: string[]): Record<string, unknown> | null {
  for (const key of keys) {
    const v = obj[key];
    if (isRecord(v)) return v;
  }
  return null;
}

// ── Fetch: xAI Grok (rate-limit headers from models endpoint) ─────────

async function fetchXaiGrokUsage(
  providerKey: string,
  accessToken: string,
  baseUrl?: string,
  opts: { timeoutMs?: number } = {},
): Promise<ProviderUsageSnapshot> {
  // xAI returns x-ratelimit-* headers on every successful API response.
  // A lightweight GET /models call captures the current rate-limit state.
  const base = (baseUrl ?? 'https://cli-chat-proxy.grok.com/v1').replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000);
  try {
    const res = await fetch(`${base}/models`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'X-XAI-Token-Auth': 'xai-grok-cli',
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      return {
        providerKey,
        displayName: providerDisplayName(providerKey),
        available: true,
        summary: null,
        limits: [],
        error: res.status === 401 ? 'Token expired. Try /login.' : `HTTP ${String(res.status)}`,
        fetchedAtMs: Date.now(),
      };
    }
    // Parse rate-limit headers returned by the xAI API.
    const limits: ProviderUsageRow[] = [];
    const reqLimit = headerNum(res, 'x-ratelimit-limit-requests');
    const reqRemaining = headerNum(res, 'x-ratelimit-remaining-requests');
    if (reqLimit !== null && reqRemaining !== null && reqLimit > 0) {
      const used = reqLimit - reqRemaining;
      const resetHint = headerResetHint(res, 'x-ratelimit-reset-requests');
      limits.push({ label: 'Requests', used, limit: reqLimit, resetHint });
    }
    const tokLimit = headerNum(res, 'x-ratelimit-limit-tokens');
    const tokRemaining = headerNum(res, 'x-ratelimit-remaining-tokens');
    if (tokLimit !== null && tokRemaining !== null && tokLimit > 0) {
      const used = tokLimit - tokRemaining;
      const resetHint = headerResetHint(res, 'x-ratelimit-reset-tokens');
      limits.push({ label: 'Tokens/min', used, limit: tokLimit, resetHint });
    }
    const summary: ProviderUsageRow | null = limits.length > 0 ? limits[0]! : null;
    return {
      providerKey,
      displayName: providerDisplayName(providerKey),
      available: limits.length > 0,
      summary,
      limits: limits.slice(summary !== null ? 1 : 0),
      fetchedAtMs: Date.now(),
    };
  } catch (error) {
    return {
      providerKey,
      displayName: providerDisplayName(providerKey),
      available: true,
      summary: null,
      limits: [],
      error: error instanceof Error && error.name === 'AbortError'
        ? 'Request timed out.'
        : error instanceof Error ? error.message : String(error),
      fetchedAtMs: Date.now(),
    };
  } finally {
    clearTimeout(timer);
  }
}

// ── Fetch: Anthropic (rate-limit headers via count_tokens) ────────────

async function fetchAnthropicUsage(
  providerKey: string,
  accessToken: string,
  baseUrl?: string,
  opts: { timeoutMs?: number } = {},
): Promise<ProviderUsageSnapshot> {
  // Anthropic returns anthropic-ratelimit-* headers on every API response.
  // The /v1/messages/count_tokens endpoint is the lightest authenticated call
  // that still returns rate-limit headers without generating completions.
  const base = (baseUrl ?? 'https://api.anthropic.com').replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000);
  try {
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
      signal: controller.signal,
    });
    if (!res.ok && res.status !== 400) {
      // 400 may still carry rate-limit headers; other errors are fatal.
      return {
        providerKey,
        displayName: providerDisplayName(providerKey),
        available: true,
        summary: null,
        limits: [],
        error: res.status === 401 ? 'Token expired. Try /login.' : `HTTP ${String(res.status)}`,
        fetchedAtMs: Date.now(),
      };
    }
    // Parse Anthropic rate-limit headers.
    const limits: ProviderUsageRow[] = [];
    const reqLimit = headerNum(res, 'anthropic-ratelimit-requests-limit');
    const reqRemaining = headerNum(res, 'anthropic-ratelimit-requests-remaining');
    if (reqLimit !== null && reqRemaining !== null && reqLimit > 0) {
      const used = reqLimit - reqRemaining;
      const resetHint = headerResetHint(res, 'anthropic-ratelimit-requests-reset');
      limits.push({ label: 'Requests/min', used, limit: reqLimit, resetHint });
    }
    const inputLimit = headerNum(res, 'anthropic-ratelimit-input-tokens-limit');
    const inputRemaining = headerNum(res, 'anthropic-ratelimit-input-tokens-remaining');
    if (inputLimit !== null && inputRemaining !== null && inputLimit > 0) {
      const used = inputLimit - inputRemaining;
      const resetHint = headerResetHint(res, 'anthropic-ratelimit-input-tokens-reset');
      limits.push({ label: 'Input tokens/min', used, limit: inputLimit, resetHint });
    }
    const outputLimit = headerNum(res, 'anthropic-ratelimit-output-tokens-limit');
    const outputRemaining = headerNum(res, 'anthropic-ratelimit-output-tokens-remaining');
    if (outputLimit !== null && outputRemaining !== null && outputLimit > 0) {
      const used = outputLimit - outputRemaining;
      const resetHint = headerResetHint(res, 'anthropic-ratelimit-output-tokens-reset');
      limits.push({ label: 'Output tokens/min', used, limit: outputLimit, resetHint });
    }
    const summary: ProviderUsageRow | null = limits.length > 0 ? limits[0]! : null;
    return {
      providerKey,
      displayName: providerDisplayName(providerKey),
      available: limits.length > 0,
      summary,
      limits: limits.slice(summary !== null ? 1 : 0),
      fetchedAtMs: Date.now(),
    };
  } catch (error) {
    return {
      providerKey,
      displayName: providerDisplayName(providerKey),
      available: true,
      summary: null,
      limits: [],
      error: error instanceof Error && error.name === 'AbortError'
        ? 'Request timed out.'
        : error instanceof Error ? error.message : String(error),
      fetchedAtMs: Date.now(),
    };
  } finally {
    clearTimeout(timer);
  }
}

// ── Fetch: ClinePass (subscription usage-limits endpoint) ─────────────

/**
 * ClinePass exposes a subscription usage-limits endpoint that returns
 * 5-hour, weekly, and monthly quota windows.
 *
 * Endpoint: `GET /api/v1/users/me/plan/usage-limits`
 * Auth: `Authorization: Bearer <CLINE_API_KEY>`
 *
 * The response shape (inferred from CodexBar integration and Cline CLI):
 * ```json
 * {
 *   "limits": [
 *     { "type": "five_hour", "used": 42, "limit": 100, "resetAt": "..." },
 *     { "type": "weekly",    "used": 65, "limit": 100, "resetAt": "..." },
 *     { "type": "monthly",   "used": 30, "limit": 100, "resetAt": "..." }
 *   ]
 * }
 * ```
 * Field names may vary across releases; we parse defensively.
 */
async function fetchClinePassUsage(
  providerKey: string,
  accessToken: string,
  baseUrl?: string,
  opts: { timeoutMs?: number } = {},
): Promise<ProviderUsageSnapshot> {
  const base = (baseUrl ?? 'https://api.cline.bot/api/v1').replace(/\/+$/, '');
  const url = `${base}/users/me/plan/usage-limits`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000);
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      const hint = res.status === 401
        ? 'Invalid API key or session expired.'
        : res.status === 403
          ? 'ClinePass subscription not active.'
          : res.status === 404
            ? 'Usage-limits endpoint not available.'
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
    const json = await res.json() as Record<string, unknown>;
    const limits: ProviderUsageRow[] = [];

    // The response may be { limits: [...] } or a flat object with window keys.
    const limitsArray = Array.isArray(json['limits']) ? json['limits'] : null;
    if (limitsArray !== null) {
      for (const entry of limitsArray) {
        if (!isRecord(entry)) continue;
        const row = parseClinePassLimitEntry(entry);
        if (row !== null) limits.push(row);
      }
    } else {
      // Flat format: { five_hour: {...}, weekly: {...}, monthly: {...} }
      for (const [key, label] of [
        ['five_hour', '5-hour limit'],
        ['fiveHour', '5-hour limit'],
        ['weekly', 'Weekly limit'],
        ['monthly', 'Monthly limit'],
      ] as const) {
        const raw = json[key];
        if (isRecord(raw)) {
          const row = parseClinePassLimitEntry({ ...raw, type: key === 'fiveHour' ? 'five_hour' : key }, label);
          if (row !== null) limits.push(row);
        }
      }
    }

    const summary: ProviderUsageRow | null = limits.length > 0 ? limits[0]! : null;
    return {
      providerKey,
      displayName: providerDisplayName(providerKey),
      available: limits.length > 0,
      summary,
      limits: limits.slice(summary !== null ? 1 : 0),
      fetchedAtMs: Date.now(),
    };
  } catch (error) {
    return {
      providerKey,
      displayName: providerDisplayName(providerKey),
      available: true,
      summary: null,
      limits: [],
      error: error instanceof Error && error.name === 'AbortError'
        ? 'Request timed out.'
        : error instanceof Error ? error.message : String(error),
      fetchedAtMs: Date.now(),
    };
  } finally {
    clearTimeout(timer);
  }
}

const CLINEPASS_WINDOW_LABELS: Readonly<Record<string, string>> = {
  five_hour: '5-hour limit',
  '5hour': '5-hour limit',
  '5_hour': '5-hour limit',
  hourly: '5-hour limit',
  weekly: 'Weekly limit',
  week: 'Weekly limit',
  monthly: 'Monthly limit',
  month: 'Monthly limit',
};

function parseClinePassLimitEntry(
  entry: Record<string, unknown>,
  fallbackLabel?: string,
): ProviderUsageRow | null {
  const typeRaw = typeof entry['type'] === 'string' ? entry['type'] : '';
  const label = fallbackLabel ?? CLINEPASS_WINDOW_LABELS[typeRaw] ?? (typeRaw.length > 0 ? typeRaw : 'Usage');

  // used / limit may be raw counts or percentages.
  const used = numField(entry, 'used') ?? numField(entry, 'used_percent') ?? numField(entry, 'usedPercent');
  const limit = numField(entry, 'limit') ?? numField(entry, 'total') ?? numField(entry, 'max');
  if (used === null) return null;

  // When both used and limit look like percentages (0-100), use directly.
  // Otherwise treat as absolute counts.
  const resolvedLimit = limit !== null && limit > 0 ? limit : 100;

  // Reset hint.
  let resetHint: string | undefined;
  const resetAtRaw = entry['resetAt'] ?? entry['reset_at'] ?? entry['resetTime'] ?? entry['reset_time'];
  if (typeof resetAtRaw === 'string') {
    const asDate = Date.parse(resetAtRaw);
    if (!Number.isNaN(asDate)) resetHint = formatResetHint(asDate);
  } else if (typeof resetAtRaw === 'number' && Number.isFinite(resetAtRaw)) {
    const ms = resetAtRaw > 1e11 ? resetAtRaw : resetAtRaw * 1000;
    resetHint = formatResetHint(ms);
  }

  return { label, used, limit: resolvedLimit, resetHint };
}

// ── Fetch: Qwen Token Plan (rate-limit headers from models endpoint) ──

/**
 * Qwen Token Plan (Alibaba Bailian) does not expose a public API-key-based
 * usage query endpoint — the console `GetSubscriptionSummary` requires browser
 * session cookies. As a best-effort fallback we capture rate-limit headers
 * from a lightweight `GET /models` call on the OpenAI-compatible endpoint.
 *
 * If the gateway returns `x-ratelimit-*` headers we surface them; otherwise
 * the provider reports `available: false`.
 */
async function fetchQwenTokenPlanUsage(
  providerKey: string,
  accessToken: string,
  baseUrl?: string,
  opts: { timeoutMs?: number } = {},
): Promise<ProviderUsageSnapshot> {
  const base = (baseUrl ?? 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1').replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000);
  try {
    const res = await fetch(`${base}/models`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      return {
        providerKey,
        displayName: providerDisplayName(providerKey),
        available: true,
        summary: null,
        limits: [],
        error: res.status === 401
          ? 'Invalid API key.'
          : res.status === 429
            ? 'Rate limited — quota may be exhausted.'
            : `HTTP ${String(res.status)}`,
        fetchedAtMs: Date.now(),
      };
    }
    // Parse rate-limit headers if the gateway returns them.
    const limits: ProviderUsageRow[] = [];
    const reqLimit = headerNum(res, 'x-ratelimit-limit-requests');
    const reqRemaining = headerNum(res, 'x-ratelimit-remaining-requests');
    if (reqLimit !== null && reqRemaining !== null && reqLimit > 0) {
      const used = reqLimit - reqRemaining;
      const resetHint = headerResetHint(res, 'x-ratelimit-reset-requests');
      limits.push({ label: 'Requests', used, limit: reqLimit, resetHint });
    }
    const tokLimit = headerNum(res, 'x-ratelimit-limit-tokens');
    const tokRemaining = headerNum(res, 'x-ratelimit-remaining-tokens');
    if (tokLimit !== null && tokRemaining !== null && tokLimit > 0) {
      const used = tokLimit - tokRemaining;
      const resetHint = headerResetHint(res, 'x-ratelimit-reset-tokens');
      limits.push({ label: 'Tokens/min', used, limit: tokLimit, resetHint });
    }
    // Also check Alibaba-specific headers (x-dashscope-*).
    const dsTokLimit = headerNum(res, 'x-dashscope-ratelimit-tokens-limit');
    const dsTokRemaining = headerNum(res, 'x-dashscope-ratelimit-tokens-remaining');
    if (dsTokLimit !== null && dsTokRemaining !== null && dsTokLimit > 0) {
      const used = dsTokLimit - dsTokRemaining;
      limits.push({ label: 'Token Plan tokens', used, limit: dsTokLimit });
    }

    const summary: ProviderUsageRow | null = limits.length > 0 ? limits[0]! : null;
    return {
      providerKey,
      displayName: providerDisplayName(providerKey),
      available: limits.length > 0,
      summary,
      limits: limits.slice(summary !== null ? 1 : 0),
      fetchedAtMs: Date.now(),
    };
  } catch (error) {
    return {
      providerKey,
      displayName: providerDisplayName(providerKey),
      available: true,
      summary: null,
      limits: [],
      error: error instanceof Error && error.name === 'AbortError'
        ? 'Request timed out.'
        : error instanceof Error ? error.message : String(error),
      fetchedAtMs: Date.now(),
    };
  } finally {
    clearTimeout(timer);
  }
}

// ── Response header helpers ───────────────────────────────────────────

function headerNum(res: Response, name: string): number | null {
  const raw = res.headers.get(name);
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function headerResetHint(res: Response, name: string): string | undefined {
  const raw = res.headers.get(name);
  if (raw === null) return undefined;
  // Anthropic uses RFC 3339 timestamps; OpenAI/xAI use durations like "6m0s".
  const asDate = Date.parse(raw);
  if (!Number.isNaN(asDate)) {
    return formatResetHint(asDate);
  }
  // Duration format (e.g. "1s", "6m0s", "1h30m").
  return `resets in ${raw}`;
}

// ── Unified fetcher ───────────────────────────────────────────────────

export interface FetchProviderUsageOptions {
  readonly timeoutMs?: number;
}

/**
 * Fetch usage for a single provider by key. Routes to the appropriate
 * provider-specific fetcher based on the provider key prefix / id.
 */
export async function fetchProviderUsage(
  providerKey: string,
  accessToken: string,
  baseUrl?: string,
  opts: FetchProviderUsageOptions = {},
): Promise<ProviderUsageSnapshot> {
  if (isManagedKimiCode(providerKey)) {
    return fetchKimiManagedUsage(providerKey, accessToken, baseUrl, opts);
  }
  if (providerKey === 'openai-codex') {
    return fetchOpenAiCodexUsage(providerKey, accessToken, baseUrl, opts);
  }
  if (providerKey === 'xai-grok') {
    return fetchXaiGrokUsage(providerKey, accessToken, baseUrl, opts);
  }
  if (providerKey === 'anthropic-oauth') {
    return fetchAnthropicUsage(providerKey, accessToken, baseUrl, opts);
  }
  if (providerKey === 'clinepass') {
    return fetchClinePassUsage(providerKey, accessToken, baseUrl, opts);
  }
  if (providerKey === 'qwen-token-plan') {
    return fetchQwenTokenPlanUsage(providerKey, accessToken, baseUrl, opts);
  }
  // Unknown provider — report as unavailable.
  return {
    providerKey,
    displayName: providerDisplayName(providerKey),
    available: false,
    summary: null,
    limits: [],
    fetchedAtMs: Date.now(),
  };
}

/**
 * Build an aggregate snapshot from individual provider snapshots.
 * Computes the worst usage ratio for footer badge severity.
 */
export function buildAllProvidersUsageSnapshot(
  providers: readonly ProviderUsageSnapshot[],
): AllProvidersUsageSnapshot {
  let worst = 0;
  let primaryProviderKey: string | null = null;
  for (const snap of providers) {
    if (snap.error === undefined && snap.available && primaryProviderKey === null) {
      primaryProviderKey = snap.providerKey;
    }
    worst = Math.max(worst, snapshotWorstRatio(snap));
  }
  return {
    providers,
    primaryProviderKey,
    worstRatio: worst,
    fetchedAtMs: Date.now(),
  };
}
