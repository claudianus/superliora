/**
 * `liora provider catalog *` handlers — public model catalog discovery and import.
 */

import {
  applyCatalogProvider,
  catalogBaseUrl,
  catalogProviderModels,
  CatalogFetchError,
  DEFAULT_CATALOG_URL,
  fetchCatalog,
  inferWireType,
  type Catalog,
  type CatalogProviderEntry,
} from '@superliora/sdk';

import { mergeLocalCatalogProviders } from '#/utils/local-catalog-providers';

import { resolveCatalogProviderApiKeySource } from '../credential';
import { errorMessage, modelUnit, writeProviderErr, writeProviderOut } from '../shared';
import type { CatalogAddOptions, CatalogListOptions, ProviderDeps } from '../types';

/**
 * Fetches the models.dev-style public catalog and lists providers, or — when
 * `providerId` is given — drills into one provider and lists its models. This
 * mirrors the discovery half of the TUI "Known third-party provider" flow.
 */
export async function handleCatalogList(
  deps: ProviderDeps,
  providerId: string | undefined,
  opts: CatalogListOptions,
): Promise<void> {
  const url = opts.url ?? DEFAULT_CATALOG_URL;
  const catalog = await loadCatalogOrExit(deps, url);

  if (providerId !== undefined) {
    const entry = catalog[providerId];
    if (entry === undefined) {
      writeProviderErr(deps, 'cli.runtime.provider.catalogProviderNotFound', { providerId, url });
      deps.exit(1);
    }
    const models = catalogProviderModels(entry);
    if (opts.json) {
      deps.stdout.write(
        `${JSON.stringify({ providerId, name: entry.name ?? providerId, models }, null, 2)}\n`,
      );
      return;
    }
    if (models.length === 0) {
      writeProviderOut(deps, 'cli.runtime.provider.catalogNoModels', { providerId });
      return;
    }
    writeProviderOut(deps, 'cli.runtime.provider.catalogProviderHeader', {
      name: entry.name ?? providerId,
      providerId,
    });
    for (const model of models) {
      const cap: string[] = [];
      if (model.capability.tool_use) cap.push('tool_use');
      if (model.capability.thinking) cap.push('thinking');
      if (model.capability.image_in) cap.push('image_in');
      const ctx =
        typeof model.capability.max_context_tokens === 'number'
          ? String(model.capability.max_context_tokens)
          : '?';
      const capLabel = cap.length > 0 ? ` [${cap.join(',')}]` : '';
      writeProviderOut(deps, 'cli.runtime.provider.catalogModelLine', {
        id: model.id,
        ctx,
        capLabel,
      });
    }
    return;
  }

  const filter = opts.filter?.toLowerCase();
  const entries = Object.entries(catalog)
    .filter(([id, entry]) => {
      if (filter === undefined) return true;
      const haystack = `${id} ${entry.name ?? ''}`.toLowerCase();
      return haystack.includes(filter);
    })
    .toSorted(([a], [b]) => a.localeCompare(b));

  if (opts.json) {
    const out: Record<string, CatalogProviderEntry> = {};
    for (const [id, entry] of entries) out[id] = entry;
    deps.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    return;
  }

  if (entries.length === 0) {
    if (filter !== undefined) {
      writeProviderOut(deps, 'cli.runtime.provider.catalogNoMatch', { filter });
    } else {
      writeProviderOut(deps, 'cli.runtime.provider.catalogEmpty');
    }
    return;
  }

  for (const [id, entry] of entries) {
    const modelCount = entry.models === undefined ? 0 : Object.keys(entry.models).length;
    const wire = inferWireType(entry) ?? '?';
    writeProviderOut(deps, 'cli.runtime.provider.catalogListLine', {
      id,
      wire,
      modelCount: String(modelCount),
      name: entry.name ?? '',
    });
  }
}

/**
 * Imports a known provider from the models.dev catalog by id. Unlike
 * `provider add` (which expects a custom api.json), this command relies on
 * the catalog's normalized metadata to fill in context limits and capabilities.
 */
