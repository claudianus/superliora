import { readApiErrorMessage } from '../api-error';
import { kimiCodeUsageUrl, parseManagedUsagePayload } from '../kimi/managed-usage';
import { providerDisplayName } from './provider-usage-display';
import { toProviderUsageRow } from './provider-usage-parse';
import type { ProviderUsageSnapshot } from './provider-usage-types';

export async function fetchKimiManagedUsage(
  providerKey: string,
  accessToken: string,
  baseUrl?: string,
  opts: { timeoutMs?: number } = {},
): Promise<ProviderUsageSnapshot> {
  const url = baseUrl !== undefined
    ? `${baseUrl.replace(/\/+$/, '')}/usages`
    : kimiCodeUsageUrl();
  const controller = new AbortController();
  const timer = setTimeout(() =>{  controller.abort(); }, opts.timeoutMs ?? 8000);
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
    const parsed = parseManagedUsagePayload(json);
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
