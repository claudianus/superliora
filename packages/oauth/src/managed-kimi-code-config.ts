import { isRecord } from './utils';
import { SUPERLIORA_PROVIDER_NAME } from './managed-kimi-code-constants';
import { fetchManagedKimiCodeModels } from './managed-kimi-code-models';
import {
  managedOAuthPool,
  managedOAuthRef,
  resolveKimiCodeOAuthRef,
} from './managed-kimi-code-oauth-refs';
import type {
  ManagedKimiCodeApplyResult,
  ManagedKimiCodeCleanupResult,
  ManagedKimiCodeModelInfo,
  ManagedKimiConfigShape,
  ManagedKimiModelAlias,
  ManagedKimiCodeProvisionResult,
  ProvisionManagedKimiCodeConfigOptions,
} from './managed-kimi-code-types';
import { defaultBaseUrl, managedModelKey } from './managed-kimi-code-url';

interface SelectedDefaultModel {
  readonly modelKey: string;
  readonly thinking: boolean;
}

function capabilitiesForModel(model: ManagedKimiCodeModelInfo): string[] | undefined {
  const caps = new Set<string>();
  // supports_thinking_type is the full three-state declaration and wins over
  // the legacy supports_reasoning boolean; absent (older servers) falls back.
  switch (model.supportsThinkingType) {
    case 'only':
      caps.add('thinking');
      caps.add('always_thinking');
      break;
    case 'both':
      caps.add('thinking');
      break;
    case 'no':
      break;
    case undefined:
      if (model.supportsReasoning) caps.add('thinking');
      break;
  }
  if (model.supportsImageIn) caps.add('image_in');
  if (model.supportsVideoIn) caps.add('video_in');
  if (model.supportsToolUse ?? true) caps.add('tool_use');
  return caps.size > 0 ? [...caps] : undefined;
}

function assertPositiveContextLength(model: ManagedKimiCodeModelInfo): void {
  if (!Number.isInteger(model.contextLength) || model.contextLength <= 0) {
    throw new Error(`SuperLiora model "${model.id}" must include a positive context_length.`);
  }
}

// The server's three-state declaration overrides any stale defaultThinking
// being preserved from an earlier config: an always-thinking model ('only')
// must never end up with thinking off, and a non-thinking model ('no') must
// never end up with thinking on.
function forcedThinking(
  model: ManagedKimiCodeModelInfo | undefined,
  fallback: boolean,
): boolean {
  if (model?.supportsThinkingType === 'only') return true;
  if (model?.supportsThinkingType === 'no') return false;
  return fallback;
}

function canPreserveDefaultModel(
  existingModels: Record<string, ManagedKimiModelAlias | Record<string, unknown>>,
  defaultModel: string,
  managedModels: ReadonlyMap<string, ManagedKimiCodeModelInfo>,
): boolean {
  if (managedModels.has(defaultModel)) return true;
  const existing = existingModels[defaultModel];
  return isRecord(existing) && existing['provider'] !== SUPERLIORA_PROVIDER_NAME;
}

function selectDefaultModel(
  config: ManagedKimiConfigShape,
  models: readonly ManagedKimiCodeModelInfo[],
  options: { readonly preserveExisting: boolean },
): SelectedDefaultModel {
  const firstModel = models[0];
  if (firstModel === undefined) {
    throw new Error('No models available for SuperLiora.');
  }

  const managedModels = new Map(models.map((model) => [managedModelKey(model.id), model]));
  const existingModels = config.models ?? {};
  const currentDefault =
    typeof config.defaultModel === 'string' && config.defaultModel.length > 0
      ? config.defaultModel
      : undefined;

  if (
    options.preserveExisting &&
    currentDefault !== undefined &&
    canPreserveDefaultModel(existingModels, currentDefault, managedModels)
  ) {
    const preservedModel = managedModels.get(currentDefault);
    return {
      modelKey: currentDefault,
      thinking: forcedThinking(
        preservedModel,
        config.defaultThinking ?? preservedModel?.supportsReasoning ?? false,
      ),
    };
  }

  return {
    modelKey: managedModelKey(firstModel.id),
    thinking: forcedThinking(firstModel, config.defaultThinking ?? firstModel.supportsReasoning),
  };
}

