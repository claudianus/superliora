import {
  buildAllProvidersUsageSnapshot,
  finalizeUsageSnapshot,
  providerDisplayName,
} from './provider-usage-display';
import { usageRowsFromRouteRateLimits } from './provider-usage-headers';
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
  for (const snap of quota?.providers ?? []) {
    byKey.set(snap.providerKey, snap);
  }
  let changed = false;
  for (const candidate of candidates) {
    const rows = usageRowsFromRouteRateLimits(candidate.rateLimits);
    if (rows.length === 0) continue;
    const next = overlayOne(byKey.get(candidate.providerName), candidate.providerName, rows);
    if (next === undefined) continue;
    const prev = byKey.get(candidate.providerName);
    if (prev === next) continue;
    byKey.set(candidate.providerName, next);
    changed = true;
  }
  if (!changed) return quota ?? null;
  return buildAllProvidersUsageSnapshot([...byKey.values()]);
}