export async function handleCatalogAdd(
  deps: ProviderDeps,
  providerId: string,
  opts: CatalogAddOptions,
): Promise<void> {
  const apiKey = resolveCatalogProviderApiKeySource(opts, deps);
  if (apiKey === undefined) {
    writeProviderErr(deps, 'cli.runtime.provider.catalogMissingApiKey');
    deps.exit(1);
  }

  const url = opts.url ?? DEFAULT_CATALOG_URL;
  const catalog = await loadCatalogOrExit(deps, url);

  const entry = catalog[providerId];
  if (entry === undefined) {
    writeProviderErr(deps, 'cli.runtime.provider.catalogProviderNotFound', { providerId, url });
    deps.exit(1);
  }

  const wire = inferWireType(entry);
  if (wire === undefined) {
    writeProviderErr(deps, 'cli.runtime.provider.catalogUnsupportedWire', { providerId });
    deps.exit(1);
  }

  const models = catalogProviderModels(entry);
  if (models.length === 0) {
    writeProviderErr(deps, 'cli.runtime.provider.catalogNoModels', { providerId });
    deps.exit(1);
  }

  if (opts.defaultModel !== undefined && !models.some((m) => m.id === opts.defaultModel)) {
    writeProviderErr(deps, 'cli.runtime.provider.catalogModelNotInProvider', {
      model: opts.defaultModel,
      providerId,
    });
    deps.exit(1);
  }

  const harness = deps.getHarness();
  await harness.ensureConfigFile();

  let config = await harness.getConfig();

  // Capture defaults BEFORE `removeProvider`, because that call clears
  // `defaultModel` when it points at one of this provider's aliases (see
  // `core-impl.ts removeKimiProvider`). Without this, re-importing an
  // already-configured provider would lose the user's previously-set default
  // even when `--default-model` is not supplied.
  const previousDefaultModel = config.defaultModel;
  const previousDefaultThinking = config.defaultThinking;

  if (config.providers[providerId] !== undefined) {
    config = await harness.removeProvider(providerId);
  }

  const baseUrl = catalogBaseUrl(entry, wire);
  // `applyCatalogProvider` always overwrites both `defaultModel` and
  // `defaultThinking`. The values we pass here are temporary; we restore
  // a consistent state in the post-apply block below.
  applyCatalogProvider(config, {
    providerId,
    wire,
    ...(baseUrl === undefined ? {} : { baseUrl }),
    apiKey,
    models,
    selectedModelId: opts.defaultModel ?? '',
    thinking: false,
  });

  // Resolve the final `defaultModel`:
  //   - If the caller asked for one, `applyCatalogProvider` already set it.
  //   - Else, restore the previous default ONLY when its alias still resolves
  //     after the catalog refresh; the catalog may have dropped the old
  //     model, in which case restoring would point default_model at a
  //     non-existent alias and break the next session.
  if (opts.defaultModel === undefined) {
    const stillResolves =
      previousDefaultModel !== undefined &&
      config.models?.[previousDefaultModel] !== undefined;
    config.defaultModel = stillResolves ? previousDefaultModel : undefined;
  }

  // Always restore `defaultThinking` from what was there before — including
  // `undefined`. Persisting `false` when the user never set it would make
  // `resolveThinkingLevel` (agent-core/src/agent/config/thinking.ts) treat
  // it as an explicit "off" request and silently disable thinking, even
  // for thinking-capable models.
  config.defaultThinking = previousDefaultThinking;

  await harness.setConfig({
    providers: config.providers,
    models: config.models,
    defaultModel: config.defaultModel,
    defaultThinking: config.defaultThinking,
  });

  const displayName = entry.name ?? providerId;
  writeProviderOut(deps, 'cli.runtime.provider.catalogImported', {
    displayName,
    providerId,
    modelCount: String(models.length),
    modelUnit: modelUnit(models.length),
    url,
  });
  if (opts.defaultModel !== undefined) {
    writeProviderOut(deps, 'cli.runtime.provider.catalogDefaultModelSet', {
      providerId,
      model: opts.defaultModel,
    });
  }
}

export async function loadCatalogOrExit(deps: ProviderDeps, url: string): Promise<Catalog> {
  try {
    const catalog = await fetchCatalog(url);
    // Curated SuperLiora providers (ClinePass, …) only attach to the public
    // models.dev catalog — never to a user-supplied custom registry URL.
    if (url === DEFAULT_CATALOG_URL) {
      return mergeLocalCatalogProviders(catalog);
    }
    return catalog;
  } catch (error) {
    // models.dev may be unreachable while SuperLiora-curated providers still
    // need to work (e.g. `liora provider catalog add clinepass`).
    if (url === DEFAULT_CATALOG_URL) {
      return mergeLocalCatalogProviders({});
    }
    writeProviderErr(deps, 'cli.runtime.provider.fetchCatalogFailed', {
      url,
      suffix: error instanceof CatalogFetchError ? ` (HTTP ${String(error.status)})` : '',
      error: errorMessage(error),
    });
    deps.exit(1);
  }
}
