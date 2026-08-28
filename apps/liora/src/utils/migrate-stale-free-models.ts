import type { Catalog, DeleteConfigFieldPath, LioraConfig } from '@superliora/sdk';

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
 * Prefer {@link getStaleFreeAliasDeletePaths} — it returns delete paths for
 * `deleteConfigFields` (the RPC patch API cannot delete keys).
 * {@link pruneStaleFreeAliases} stays for direct in-memory mutation.
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

export function collectStaleFreeAliases(
  config: LioraConfig,
  catalog: Catalog,
): readonly string[] {
  const models = config.models;
  if (models === undefined) return [];
  const liveIds = new Set<string>();
  for (const [provId, entry] of Object.entries(catalog)) {
    for (const modelId of Object.keys(entry.models ?? {})) {
      liveIds.add(modelId);
      liveIds.add(`${provId}/${modelId}`);
    }
  }
  const toDelete: string[] = [];
  for (const alias of Object.keys(models)) {
    if (!STALE_FREE_ALIASES.has(alias)) continue;
    const entry = models[alias];
    if (entry === undefined) continue;
    if ((entry as { userManaged?: boolean }).userManaged === true) continue;
    const provider = entry.provider;
    const modelId = entry.model;
    const qualified = `${provider}/${modelId}`;
    const bare = modelId;
    if (!liveIds.has(qualified) && !liveIds.has(bare) && !liveIds.has(alias)) {
      toDelete.push(alias);
    }
  }
  return toDelete;
}

export function getStaleFreeAliasDeletePaths(
  config: LioraConfig,
  catalog: Catalog,
): {
  readonly deletePaths: readonly DeleteConfigFieldPath[];
  readonly clearDefaultModel: boolean;
} | undefined {
  const toDelete = collectStaleFreeAliases(config, catalog);
  if (toDelete.length === 0) return undefined;
  const deletePaths: DeleteConfigFieldPath[] = toDelete.map(
    (alias) => `models."${alias}"` as DeleteConfigFieldPath,
  );
  const clearDefaultModel =
    config.defaultModel !== undefined && toDelete.includes(config.defaultModel);
  if (clearDefaultModel) deletePaths.push('defaultModel');
  return { deletePaths, clearDefaultModel };
}

export function pruneStaleFreeAliases(
  config: LioraConfig,
  catalog: Catalog,
): Partial<LioraConfig> | undefined {
  const toDelete = collectStaleFreeAliases(config, catalog);
  if (toDelete.length === 0) return undefined;
  const models = config.models as NonNullable<LioraConfig['models']>;
  const nextModels = { ...models };
  for (const alias of toDelete) delete nextModels[alias];
  const patch: Partial<LioraConfig> = { models: nextModels };
  if (config.defaultModel !== undefined && toDelete.includes(config.defaultModel)) {
    patch.defaultModel = undefined;
  }
  return patch;
}
