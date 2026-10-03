import type { LioraConfig } from '../../config';
import { effectiveModelAlias } from '../../config/model';
import { ErrorCodes, LioraError } from '../../errors';

export interface ConfiguredSessionRoute {
  readonly alias: string;
  /** Primary alias followed only by operator-configured fallback aliases. */
  readonly chain: readonly string[];
  readonly source: 'configured';
}

/** Resolve explicit aliases or an advertised provider default without probes or scoring. */
export function resolveConfiguredSessionRoute(input: {
  readonly config: LioraConfig;
  readonly alias?: string;
}): ConfiguredSessionRoute {
  const { config } = input;
  const selected = input.alias?.trim() || config.defaultModel?.trim();
  let alias = selected;
  if (alias === undefined || (alias.toLowerCase() === 'auto' && config.models?.[alias] === undefined)) {
    const providerName = config.defaultProvider;
    const provider = providerName === undefined ? undefined : config.providers[providerName];
    const defaultModel = provider?.defaultModel;
    alias = defaultModel === undefined ? undefined : Object.keys(config.models ?? {}).find((name) => {
      const model = config.models?.[name];
      return model !== undefined && model.provider === providerName && (name === defaultModel || model.model === defaultModel);
    });
  }
  const model = alias === undefined ? undefined : config.models?.[alias];
  if (alias === undefined || model === undefined || config.providers[model.provider] === undefined) {
    throw new LioraError(ErrorCodes.CONFIG_INVALID, 'Select a configured model alias or configure a provider default model.');
  }
  const chain: string[] = [alias];
  for (const fallback of effectiveModelAlias(model).fallbackModels ?? []) {
    const fallbackModel = config.models?.[fallback];
    if (fallbackModel === undefined || config.providers[fallbackModel.provider] === undefined) {
      throw new LioraError(ErrorCodes.CONFIG_INVALID, `Configured fallback model alias "${fallback}" is unavailable in config.`);
    }
    if (!chain.includes(fallback)) chain.push(fallback);
  }
  return { alias, chain, source: 'configured' };
}
