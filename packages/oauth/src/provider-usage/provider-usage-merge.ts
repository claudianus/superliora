import {
  buildAllProvidersUsageSnapshot,
  finalizeUsageSnapshot,
  providerDisplayName,
} from './provider-usage-display';
import { usageRowsFromRouteRateLimits } from './provider-usage-headers';
import { resolveUsageProviderKey } from './provider-usage-key';
import type {
  AllProvidersUsageSnapshot,
  OverlayRouteRateLimitsInput,
  ProviderUsageSnapshot,
} from './provider-usage-types';

function overlayOne(
  snapshot: ProviderUsageSnapshot | undefined,
  providerKey: string,
  rows: ReturnType<typeof usageRowsFromRouteRateLimits>,
): ProviderUsageSnapshot | undefined {
  if (rows.length === 0) return snapshot;
  if (snapshot !== undefined && snapshot.available && snapshot.summary !== null) {
    if (snapshot.source === 'oauth-api' || snapshot.source === 'catalog-pricing') {
      return snapshot;
    }
  }
  const summary = rows[0] ?? null;
  return finalizeUsageSnapshot({
    providerKey,
    displayName: snapshot?.displayName ?? providerDisplayName(providerKey),
    available: true,
    summary,
    limits: summary === null ? rows : rows.slice(1),
    fetchedAtMs: Date.now(),
    kind: 'rate-limit',
    status: 'ok',
    source: 'response-headers',
    ...(snapshot?.accountLabel !== undefined ? { accountLabel: snapshot.accountLabel } : {}),
  });
}

/**
 * Overlay last-response rate-limit windows onto an aggregate snapshot.
 * Does not replace a live oauth-api remaining figure.
 */
export function overlayRouteRateLimits(
  quota: AllProvidersUsageSnapshot | null | undefined,
  candidates: readonly OverlayRouteRateLimitsInput[] | undefined,
): AllProvidersUsageSnapshot | null {
  if (candidates === undefined || candidates.length === 0) {
    return quota ?? null;
  }
  const byKey = new Map<string, ProviderUsageSnapshot>();
  let changed = false;
  for (const snap of quota?.providers ?? []) {
    const key = resolveUsageProviderKey(snap.providerKey) ?? snap.providerKey;
    const existing = byKey.get(key);
    const normalized = key === snap.providerKey ? snap : { ...snap, providerKey: key };
    if (existing === undefined) {
      byKey.set(key, normalized);
      if (key !== snap.providerKey) changed = true;
      continue;
    }
    changed = true;
    if (existing.source === 'oauth-api' || existing.source === 'catalog-pricing') continue;
    byKey.set(key, normalized);
  }
  for (const candidate of candidates) {
    const rows = usageRowsFromRouteRateLimits(candidate.rateLimits);
    if (rows.length === 0) continue;
    const key = resolveUsageProviderKey(candidate.providerName) ?? candidate.providerName;
    const next = overlayOne(byKey.get(key), key, rows);
    if (next === undefined) continue;
    const prev = byKey.get(key);
    if (prev === next) continue;
    byKey.set(key, next);
    changed = true;
  }
  if (!changed) return quota ?? null;
  return buildAllProvidersUsageSnapshot([...byKey.values()]);
}
