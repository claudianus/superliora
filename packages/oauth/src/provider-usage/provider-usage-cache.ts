import type { ProviderUsageSnapshot } from './provider-usage-types';

export const DEFAULT_USAGE_TTL_MS = 120_000;
export const ANTHROPIC_USAGE_TTL_MS = 180_000;

const cache = new Map<string, { readonly value: ProviderUsageSnapshot; readonly fetchedAt: number }>();
const inflight = new Map<string, Promise<ProviderUsageSnapshot>>();

export function providerUsageTtlMs(providerKey: string): number {
  return providerKey === 'anthropic-oauth' ? ANTHROPIC_USAGE_TTL_MS : DEFAULT_USAGE_TTL_MS;
}

export function usageCacheKey(providerKey: string, accessToken: string, baseUrl?: string): string {
  return `${providerKey}\0${accessToken}\0${baseUrl ?? ''}`;
}

export function peekProviderUsageCache(key: string): ProviderUsageSnapshot | undefined {
  return cache.get(key)?.value;
}

export function writeProviderUsageCache(key: string, value: ProviderUsageSnapshot): void {
  cache.set(key, { value, fetchedAt: value.fetchedAtMs });
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
  if (pending !== undefined && !refresh) {
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
