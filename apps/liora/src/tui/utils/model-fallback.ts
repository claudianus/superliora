import type { ModelAlias } from '@superliora/sdk';

/**
 * Model fallback configuration utilities.
 *
 * Fallback models are stored per-model-alias in config.toml:
 * ```toml
 * [models."qwen3.8-max-preview"]
 * fallbackModels = ["qwen3.7-max", "qwen3.7-plus"]
 * ```
 *
 * When the primary model fails (rate limit, 5xx, etc.), the agent-core
 * failover logic tries these in order before prompting the user.
 */

export interface ModelFallbackConfig {
  readonly models?: Record<string, ModelAlias>;
  readonly defaultModel?: string;
}

/** Get the fallback model list for a given model alias. */
export function getFallbackModels(
  config: ModelFallbackConfig,
  modelAlias: string,
): readonly string[] {
  const model = config.models?.[modelAlias];
  if (model === undefined) return [];
  const fallbacks = (model as Record<string, unknown>)['fallbackModels'];
  if (!Array.isArray(fallbacks)) return [];
  return fallbacks.filter((v): v is string => typeof v === 'string' && v.length > 0);
}

/** Build a config patch that sets the fallback list for a model. */
export function fallbackModelsPatch(
  modelAlias: string,
  fallbacks: readonly string[],
): { models: Record<string, { fallbackModels: string[] }> } {
  return {
    models: {
      [modelAlias]: { fallbackModels: [...fallbacks] },
    },
  };
}

/** Build a config patch that clears the fallback list for a model. */
export function clearFallbackModelsPatch(
  modelAlias: string,
): { models: Record<string, { fallbackModels: string[] }> } {
  return {
    models: {
      [modelAlias]: { fallbackModels: [] },
    },
  };
}

/** Available models excluding the primary model (candidates for fallback). */
export function availableFallbackCandidates(
  models: Record<string, ModelAlias>,
  primaryAlias: string,
): readonly string[] {
  return Object.keys(models).filter((alias) => alias !== primaryAlias);
}
