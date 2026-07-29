/**
 * `liora provider list` — show configured providers and their models.
 */

import { providerApiKeyCount } from '../credential';
import { formatAliasListLabel, formatModelSelectionLabel, providerSourceLabel } from '../route-utils';
import { writeProviderOut } from '../shared';
import type { ListOptions, ProviderDeps } from '../types';

export async function handleProviderList(
  deps: ProviderDeps,
  opts: ListOptions,
): Promise<void> {
  const harness = deps.getHarness();
  await harness.ensureConfigFile();
  const config = await harness.getConfig();

  if (opts.json) {
    deps.stdout.write(
      `${JSON.stringify(
        {
          providers: config.providers,
          models: config.models ?? {},
          defaultModel: config.defaultModel,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  const models = config.models ?? {};
  const modelsByProvider = new Map<string, string[]>();
  for (const [alias, model] of Object.entries(models)) {
    const list = modelsByProvider.get(model.provider) ?? [];
    list.push(alias);
    modelsByProvider.set(model.provider, list);
  }

  const providerIds = Object.keys(config.providers).toSorted();
  if (providerIds.length === 0) {
    writeProviderOut(deps, 'cli.runtime.provider.noProvidersConfigured');
    return;
  }

  for (const id of providerIds) {
    const provider = config.providers[id]!;
    const aliases = modelsByProvider.get(id) ?? [];
    const sourceLabel = providerSourceLabel(provider);
    writeProviderOut(deps, 'cli.runtime.provider.listLine', {
      id,
      type: provider.type,
      modelCount: String(aliases.length),
      keyCount: String(providerApiKeyCount(provider)),
      source: sourceLabel,
    });
    if (aliases.length > 0) {
      const labels = aliases
        .toSorted()
        .map((alias) => formatAliasListLabel(alias, models[alias]));
      writeProviderOut(deps, 'cli.runtime.provider.listAliases', { aliases: labels.join(', ') });
    }
  }
  if (config.defaultModel !== undefined) {
    writeProviderOut(deps, 'cli.runtime.provider.listDefaultModel', {
      label: formatModelSelectionLabel(config.defaultModel, models[config.defaultModel]),
    });
  }
}
