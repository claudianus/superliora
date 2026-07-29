/**
 * `liora provider add` — import providers from a custom api.json registry.
 */

import {
  applyCustomRegistryProvider,
  CustomRegistryApiError,
  fetchCustomRegistry,
  type CustomRegistrySource,
  type ManagedKimiConfigShape,
} from '@superliora/oauth';
import type { LioraConfig } from '@superliora/sdk';

import { resolveApiKey } from '../credential';
import { errorMessage, modelUnit, providerUnit, writeProviderErr, writeProviderOut } from '../shared';
import type { AddOptions, ProviderDeps } from '../types';

function asManaged(config: LioraConfig): ManagedKimiConfigShape {
  return config as unknown as ManagedKimiConfigShape;
}

export async function handleProviderAdd(
  deps: ProviderDeps,
  url: string,
  opts: AddOptions,
): Promise<void> {
  const apiKey = resolveApiKey(opts.apiKey, deps.env);
  if (apiKey === undefined) {
    writeProviderErr(deps, 'cli.runtime.provider.missingRegistryApiKey');
    deps.exit(1);
  }

  const trimmedUrl = url.trim();
  if (trimmedUrl.length === 0) {
    writeProviderErr(deps, 'cli.runtime.provider.registryUrlRequired');
    deps.exit(1);
  }

  const source: CustomRegistrySource = {
    kind: 'apiJson',
    url: trimmedUrl,
    apiKey,
  };

  const harness = deps.getHarness();
  await harness.ensureConfigFile();

  let entries: Awaited<ReturnType<typeof fetchCustomRegistry>>;
  try {
    entries = await fetchCustomRegistry(source);
  } catch (error) {
    writeProviderErr(deps, 'cli.runtime.provider.fetchRegistryFailed', {
      suffix: error instanceof CustomRegistryApiError ? ` (HTTP ${String(error.status)})` : '',
      error: errorMessage(error),
    });
    deps.exit(1);
  }

  const entryList = Object.values(entries);
  if (entryList.length === 0) {
    writeProviderErr(deps, 'cli.runtime.provider.registryEmpty', { url: trimmedUrl });
    deps.exit(1);
  }

  let config = await harness.getConfig();
  const staleIds = entryList
    .filter((entry) => config.providers[entry.id] !== undefined)
    .map((entry) => entry.id);
  for (const id of staleIds) {
    config = await harness.removeProvider(id);
  }

  const addedProviderIds: string[] = [];
  let modelCount = 0;
  for (const entry of entryList) {
    applyCustomRegistryProvider(asManaged(config), entry, source);
    addedProviderIds.push(entry.id);
    modelCount += Object.keys(entry.models).length;
  }

  await harness.setConfig({
    providers: config.providers,
    models: config.models,
  });

  writeProviderOut(deps, 'cli.runtime.provider.importedHeader', {
    count: String(addedProviderIds.length),
    providerUnit: providerUnit(addedProviderIds.length),
    modelCount: String(modelCount),
    modelUnit: modelUnit(modelCount),
    url: trimmedUrl,
  });
  for (const id of addedProviderIds) {
    writeProviderOut(deps, 'cli.runtime.provider.importedItem', { id });
  }
}
