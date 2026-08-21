import { isRecord } from '../utils';
import { finalizeUsageSnapshot, providerDisplayName } from './provider-usage-display';
import { numField } from './provider-usage-parse';
import type { ProviderUsageRow, ProviderUsageSnapshot } from './provider-usage-types';

function parseBalanceNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Pure parser for GET /user/balance. */
export function parseDeepSeekBalancePayload(payload: unknown): {
  readonly rows: ProviderUsageRow[];
  readonly remainingDisplay: string;
} {
  if (!isRecord(payload)) return { rows: [], remainingDisplay: '' };
  const infos = Array.isArray(payload['balance_infos']) ? payload['balance_infos'] : [];
  const rows: ProviderUsageRow[] = [];
  let remainingDisplay = '';
  for (const entry of infos) {
    if (!isRecord(entry)) continue;
    const total =
      parseBalanceNumber(entry['total_balance']) ?? numField(entry, 'total_balance');
    if (total === null) continue;
    const currency = typeof entry['currency'] === 'string' ? entry['currency'] : 'USD';
    rows.push({ label: `${currency} balance`, used: 0, limit: total });
    if (remainingDisplay.length === 0 && total >= 0) {
      remainingDisplay = `DS $${total >= 100 ? total.toFixed(0) : total.toFixed(2)}`;
    }
  }
  return { rows, remainingDisplay };
}

export async function fetchDeepSeekUsage(
  providerKey: string,
  accessToken: string,
  baseUrl?: string,
  opts: { timeoutMs?: number } = {},
): Promise<ProviderUsageSnapshot> {
  const base = (baseUrl ?? 'https://api.deepseek.com').replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, opts.timeoutMs ?? 8000);
  try {
    const res = await fetch(`${base}/user/balance`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      return finalizeUsageSnapshot({
        providerKey,
        displayName: providerDisplayName(providerKey),
        available: false,
        summary: null,
        limits: [],
        error:
          res.status === 401
            ? 'Invalid DeepSeek API key.'
            : res.status === 404
              ? 'Balance endpoint not available.'
              : `HTTP ${String(res.status)}`,
        fetchedAtMs: Date.now(),
        kind: 'api-credits',
        source: 'oauth-api',
        status: res.status === 401 ? 'auth-required' : res.status === 404 ? 'unavailable' : 'error',
      });
    }
    const parsed = parseDeepSeekBalancePayload(await res.json());
    const summary = parsed.rows[0] ?? null;
    return finalizeUsageSnapshot({
      providerKey,
      displayName: providerDisplayName(providerKey),
      available: parsed.rows.length > 0,
      summary,
      limits: summary === null ? parsed.rows : parsed.rows.slice(1),
      fetchedAtMs: Date.now(),
      kind: 'api-credits',
      source: 'oauth-api',
      remainingDisplay: parsed.remainingDisplay,
    });
  } catch (error) {
    return finalizeUsageSnapshot({
      providerKey,
      displayName: providerDisplayName(providerKey),
      available: false,
      summary: null,
      limits: [],
      error:
        error instanceof Error && error.name === 'AbortError'
          ? 'Request timed out.'
          : error instanceof Error
            ? error.message
            : String(error),
      fetchedAtMs: Date.now(),
      kind: 'api-credits',
      source: 'oauth-api',
      status: 'error',
    });
  } finally {
    clearTimeout(timer);
  }
}
