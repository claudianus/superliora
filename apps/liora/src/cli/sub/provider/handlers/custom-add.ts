/**
 * `liora provider custom add` — register a custom OpenAI-compatible endpoint.
 */

import type { LioraConfig } from '@superliora/sdk';

import { providerHasOAuth, resolveProviderApiKeySource } from '../credential';
import { errorMessage, parsePositiveInt, writeProviderErr, writeProviderOut } from '../shared';
import type { CustomAddOptions, ProviderDeps } from '../types';

import {
  applyCustomEndpointProvider,
  DEFAULT_CUSTOM_ENDPOINT_CONTEXT_SIZE,
} from '#/utils/custom-provider';

function parseProviderType(
  value: string,
  deps: ProviderDeps,
): LioraConfig['providers'][string]['type'] {
  switch (value) {
    case 'anthropic':
    case 'openai':
    case 'kimi':
    case 'google-genai':
    case 'openai_responses':
    case 'vertexai':
      return value;
    default:
      writeProviderErr(deps, 'cli.runtime.provider.providerTypeInvalid');
      deps.exit(1);
  }
}

export async function handleProviderCustomAdd(
  deps: ProviderDeps,
  providerId: string,
  opts: CustomAddOptions,
): Promise<void> {
  const baseUrl = opts.baseUrl?.trim();
  if (baseUrl === undefined || baseUrl.length === 0) {
    writeProviderErr(deps, 'cli.runtime.provider.missingBaseUrl');
    deps.exit(1);
  }
  const modelId = opts.model?.trim();
  if (modelId === undefined || modelId.length === 0) {
    writeProviderErr(deps, 'cli.runtime.provider.missingModelId');
    deps.exit(1);
  }
  const apiKey = resolveProviderApiKeySource(
    { apiKey: opts.apiKey, apiKeyEnv: opts.apiKeyEnv },
    deps,
  );
  if (apiKey === undefined && opts.keyless !== true) {
    writeProviderErr(deps, 'cli.runtime.provider.missingCustomApiKey');
    deps.exit(1);
  }

  const providerType =
    opts.type === undefined ? undefined : parseProviderType(opts.type, deps);
  const maxContextSize =
    opts.context === undefined
      ? DEFAULT_CUSTOM_ENDPOINT_CONTEXT_SIZE
      : parsePositiveInt(opts.context, 'Context window', deps);
  const maxOutputSize =
    opts.output === undefined
      ? undefined
      : parsePositiveInt(opts.output, 'Max output tokens', deps);

  const harness = deps.getHarness();
  await harness.ensureConfigFile();
  const config = await harness.getConfig();
  const existingProvider = config.providers[providerId];
  if (existingProvider !== undefined && providerHasOAuth(existingProvider)) {
    writeProviderErr(deps, 'cli.runtime.provider.oauthChooseDifferentId', { providerId });
    deps.exit(1);
  }

  let applied: ReturnType<typeof applyCustomEndpointProvider>;
  try {
    applied = applyCustomEndpointProvider(config, {
      providerId,
      baseUrl,
      modelId,
      apiKey: apiKey ?? 'no-key-required',
      ...(providerType === undefined ? {} : { providerType }),
      alias: opts.alias,
      maxContextSize,
      maxOutputSize,
      displayName: opts.displayName,
      thinking: opts.thinking === true,
      setDefault: opts.setDefault === true,
    });
  } catch (error) {
    deps.stderr.write(`${errorMessage(error)}\n`);
    deps.exit(1);
  }

  await harness.setConfig({
    providers: config.providers,
    models: config.models,
    defaultModel: config.defaultModel,
  });
  writeProviderOut(deps, 'cli.runtime.provider.customEndpointAdded', {
    providerId: applied.providerId,
    modelAlias: applied.modelAlias,
  });
  if (opts.setDefault === true) {
    writeProviderOut(deps, 'cli.runtime.provider.defaultModelSetAlias', { alias: applied.modelAlias });
  }
}
