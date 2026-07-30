import { isRecord } from '../utils';
import { providerDisplayName } from './provider-usage-display';
import { firstRecord, formatResetHint, numField } from './provider-usage-parse';
import type { ProviderUsageRow, ProviderUsageSnapshot } from './provider-usage-types';

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

export async function fetchOpenAiCodexUsage(
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
