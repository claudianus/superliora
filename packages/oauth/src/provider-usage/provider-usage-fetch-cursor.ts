import { cursorAuthHeaders } from '../profiles/cursor';
import { isRecord } from '../utils';
import { finalizeUsageSnapshot, providerDisplayName } from './provider-usage-display';
import { formatResetHint, numField } from './provider-usage-parse';
import type { ProviderUsageRow, ProviderUsageSnapshot } from './provider-usage-types';

const CURSOR_USAGE_URL = 'https://www.cursor.com/api/usage';

function parseCursorUsagePayload(payload: unknown): ProviderUsageRow[] {
  if (!isRecord(payload)) return [];
  const rows: ProviderUsageRow[] = [];
  for (const [key, value] of Object.entries(payload)) {
    if (key === 'startOfMonth' || !isRecord(value)) continue;
    const used =
      numField(value, 'numRequests') ??
      numField(value, 'numRequestsTotal') ??
      numField(value, 'used');
    const limit =
      numField(value, 'maxRequestUsage') ??
      numField(value, 'maxUsage') ??
      numField(value, 'limit');
    if (used === null || limit === null || !(limit > 0)) continue;
    rows.push({ label: key, used, limit });
  }
  const startOfMonth = typeof payload['startOfMonth'] === 'string' ? payload['startOfMonth'] : undefined;
  if (startOfMonth !== undefined && rows[0] !== undefined) {
    const next = Date.parse(startOfMonth);
    if (!Number.isNaN(next)) {
      const resetHint = formatResetHint(next + 30 * 24 * 60 * 60_000);
      rows[0] = { ...rows[0], ...(resetHint !== undefined ? { resetHint } : {}) };
    }
  }
  return rows;
}

function fail(
  providerKey: string,
  error: string,
  status: ProviderUsageSnapshot['status'],
): ProviderUsageSnapshot {
  return finalizeUsageSnapshot({
    providerKey,
    displayName: providerDisplayName(providerKey),
    available: false,
    summary: null,
    limits: [],
    error,
    fetchedAtMs: Date.now(),
    kind: 'subscription',
    source: 'oauth-api',
    status,
  });
}

export async function fetchCursorUsage(
  providerKey: string,
  accessToken: string,
  _baseUrl?: string,
  opts: { timeoutMs?: number } = {},
): Promise<ProviderUsageSnapshot> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, opts.timeoutMs ?? 8000);
  try {
    const res = await fetch(CURSOR_USAGE_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        ...cursorAuthHeaders(),
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      return fail(
        providerKey,
        res.status === 401 || res.status === 403
          ? 'Cursor usage API rejected this OAuth token (no session cookie). Remaining shows from last-response headers when present.'
          : res.status === 404
            ? 'Cursor usage API not available.'
            : `HTTP ${String(res.status)}`,
        res.status === 401 || res.status === 403
          ? 'unavailable'
          : res.status === 404
            ? 'unavailable'
            : 'error',
      );
    }
    const rows = parseCursorUsagePayload(await res.json());
    if (rows.length === 0) {
      return fail(providerKey, 'Cursor usage payload had no remaining windows.', 'unavailable');
    }
    const summary = rows[0] ?? null;
    return finalizeUsageSnapshot({
      providerKey,
      displayName: providerDisplayName(providerKey),
      available: true,
      summary,
      limits: summary === null ? rows : rows.slice(1),
      fetchedAtMs: Date.now(),
      kind: 'subscription',
      source: 'oauth-api',
    });
  } catch (error) {
    return fail(
      providerKey,
      error instanceof Error && error.name === 'AbortError'
        ? 'Request timed out.'
        : error instanceof Error
          ? error.message
          : String(error),
      'error',
    );
  } finally {
    clearTimeout(timer);
  }
}

export { parseCursorUsagePayload };
