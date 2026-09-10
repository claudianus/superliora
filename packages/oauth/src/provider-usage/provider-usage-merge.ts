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
    ...(snapshot?.accountKey !== undefined ? { accountKey: snapshot.accountKey } : {}),
    ...(snapshot?.isPrimary === true ? { isPrimary: true } : {}),
    ...(snapshot?.plan !== undefined ? { plan: snapshot.plan } : {}),
  });
}

/**
 * Overlay last-response rate-limit windows onto an aggregate snapshot.
 * Does not replace a live oauth-api remaining figure.
 *
 * Snapshots from multi-account OAuth pools share one provider key, so the
 * overlay keeps every account entry instead of collapsing the pool into a
 * single row. Candidate rate limits (whose origin is the account that served
 * the last request) are overlaid onto the pool's primary account when one
 * exists, else onto the provider's single snapshot.
 */
export function overlayRouteRateLimits(
  quota: AllProvidersUsageSnapshot | null | undefined,
  candidates: readonly OverlayRouteRateLimitsInput[] | undefined,
): AllProvidersUsageSnapshot | null {
  if (candidates === undefined || candidates.length === 0) {
    return quota ?? null;
  }
  // Group by usage key; the first entry of each group is the overlay target.
  const byKey = new Map<string, ProviderUsageSnapshot[]>();
  let changed = false;
  for (const snap of quota?.providers ?? []) {
    const key = resolveUsageProviderKey(snap.providerKey) ?? snap.providerKey;
    const normalized = key === snap.providerKey ? snap : { ...snap, providerKey: key };
    const bucket = byKey.get(key);
    if (bucket === undefined) {
      byKey.set(key, [normalized]);
      if (key !== snap.providerKey) changed = true;
      continue;
    }
    bucket.push(normalized);
  }
  for (const candidate of candidates) {
    const rows = usageRowsFromRouteRateLimits(candidate.rateLimits);
    if (rows.length === 0) continue;
    const key = resolveUsageProviderKey(candidate.providerName) ?? candidate.providerName;
    let bucket = byKey.get(key);
    let target: ProviderUsageSnapshot | undefined;
    if (bucket !== undefined && bucket.length > 0) {
      const targetIndex = bucket.findIndex((entry) => entry.isPrimary === true);
      target = bucket[Math.max(0, targetIndex)];
    }
    const next = overlayOne(target, key, rows);
    if (next === undefined || next === target) continue;
    if (bucket === undefined) {
      byKey.set(key, [next]);
    } else {
      const targetIndex = bucket.findIndex((entry) => entry.isPrimary === true);
      bucket[Math.max(0, targetIndex)] = next;
    }
    changed = true;
  }
  if (!changed) return quota ?? null;
  return buildAllProvidersUsageSnapshot([...byKey.values()].flat());
}
