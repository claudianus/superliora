import {
  fetchCustomRegistry,
  type CustomRegistrySource,
} from './custom-registry';
import type {
  ManagedKimiConfigShape,
  ManagedKimiModelAlias,
} from '../kimi';

interface ProviderView {
  readonly type?: string;
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly oauth?: unknown;
  readonly source?: unknown;
}

export function readProvider(
  config: ManagedKimiConfigShape,
  providerId: string,
): ProviderView | undefined {
  const provider = config.providers[providerId];
  if (provider === undefined) return undefined;
  return provider as ProviderView;
}

export function readModel(
  config: ManagedKimiConfigShape,
  alias: string,
): ManagedKimiModelAlias | undefined {
  const model = config.models?.[alias];
  if (model === undefined) return undefined;
  return model as ManagedKimiModelAlias;
}

export function readCustomRegistrySource(provider: ProviderView): CustomRegistrySource | undefined {
  const source = provider.source;
  if (typeof source !== 'object' || source === null) return undefined;
  const candidate = source as Record<string, unknown>;
  if (candidate['kind'] !== 'apiJson') return undefined;
  const url = candidate['url'];
  const apiKey = candidate['apiKey'];
  if (typeof url !== 'string' || url.length === 0) return undefined;
  if (typeof apiKey !== 'string') return undefined;
  return { kind: 'apiJson', url, apiKey };
}

export function customRegistrySourceKey(source: CustomRegistrySource): string {
  return JSON.stringify([source.url]);
}

export function customRegistrySourceCredentialKey(source: CustomRegistrySource): string {
  return JSON.stringify([source.url, source.apiKey]);
}

