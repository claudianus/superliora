import type { LioraConfig, ModelAlias } from '@superliora/agent-core';
import {
  catalogBaseUrl,
  catalogImportThinking,
  catalogProviderModels,
  catalogThinkingMetadata,
  catalogWireGroups,
  inferWireType,
  type Catalog,
  type CatalogModel,
  type CatalogProviderEntry,
  type CatalogWireGroup,
  type ModelCapability,
  type ProviderType,
} from '@superliora/kosong';
import { applyXaiPricingSafeContextTokens } from '@superliora/oauth';

// Catalog metadata and the wire profile registry are re-exported so app code
// only ever depends on the SDK, never on `@superliora/kosong` directly.
export {
  catalogBaseUrl,
  catalogImportThinking,
  catalogProviderModels,
  catalogThinkingMetadata,
  catalogWireGroups,
  inferWireType,
  packageForWire,
  registerWireProfile,
  resolveWireFromPackage,
  wireProfiles,
} from '@superliora/kosong';
export type {
  Catalog,
  CatalogModel,
  CatalogProviderEntry,
  CatalogWireGroup,
  WireProfile,
} from '@superliora/kosong';

export const DEFAULT_CATALOG_URL = 'https://models.dev/api.json';

export class CatalogFetchError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** Fetches a models.dev-style catalog. Public endpoint, no credentials needed. */
export async function fetchCatalog(
  url: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<Catalog> {
  const res = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal });
  if (!res.ok) {
    throw new CatalogFetchError(`Failed to fetch catalog (HTTP ${res.status}).`, res.status);
  }
  const payload: unknown = await res.json();
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error(`Unexpected catalog response from ${url}.`);
  }
  return payload as Catalog;
}

function capabilityToStrings(capability: ModelCapability): string[] | undefined {
  const caps: string[] = [];
  if (capability.image_in) caps.push('image_in');
  if (capability.video_in) caps.push('video_in');
  if (capability.audio_in) caps.push('audio_in');
  if (capability.pdf_in) caps.push('pdf_in');
  if (capability.thinking) caps.push('thinking');
  if (capability.tool_use) caps.push('tool_use');
  return caps.length > 0 ? caps : undefined;
}

/** Builds a kimi-code model alias from a normalized catalog model. */
export function catalogModelToAlias(providerId: string, model: CatalogModel): ModelAlias {
  const capabilities = capabilityToStrings(model.capability);
  return {
    provider: providerId,
    model: model.id,
    maxContextSize: applyXaiPricingSafeContextTokens(model.capability.max_context_tokens, {
      provider: providerId,
      model: model.id,
      cost: model.cost,
    }),
    maxOutputSize: model.maxOutputSize,
    capabilities:
      model.alwaysThinking && capabilities !== undefined
        ? [...capabilities, 'always_thinking']
        : capabilities,
    ...(model.supportEfforts !== undefined
      ? { supportEfforts: [...model.supportEfforts] }
      : {}),
    displayName: model.name,
    reasoningKey: model.reasoningKey,
    cost: model.cost,
  };
}

export interface ApplyCatalogProviderOptions {
  readonly providerId: string;
  readonly wire: ProviderType;
  readonly baseUrl?: string;
  readonly apiKey: string;
  readonly models: readonly CatalogModel[];
  /**
   * Per-wire partitions of the catalog entry (kosong `catalogWireGroups`).
   * A gateway such as OpenCode Zen or Go serves several protocols from one API
   * root, and models.dev says which model uses which. When groups span more
   * than one wire, every non-primary wire gets its own provider entry derived
   * from this one while the user-facing alias keys stay
   * `${providerId}/${model.id}`. Authoritative over `models` when provided.
   */
  readonly wireGroups?: readonly CatalogWireGroup[];
  readonly selectedModelId: string;
  readonly thinking: boolean;
}

/**
 * Parses an optional pruned models.dev catalog string — typically the
 * `__SUPERLIORA_BUILT_IN_CATALOG__` constant injected by tsdown at build
 * time. Returns `undefined` when the argument is missing or invalid.
 */
export function loadBuiltInCatalog(text?: string): Catalog | undefined {
  if (typeof text !== 'string' || text.length === 0) return undefined;
  try {
    return JSON.parse(text) as Catalog;
  } catch {
    return undefined;
  }
}

/** Provider id for a secondary wire split off a multi-protocol catalog entry. */
function wireProviderId(baseProviderId: string, wire: ProviderType): string {
  return `${baseProviderId}-${wire.replaceAll('_', '-')}`;
}

/**
 * Wires to write for one import. Explicit `wireGroups` win; otherwise every
 * model stays under `options.wire`, which is the historical single-provider
 * shape.
 */
function resolveWireGroups(options: ApplyCatalogProviderOptions): readonly CatalogWireGroup[] {
  const groups = options.wireGroups?.filter((group) => group.models.length > 0);
  if (groups !== undefined && groups.length > 0) return groups;
  return [{ wire: options.wire, models: [...options.models] }];
}

