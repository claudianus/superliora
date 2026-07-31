import type { LioraConfig } from './schema';

/** Compose provider `prompt_cache_key` from session id and optional invalidate epoch. */
export function resolvePromptCacheKey(sessionId: string, config: LioraConfig): string {
  const epoch = config.cache?.invalidateEpoch ?? 0;
  if (epoch <= 0) return sessionId;
  return `${sessionId}:v${String(epoch)}`;
}

/** Patch shape for bumping `cache.invalidateEpoch` (Settings → Cache invalidate). */
export function cacheInvalidateEpochPatch(
  config: Pick<LioraConfig, 'cache'>,
): { cache: { invalidateEpoch: number } } {
  const current = config.cache?.invalidateEpoch ?? 0;
  return { cache: { invalidateEpoch: current + 1 } };
}
