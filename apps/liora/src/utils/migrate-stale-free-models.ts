import type { Catalog, LioraConfig } from '@superliora/sdk';

/**
 * Prunes stale free-model aliases that were created from the old hard-coded
 * `OPENCODE_ZEN_MODELS` (x-preview-f-free, deepseek-v4-flash-free, etc.)
 * and are no longer in the live catalog for that provider.
 *
 * The live catalog is `models.dev` 93 opencode (plus OpenRouter fallback) —
 * `deepseek-v4-flash-free` is in `models.dev` but not in `https://opencode.ai/zen/v1/models`
 * live, so `Model is unavailable` on turn. This migration removes such
 * non-userManaged stale aliases so FREE mode and the picker show only live.
 *
 * Called once after `loadCatalog` succeeds and `config` is available.
 * Returns a patch to apply via `setConfig` or `undefined` when nothing to do.
 */
const STALE_FREE_ALIASES = new Set<string>([
  'opencode/x-preview-f-free',
  'opencode/deepseek-v4-flash-free',
  'opencode/glm-4.7-free',
  'opencode/MiniMax-M2.5-free',
  'opencode/qwen3.7-plus-free',
  'opencode/qwen3.6-plus-free',
  'opencode/x-preview-f',
  'opencode/deepseek-v4-flash', // now paid rep but stale if user had free variant
]);

export function pruneStaleFreeAliases(
  config: LioraConfig,
  catalog: Catalog,
): Partial<LioraConfig> | undefined {
  const models = config.models;
  if (models === undefined) return undefined;

  const liveIds = new Set<string>();
  for (const [provId, entry] of Object.entries(catalog)) {
    for (const modelId of Object.keys(entry.models ?? {})) {
      // Catalog model ids can be `cline-pass/glm-5.2` etc — store both bare and provider-qualified
      liveIds.add(modelId);
      liveIds.add(`${provId}/${modelId}`);
    }
  }

  const toDelete: string[] = [];
  for (const alias of Object.keys(models)) {
    if (!STALE_FREE_ALIASES.has(alias)) continue;
    const entry = models[alias];
    if (entry === undefined) continue;
    // Never delete userManaged custom models
    if ((entry as { userManaged?: boolean }).userManaged === true) continue;
    // If alias is not in live, it's stale
    const provider = entry.provider;
    const modelId = entry.model;
    const qualified = `${provider}/${modelId}`;
    const bare = modelId;
    if (!liveIds.has(qualified) && !liveIds.has(bare) && !liveIds.has(alias)) {
      toDelete.push(alias);
    }
  }

  if (toDelete.length === 0) return undefined;

  const nextModels = { ...models } as NonNullable<LioraConfig['models']>;
  for (const alias of toDelete) delete nextModels[alias];

  const patch: Partial<LioraConfig> = {
    models: nextModels,
  };

  // If defaultModel pointed at a deleted alias, clear it so Smart Auto can pick live free
  if (config.defaultModel !== undefined && toDelete.includes(config.defaultModel)) {
    patch.defaultModel = undefined;
  }

  return patch;
}
