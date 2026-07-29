/**
 * `liora provider use` — set the default model alias.
 */

import { formatModelSelectionLabel } from '../route-utils';
import { writeProviderErr, writeProviderOut } from '../shared';
import type { ProviderDeps } from '../types';

export async function handleProviderUse(
  deps: ProviderDeps,
  modelAlias: string,
): Promise<void> {
  const alias = modelAlias.trim();
  if (alias.length === 0) {
    writeProviderErr(deps, 'cli.runtime.provider.modelAliasRequired');
    deps.exit(1);
  }

  const harness = deps.getHarness();
  await harness.ensureConfigFile();
  const config = await harness.getConfig();
  const model = config.models?.[alias];
  if (model === undefined) {
    writeProviderErr(deps, 'cli.runtime.provider.modelNotFoundListHint', { alias });
    deps.exit(1);
  }
  if (config.providers[model.provider] === undefined) {
    writeProviderErr(deps, 'cli.runtime.provider.modelMissingProvider', {
      alias,
      provider: model.provider,
    });
    deps.exit(1);
  }

  await harness.setConfig({ defaultModel: alias });
  writeProviderOut(deps, 'cli.runtime.provider.defaultModelSet', {
    label: formatModelSelectionLabel(alias, model),
  });
}
