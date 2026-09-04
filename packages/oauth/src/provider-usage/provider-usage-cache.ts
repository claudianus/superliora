import { createHash } from 'node:crypto';

import type { ProviderUsageSnapshot } from './provider-usage-types';

export const DEFAULT_USAGE_TTL_MS = 120_000;
export const ANTHROPIC_USAGE_TTL_MS = 180_000;

/**
 * Upper bound on cached snapshots. Keys embed a per-token fingerprint, so
 * without a cap every token rotation leaks another entry for the TTL window
 * (and longer — `clearProviderUsageCache` is the only eviction path).
 */
const MAX_CACHE_ENTRIES = 50;

const cache = new Map<string, { readonly value: ProviderUsageSnapshot; readonly fetchedAt: number }>();
const inflight = new Map<string, Promise<ProviderUsageSnapshot>>();

export function providerUsageTtlMs(providerKey: string): number {
  return providerKey === 'anthropic-oauth' ? ANTHROPIC_USAGE_TTL_MS : DEFAULT_USAGE_TTL_MS;
}

/**
 * Cache key for a (provider, credential, endpoint) triple. The token is
 * stored as a SHA-256 fingerprint — the plaintext must not sit in a
 * module-level Map (heap dumps, debug snapshots) when a hash distinguishes
 * rotations just as well.
 */
export function usageCacheKey(providerKey: string, accessToken: string, baseUrl?: string): string {
  const fingerprint = createHash('sha256').update(accessToken, 'utf8').digest('hex');
  return `${providerKey}\0${fingerprint}\0${baseUrl ?? ''}`;
}

export function peekProviderUsageCache(key: string): ProviderUsageSnapshot | undefined {
  return cache.get(key)?.value;
}

export function writeProviderUsageCache(key: string, value: ProviderUsageSnapshot): void {
  // Refresh insertion order on rewrite so eviction drops the stalest key.
  if (cache.has(key)) cache.delete(key);
  cache.set(key, { value, fetchedAt: value.fetchedAtMs });
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done === true) break;
    cache.delete(oldest.value);
  }
}

export function clearProviderUsageCache(): void {
  cache.clear();
  inflight.clear();
}

export async function withProviderUsageCache(
  key: string,
  ttlMs: number,
  refresh: boolean,
  fetch: () => Promise<ProviderUsageSnapshot>,
  nowMs: number = Date.now(),
): Promise<ProviderUsageSnapshot> {
  const hit = cache.get(key);
  const fresh = hit !== undefined && nowMs - hit.fetchedAt < ttlMs;
  if (!refresh && fresh) return hit.value;

  const pending = inflight.get(key);
  if (pending !== undefined) {
    // Coalesce concurrent callers — including forced refreshes — onto one
    // fetch. A second `refresh: true` while a refresh is already running
    // still resolves with fresh data; starting another upstream request
    // would only thundering-herd the quota endpoint.
    if (hit !== undefined) return hit.value;
    return pending;
  }

  const promise = fetch()
    .then((value) => {
      writeProviderUsageCache(key, value);
      return value;
    })
    .finally(() => {
      if (inflight.get(key) === promise) inflight.delete(key);
    });
  inflight.set(key, promise);

  // Stale-while-revalidate: serve the last snapshot while a refresh is in flight.
  if (!refresh && hit !== undefined) return hit.value;
  return promise;
}
