import type { Catalog, LioraConfig } from '@superliora/sdk';
import { catalogModelToAlias, catalogProviderModels } from '@superliora/sdk';
import type { ModelAlias } from '@superliora/sdk';
import { isOpenPlatformId } from '@superliora/oauth';

type ConfigModelAlias = NonNullable<LioraConfig['models']>[string];

/**
 * Re-derives capability metadata (thinking, efforts, modalities, pricing,
 * context limits) for API-key catalog aliases from the live models.dev
 * catalog. Aliases written by older builds carry stale capabilities — e.g.
 * Command Code models that shipped `reasoning: false` before catalog import
 * started enriching from models.dev — and the /model picker reads these
 * aliases directly, so without this refresh a reconnect would be required to
 * see corrected capabilities.
 *
 * Providers with their own refresh paths are skipped: OAuth-backed providers,
 * open platforms, and custom registries (refreshProviderModels branches).
 * `userManaged` aliases are user-authored and never touched. Returns a
 * partial-config patch containing only the changed aliases, or `undefined`
 * when everything already matches.
 */
export function catalogAliasCapabilityPatch(
  config: LioraConfig,
  catalog: Catalog,
): Partial<LioraConfig> | undefined {
  const models = config.models;
  if (models === undefined) return undefined;
  let nextModels: Record<string, ConfigModelAlias> | undefined;
  for (const [aliasKey, alias] of Object.entries(models)) {
    if ((alias as { userManaged?: boolean }).userManaged === true) continue;
    const providerId = alias.provider;
    const provider = config.providers[providerId];
    if (provider === undefined) continue;
    if (provider.oauth !== undefined || provider.oauths !== undefined) continue;
    if (isOpenPlatformId(providerId)) continue;
    if (isCustomRegistryProvider(provider)) continue;
    const entry = catalog[providerId];
    if (entry === undefined) continue;
    const normalized = catalogProviderModels(entry).find((model) => model.id === alias.model);
    if (normalized === undefined) continue;
    const refreshed = catalogModelToAlias(providerId, normalized);
    if (sameAliasMetadata(alias, refreshed)) continue;
    (nextModels ??= { ...models })[aliasKey] = { ...alias, ...refreshed };
  }
  return nextModels === undefined ? undefined : { models: nextModels };
}

/** Custom-registry providers (models.dev-style api.json sources) refresh via refreshProviderModels. */
function isCustomRegistryProvider(provider: NonNullable<LioraConfig['providers']>[string]): boolean {
  const source = (provider as { source?: unknown }).source;
  if (typeof source !== 'object' || source === null) return false;
  return (source as { kind?: unknown }).kind === 'apiJson';
}

function sameCapabilities(
  a: readonly string[] | undefined,
  b: readonly string[] | undefined,
): boolean {
  const setA = new Set((a ?? []).map((c) => c.trim().toLowerCase()));
  const setB = new Set((b ?? []).map((c) => c.trim().toLowerCase()));
  if (setA.size !== setB.size) return false;
  for (const c of setA) if (!setB.has(c)) return false;
  return true;
}

function sameAliasMetadata(alias: ModelAlias, refreshed: ModelAlias): boolean {
  if (!sameCapabilities(alias.capabilities, refreshed.capabilities)) return false;
  const effortA = [...(alias.supportEfforts ?? [])].toSorted().join(',');
  const effortB = [...(refreshed.supportEfforts ?? [])].toSorted().join(',');
  if (effortA !== effortB) return false;
  if (alias.maxContextSize !== refreshed.maxContextSize) return false;
  if (alias.maxOutputSize !== refreshed.maxOutputSize) return false;
  if (alias.reasoningKey !== refreshed.reasoningKey) return false;
  if ((alias.cost?.input ?? null) !== (refreshed.cost?.input ?? null)) return false;
  if ((alias.cost?.output ?? null) !== (refreshed.cost?.output ?? null)) return false;
  return true;
}