/**
 * Provider ids a previous import of this catalog entry synthesized. Derived
 * ids share one of this import's API roots (per-wire adapted), so a
 * hand-written provider that merely looks similar is never swept up. A root
 * that is a strict ancestor of an import root also counts:
 * `catalogBaseUrl` adapts an api root per wire (e.g. strips a trailing `/v1`
 * for anthropic), so a previous import's `…/provider` ↔ this import's
 * `…/provider/v1` describe the same gateway.
 */
function resolveDerivedProviderIds(
  config: LioraConfig,
  options: ApplyCatalogProviderOptions,
  groupBaseUrls: ReadonlySet<string | undefined>,
): ReadonlySet<string> {
  const isDerivedRoot = (candidate: string | undefined): boolean => {
    if (candidate === undefined) return false;
    if (groupBaseUrls.has(candidate)) return true;
    return [...groupBaseUrls].some((root) => root !== undefined && root.startsWith(`${candidate}/`));
  };
  const derived = new Set<string>();
  for (const providerId of Object.keys(config.providers)) {
    if (providerId === options.providerId || !providerId.startsWith(`${options.providerId}-`)) {
      continue;
    }
    if (isDerivedRoot(config.providers[providerId]?.baseUrl)) derived.add(providerId);
  }
  return derived;
}

/** Removes per-wire providers this import no longer needs. */
function pruneDerivedProviders(
  config: LioraConfig,
  derivedIds: ReadonlySet<string>,
  activeIds: Iterable<string>,
): void {
  const active = new Set(activeIds);
  const referenced = new Set(Object.values(config.models ?? {}).map((alias) => alias.provider));
  for (const providerId of derivedIds) {
    if (active.has(providerId) || referenced.has(providerId)) continue;
    delete config.providers[providerId];
  }
}

/**
 * Writes a catalog-selected provider and its model aliases into `config` and
 * marks it the default. Model metadata (context, output limit, capabilities)
 * comes from the catalog, so the user does not hand-write it. Returns the
 * default model key.
 *
 * A catalog entry that spans several wires (OpenCode Zen and Go publish
 * `provider.npm` per model) is written as one provider per wire: the primary
 * keeps `providerId`, each extra wire becomes `${providerId}-<wire>` with the
 * API root adapted for that protocol. Alias keys stay `${providerId}/<model>`,
 * so the protocol split never leaks into what the user types.
 *
 * NOTE: the same-provider cleanup below mutates the passed-in `config` only.
 * It clears stale aliases on disk solely when the caller overwrites the whole
 * config. Callers persisting via `setConfig` — a deep-merge patch that cannot
 * delete keys — must call `removeProvider` first, or removed aliases reappear
 * after the merge.
 */
export function applyCatalogProvider(
  config: LioraConfig,
  options: ApplyCatalogProviderOptions,
): { defaultModel: string | undefined } {
  const groups = resolveWireGroups(options);
  const primary = groups.find((group) => group.wire === options.wire) ?? groups[0]!;
  const providerFor = new Map<CatalogWireGroup, string>(
    groups.map((group): [CatalogWireGroup, string] => [
      group,
      group === primary
        ? options.providerId
        : wireProviderId(options.providerId, group.wire),
    ]),
  );
  const groupBaseUrls = new Set<string | undefined>(
    groups.map((group) => group.baseUrl ?? options.baseUrl),
  );
  const derivedIds = resolveDerivedProviderIds(config, options, groupBaseUrls);

  for (const group of groups) {
    const providerId = providerFor.get(group)!;
    config.providers[providerId] = {
      type: group.wire,
      baseUrl: group.baseUrl ?? options.baseUrl,
      apiKey: options.apiKey,
    };
  }

  const models = config.models ?? {};
  const upstreamKeys = new Set<string>();
  for (const group of groups) {
    for (const model of group.models) upstreamKeys.add(`${options.providerId}/${model.id}`);
  }
  const preservedCustom: Record<string, typeof models[string]> = {};
  // Drop this provider's own aliases plus the per-wire providers a previous
  // import synthesized from the same API root; keep unrelated user aliases.
  for (const [key, alias] of Object.entries(models)) {
    if (alias.provider !== options.providerId && !derivedIds.has(alias.provider)) {
      continue;
    }
    if (!upstreamKeys.has(key) && (alias as { userManaged?: boolean }).userManaged === true) {
      preservedCustom[key] = alias;
    }
    delete models[key];
  }
  for (const group of groups) {
    for (const model of group.models) {
      models[`${options.providerId}/${model.id}`] = catalogModelToAlias(
        providerFor.get(group)!,
        model,
      );
    }
  }
  for (const [key, value] of Object.entries(preservedCustom)) {
    if (models[key] === undefined) models[key] = value;
  }
  config.models = models;
  pruneDerivedProviders(config, derivedIds, providerFor.values());

  // Only set a default model when a concrete model id was selected. An empty
  // `selectedModelId` would otherwise produce a malformed `providerId/` alias
  // that no real model matches.
  const defaultModel =
    options.selectedModelId.length > 0
      ? `${options.providerId}/${options.selectedModelId}`
      : undefined;
  if (defaultModel !== undefined) {
    config.defaultModel = defaultModel;
    config.defaultThinking = options.thinking;
  }
  return { defaultModel };
}