export async function fetchCustomRegistryFromSources(
  sources: readonly CustomRegistrySource[],
): Promise<{
  readonly entries: Awaited<ReturnType<typeof fetchCustomRegistry>>;
  readonly source: CustomRegistrySource;
}> {
  let lastError: unknown;
  for (const source of sources) {
    try {
      return {
        entries: await fetchCustomRegistry(source),
        source,
      };
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError instanceof Error) throw lastError;
  if (typeof lastError === 'string') throw new Error(lastError);
  throw new Error('No custom registry sources configured.');
}

export function collectModelIdsForAliases(
  config: ManagedKimiConfigShape,
  aliasKeys: ReadonlySet<string>,
): Set<string> {
  const ids = new Set<string>();
  for (const aliasKey of aliasKeys) {
    const alias = readModel(config, aliasKey);
    if (alias !== undefined && alias.model.length > 0) {
      ids.add(alias.model);
    }
  }
  return ids;
}

export function providerAliasKeys(config: ManagedKimiConfigShape, providerId: string): Set<string> {
  const keys = new Set<string>();
  for (const [alias, raw] of Object.entries(config.models ?? {})) {
    if ((raw as ManagedKimiModelAlias).provider === providerId) keys.add(alias);
  }
  return keys;
}

export function generatedProviderAliasKeys(
  config: ManagedKimiConfigShape,
  providerId: string,
  aliasPrefix: string,
): Set<string> {
  const keys = new Set<string>();
  for (const [alias, raw] of Object.entries(config.models ?? {})) {
    const model = raw as ManagedKimiModelAlias;
    if (model.provider === providerId && alias.startsWith(aliasPrefix)) {
      keys.add(alias);
    }
  }
  return keys;
}

export function computeChanges(oldIds: Set<string>, newIds: Set<string>): { added: number; removed: number } {
  let added = 0;
  for (const id of newIds) {
    if (!oldIds.has(id)) added++;
  }
  let removed = 0;
  for (const id of oldIds) {
    if (!newIds.has(id)) removed++;
  }
  return { added, removed };
}

interface ProviderModelSnapshot {
  readonly alias: string;
  readonly model: ManagedKimiModelAlias;
}

// Compare the full model metadata for the relevant aliases, not just model IDs:
// a registry can change capabilities (e.g. enabling reasoning) without changing
// any model ID. Spreading the whole alias keeps this in sync with the schema
// automatically; only `capabilities` needs normalizing because its order is not
// meaningful.
export function providerModelSnapshot(
  config: ManagedKimiConfigShape,
  providerId: string,
  aliasKeys: ReadonlySet<string>,
): string {
  const snapshots: ProviderModelSnapshot[] = [];
  for (const alias of aliasKeys) {
    const model = readModel(config, alias);
    if (model === undefined || model.provider !== providerId) continue;
    snapshots.push({
      alias,
      model: {
        ...model,
        capabilities: model.capabilities === undefined ? undefined : model.capabilities.toSorted(),
      },
    });
  }
  snapshots.sort((a, b) => a.alias.localeCompare(b.alias));
  return JSON.stringify(snapshots);
}

export function providerModelsEqual(
  config: ManagedKimiConfigShape,
  nextConfig: ManagedKimiConfigShape,
  providerId: string,
  aliasKeys: ReadonlySet<string>,
): boolean {
  return (
    providerModelSnapshot(config, providerId, aliasKeys) ===
    providerModelSnapshot(nextConfig, providerId, aliasKeys)
  );
}

export function providerConfigSnapshot(config: ManagedKimiConfigShape, providerId: string): string {
  return JSON.stringify(config.providers[providerId] ?? null);
}

export function providerConfigEqual(
  config: ManagedKimiConfigShape,
  nextConfig: ManagedKimiConfigShape,
  providerId: string,
): boolean {
  return providerConfigSnapshot(config, providerId) === providerConfigSnapshot(nextConfig, providerId);
}

export function providerRefreshAliasKeys(
  config: ManagedKimiConfigShape,
  nextConfig: ManagedKimiConfigShape,
  providerId: string,
  aliasPrefix: string,
): Set<string> {
  const keys = generatedProviderAliasKeys(config, providerId, aliasPrefix);
  for (const key of providerAliasKeys(nextConfig, providerId)) keys.add(key);
  return keys;
}

export function preserveUserProviderAliases(
  config: ManagedKimiConfigShape,
  providerId: string,
  refreshedAliasKeys: ReadonlySet<string>,
): Record<string, ManagedKimiModelAlias> {
  const preserved: Record<string, ManagedKimiModelAlias> = {};
  for (const [alias, raw] of Object.entries(config.models ?? {})) {
    const model = raw as ManagedKimiModelAlias;
    if (model.provider !== providerId || refreshedAliasKeys.has(alias)) continue;
    preserved[alias] = structuredClone(model);
  }
  return preserved;
}

export function restoreProviderAliases(
  config: ManagedKimiConfigShape,
  aliases: Record<string, ManagedKimiModelAlias>,
): void {
  if (Object.keys(aliases).length === 0) return;
  config.models = {
    ...config.models,
    ...aliases,
  };
}

export function restoreDefaultSelection(
  config: ManagedKimiConfigShape,
  defaultModel: string | undefined,
  defaultThinking: boolean | undefined,
): void {
  if (defaultModel === undefined || readModel(config, defaultModel) === undefined) return;
  config.defaultModel = defaultModel;
  // A refresh may have just learned that the default model cannot disable
  // thinking — never restore a stale thinking-off selection onto it.
  const capabilities = readModel(config, defaultModel)?.capabilities ?? [];
  config.defaultThinking = capabilities.includes('always_thinking') ? true : defaultThinking;
}

// `apply*` may leave `defaultModel` pointing at an alias that no longer exists
// (e.g. the previously-selected model was dropped from the registry). The host's
// `setConfig` deep-merge cannot clear a key, so the matching `removeProvider`
// call handles disk cleanup while this drops the dangling reference in memory.
export function clampDanglingDefault(config: ManagedKimiConfigShape): void {
  if (config.defaultModel !== undefined && readModel(config, config.defaultModel) === undefined) {
    config.defaultModel = undefined;
    config.defaultThinking = undefined;
  }
}

export function clearDefaultThinkingWhenDefaultRemoved(
  config: ManagedKimiConfigShape,
  previousDefaultModel: string | undefined,
): void {
  if (previousDefaultModel !== undefined && config.defaultModel === undefined) {
    config.defaultThinking = undefined;
  }
}

export function pickDefaultModel(
  config: ManagedKimiConfigShape,
  providerId: string,
  models: Array<{ id: string }>,
): string {
  const firstModel = models[0];
  if (firstModel === undefined) return '';

  const existingDefault = config.defaultModel;
  if (existingDefault !== undefined) {
    const alias = readModel(config, existingDefault);
    if (alias !== undefined && alias.provider === providerId) {
      const stillAvailable = models.find((m) => m.id === alias.model);
      if (stillAvailable !== undefined) {
        return stillAvailable.id;
      }
    }
  }
  return firstModel.id;
}