export function applyManagedKimiCodeConfig(
  config: ManagedKimiConfigShape,
  options: {
    readonly models: readonly ManagedKimiCodeModelInfo[];
    readonly baseUrl?: string | undefined;
    readonly oauthKey?: string | undefined;
    readonly oauthHost?: string | undefined;
    readonly preserveDefaultModel?: boolean | undefined;
  },
): ManagedKimiCodeApplyResult {
  if (options.models.length === 0) {
    throw new Error('No models available for SuperLiora.');
  }
  for (const model of options.models) {
    assertPositiveContextLength(model);
  }

  const baseUrl = defaultBaseUrl(options.baseUrl);
  const oauth =
    options.oauthKey !== undefined
      ? managedOAuthRef({ key: options.oauthKey, oauthHost: options.oauthHost })
      : resolveKimiCodeOAuthRef({ baseUrl, oauthHost: options.oauthHost });
  const oauthPool = managedOAuthPool(oauth, config.providers[SUPERLIORA_PROVIDER_NAME]);
  const existingModels = config.models ?? {};
  const selectedDefault = selectDefaultModel(config, options.models, {
    preserveExisting: options.preserveDefaultModel === true,
  });

  config.providers[SUPERLIORA_PROVIDER_NAME] = {
    type: 'kimi',
    baseUrl,
    apiKey: '',
    oauth: oauthPool[0],
    ...(oauthPool.length > 1 ? { oauths: oauthPool.slice(1) } : {}),
  };

  const upstreamKeys = new Set(options.models.map((model) => managedModelKey(model.id)));
  for (const [key, model] of Object.entries(existingModels)) {
    if (
      isRecord(model) &&
      model['provider'] === SUPERLIORA_PROVIDER_NAME &&
      !upstreamKeys.has(key)
    ) {
      delete existingModels[key];
    }
  }
  for (const model of options.models) {
    const capabilities = capabilitiesForModel(model);
    const supportsAdaptiveThinking =
      model.protocol === 'anthropic' &&
      (capabilities?.includes('thinking') === true ||
        capabilities?.includes('always_thinking') === true);
    const key = managedModelKey(model.id);
    const existing = isRecord(existingModels[key]) ? existingModels[key] : {};
    existingModels[key] = {
      ...existing,
      provider: SUPERLIORA_PROVIDER_NAME,
      model: model.id,
      maxContextSize: model.contextLength,
      capabilities,
      ...(model.supportEfforts !== undefined ? { supportEfforts: [...model.supportEfforts] } : {}),
      ...(model.defaultEffort !== undefined ? { defaultEffort: model.defaultEffort } : {}),
      ...(model.displayName !== undefined ? { displayName: model.displayName } : {}),
      protocol: model.protocol,
      betaApi: model.protocol === 'anthropic' ? true : undefined,
      adaptiveThinking: supportsAdaptiveThinking ? true : undefined,
    };
  }

  config.models = existingModels;
  config.defaultModel = selectedDefault.modelKey;
  config.defaultThinking = selectedDefault.thinking;
  config.services = {
    moonshotSearch: {
      baseUrl: `${baseUrl}/search`,
      apiKey: '',
      oauth,
    },
    moonshotFetch: {
      baseUrl: `${baseUrl}/fetch`,
      apiKey: '',
      oauth,
    },
  };

  return {
    defaultModel: selectedDefault.modelKey,
    defaultThinking: selectedDefault.thinking,
  };
}

export function applyManagedKimiCodeLogoutConfig(config: ManagedKimiConfigShape): void {
  delete config.providers[SUPERLIORA_PROVIDER_NAME];

  let removedDefaultModel = false;
  const existingModels = config.models ?? {};
  for (const [key, model] of Object.entries(existingModels)) {
    if (!isRecord(model) || model['provider'] !== SUPERLIORA_PROVIDER_NAME) continue;
    delete existingModels[key];
    if (config.defaultModel === key) removedDefaultModel = true;
  }
  config.models = existingModels;

  if (removedDefaultModel) {
    config.defaultModel = undefined;
  }

  if (config['defaultProvider'] === SUPERLIORA_PROVIDER_NAME) {
    config['defaultProvider'] = undefined;
  }

  if (config.services !== undefined) {
    delete config.services.moonshotSearch;
    delete config.services.moonshotFetch;
    if (Object.keys(config.services).length === 0) {
      config.services = undefined;
    }
  }
}

export function clearManagedKimiCodeConfig(
  config: ManagedKimiConfigShape,
): ManagedKimiCodeCleanupResult {
  const removedProvider = Object.hasOwn(config.providers, SUPERLIORA_PROVIDER_NAME);
  delete config.providers[SUPERLIORA_PROVIDER_NAME];

  const removedModels: string[] = [];
  const models = config.models;
  if (models !== undefined) {
    for (const [key, model] of Object.entries(models)) {
      if (!isRecord(model) || model['provider'] !== SUPERLIORA_PROVIDER_NAME) continue;
      delete models[key];
      removedModels.push(key);
    }
  }

  let defaultModelCleared = false;
  if (typeof config.defaultModel === 'string' && removedModels.includes(config.defaultModel)) {
    config.defaultModel = undefined;
    defaultModelCleared = true;
  }

  const removedServices: string[] = [];
  if (config.services?.moonshotSearch !== undefined) {
    delete config.services.moonshotSearch;
    removedServices.push('moonshotSearch');
  }
  if (config.services?.moonshotFetch !== undefined) {
    delete config.services.moonshotFetch;
    removedServices.push('moonshotFetch');
  }
  if (config.services !== undefined && Object.keys(config.services).length === 0) {
    config.services = undefined;
  }

  return {
    providerName: SUPERLIORA_PROVIDER_NAME,
    removedProvider,
    removedModels,
    defaultModelCleared,
    removedServices,
  };
}

export async function provisionManagedKimiCodeConfigAfterLogin(
  options: ProvisionManagedKimiCodeConfigOptions<ManagedKimiConfigShape>,
): Promise<ManagedKimiCodeProvisionResult> {
  return provisionManagedKimiCodeConfig(options);
}

export async function provisionManagedKimiCodeConfig<TConfig>(
  options: ProvisionManagedKimiCodeConfigOptions<TConfig>,
): Promise<ManagedKimiCodeProvisionResult> {
  const models = await fetchManagedKimiCodeModels(options);
  const config = await options.adapter.read();
  const applied = options.adapter.apply(config, {
    models,
    baseUrl: options.baseUrl,
    oauthKey: options.oauthKey,
    oauthHost: options.oauthHost,
    preserveDefaultModel: options.preserveDefaultModel,
  });
  await options.adapter.write(config);
  return {
    providerName: SUPERLIORA_PROVIDER_NAME,
    defaultModel: applied.defaultModel,
    defaultThinking: applied.defaultThinking,
    models,
    configPath: options.adapter.configPath,
  };
}
