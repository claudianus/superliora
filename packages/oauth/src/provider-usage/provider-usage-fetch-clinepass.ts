import { isRecord } from '../utils';
import { providerDisplayName } from './provider-usage-display';
import { formatResetHint, numField } from './provider-usage-parse';
import type { ProviderUsageRow, ProviderUsageSnapshot } from './provider-usage-types';

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

export async function fetchClinePassUsage(
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
