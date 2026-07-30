/**
 * Best-effort session cost estimation from cumulative token usage and the
 * active model's per-million-token pricing (models.dev catalog). Pure and
 * theme-free; returns undefined when pricing or usage is unavailable so the
 * UI can simply hide the cost segment.
 */

import type { TokenUsage } from '@superliora/sdk';

/** Per-million-token USD pricing, mirroring the model catalog `cost` field. */
export interface ModelPricing {
  readonly input?: number;
  readonly output?: number;
  readonly cache_read?: number;
  readonly cache_write?: number;
}

const PER_MILLION = 1_000_000;

/**
 * Compute the session cost in USD from cumulative token usage and pricing.
 * Returns undefined when there is no usage, no pricing, or the result is zero.
 */
export function computeSessionCostUsd(
  total: TokenUsage | undefined,
  pricing: ModelPricing | undefined,
): number | undefined {
  if (!total || !pricing) return undefined;
  const input = pricing.input ?? 0;
  const output = pricing.output ?? 0;
  const cacheRead = pricing.cache_read ?? 0;
  const cacheWrite = pricing.cache_write ?? 0;
  if (input === 0 && output === 0 && cacheRead === 0 && cacheWrite === 0) {
    return undefined;
  }
  const usd =
    ((total.inputOther ?? 0) * input +
      (total.output ?? 0) * output +
      (total.inputCacheRead ?? 0) * cacheRead +
      (total.inputCacheCreation ?? 0) * cacheWrite) /
    PER_MILLION;
  return usd > 0 ? usd : undefined;
}
