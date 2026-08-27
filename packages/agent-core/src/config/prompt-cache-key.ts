import type { LioraConfig } from './schema';

/** Compose provider `prompt_cache_key` from session id and optional invalidate epoch. */
export function resolvePromptCacheKey(sessionId: string, config: LioraConfig): string {
  const epoch = config.cache?.invalidateEpoch ?? 0;
  if (epoch <= 0) return sessionId;
  return `${sessionId}:v${String(epoch)}`;
}

const PROMPT_CACHE_EPOCH_SUFFIX = /:v(\d+)$/;

/**
 * Pin a session-level `prompt_cache_key` to one agent so Job workers do not
 * share the Conductor routing key (and evict each other's prefixes).
 *
 * Main (`agentId === 'main'`) keeps the session key. Invalidate-epoch suffix
 * `":vN"` stays last so Settings → Cache invalidate still applies.
 */
export function pinPromptCacheKeyToAgent(sessionKey: string, agentId: string): string {
  const trimmed = agentId.trim();
  if (trimmed.length === 0 || trimmed === 'main') return sessionKey;
  const epochMatch = PROMPT_CACHE_EPOCH_SUFFIX.exec(sessionKey);
  if (epochMatch === null || epochMatch.index === undefined) {
    return `${sessionKey}:${trimmed}`;
  }
  const base = sessionKey.slice(0, epochMatch.index);
  return `${base}:${trimmed}${epochMatch[0]}`;
}

/** Patch shape for bumping `cache.invalidateEpoch` (Settings → Cache invalidate). */
export function cacheInvalidateEpochPatch(
  config: Pick<LioraConfig, 'cache'>,
): { cache: { invalidateEpoch: number } } {
  const current = config.cache?.invalidateEpoch ?? 0;
  return { cache: { invalidateEpoch: current + 1 } };
}
