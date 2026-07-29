/**
 * `liora provider key *` handlers — API-key credential management.
 */

import type { LioraConfig } from '@superliora/sdk';

import {
  addApiKeySlotsToProvider,
  parseCredentialLabel,
  parseKeyIndex,
  promoteSlot,
  providerApiKeySlots,
  providerHasOAuth,
  resolveProviderApiKeySources,
  resolveProviderCredentialLabels,
  resolveProviderCredentialLocalLimits,
  rewriteProviderApiKeySlots,
} from '../credential';
import { providerAutoRouteModels, writeProviderAutoRouteSummary } from '../route-utils';
import {
  apiKeyWord,
  nonEmptyString,
  parsePositiveInt,
  routeRole,
  writeProviderErr,
  writeProviderOut,
} from '../shared';
import type { KeyAddOptions, KeyLimitOptions, ProviderDeps } from '../types';

export async function handleProviderKeyAdd(
  deps: ProviderDeps,
  providerId: string,
  opts: KeyAddOptions,
): Promise<void> {
  const apiKeys = resolveProviderApiKeySources(opts, deps);
  if (apiKeys.length === 0) {
    writeProviderErr(deps, 'cli.runtime.provider.missingKeyAddApiKey');
    deps.exit(1);
  }

  const harness = deps.getHarness();
  await harness.ensureConfigFile();
  const config = await harness.getConfig();
  const provider = config.providers[providerId];
  if (provider === undefined) {
    writeProviderErr(deps, 'cli.runtime.provider.notFound', { providerId });
    deps.exit(1);
  }
  if (providerHasOAuth(provider)) {
    writeProviderErr(deps, 'cli.runtime.provider.oauthApiKeyMixed', { providerId });
    deps.exit(1);
  }

  const baseUrl = nonEmptyString(opts.baseUrl);
  const labels = resolveProviderCredentialLabels(opts, apiKeys.length, deps);
  const localLimits = resolveProviderCredentialLocalLimits(opts, deps);
  const nextProvider = addApiKeySlotsToProvider(
    provider,
    apiKeys.map((apiKey, index) => ({
      apiKey,
      baseUrl,
      label: labels[index],
      rpm: localLimits.rpm,
      tpm: localLimits.tpm,
    })),
  );
  if (nextProvider === undefined) {
    const autoRoute = opts.autoRoute === true ? providerAutoRouteModels(config, providerId) : undefined;
    if (autoRoute?.models !== undefined) {
      await harness.setConfig({ models: autoRoute.models });
    }
    writeProviderOut(deps, 'cli.runtime.provider.apiKeyAlreadyConfigured', {
      keyWord: apiKeyWord(apiKeys.length),
      providerId,
    });
    writeProviderAutoRouteSummary(deps, providerId, autoRoute);
    return;
  }

  const nextConfig: LioraConfig = {
    ...config,
    providers: {
      ...config.providers,
      [providerId]: nextProvider,
    },
  };
  const autoRoute = opts.autoRoute === true ? providerAutoRouteModels(nextConfig, providerId) : undefined;
  await harness.setConfig({
    providers: nextConfig.providers,
    models: autoRoute?.models,
  });
  if (apiKeys.length === 1) {
    writeProviderOut(deps, 'cli.runtime.provider.apiKeyAdded', { providerId });
    writeProviderAutoRouteSummary(deps, providerId, autoRoute);
    return;
  }
  writeProviderOut(deps, 'cli.runtime.provider.apiKeysAdded', {
    count: String(apiKeys.length),
    providerId,
  });
  writeProviderAutoRouteSummary(deps, providerId, autoRoute);
}

export async function handleProviderKeyList(
  deps: ProviderDeps,
  providerId: string,
): Promise<void> {
  const harness = deps.getHarness();
  await harness.ensureConfigFile();
  const config = await harness.getConfig();
  const provider = config.providers[providerId];
  if (provider === undefined) {
    writeProviderErr(deps, 'cli.runtime.provider.notFound', { providerId });
    deps.exit(1);
  }

  const slots = providerApiKeySlots(provider);
  if (slots.length === 0) {
    writeProviderOut(deps, 'cli.runtime.provider.noApiKeys', { providerId });
    return;
  }

  writeProviderOut(deps, 'cli.runtime.provider.apiKeysHeader', {
    providerId,
    count: String(slots.length),
    keyWord: apiKeyWord(slots.length),
  });
  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index]!;
    const role = routeRole(index);
    const labelText = slot.label === undefined ? '' : `  label=${slot.label}`;
    const rpmText = slot.rpm === undefined ? '' : `  rpm=${String(slot.rpm)}`;
    const tpmText = slot.tpm === undefined ? '' : `  tpm=${String(slot.tpm)}`;
    const baseUrlText = slot.baseUrl === undefined ? '' : `  base_url=${slot.baseUrl}`;
    writeProviderOut(deps, 'cli.runtime.provider.apiKeyListLine', {
      index: String(index + 1),
      role,
      labelText,
      rpmText,
      tpmText,
      baseUrlText,
    });
  }
}

export async function handleProviderKeyRemove(
  deps: ProviderDeps,
  providerId: string,
  indexText: string,
): Promise<void> {
  const index = parseKeyIndex(indexText, deps);
  const harness = deps.getHarness();
  await harness.ensureConfigFile();
  const config = await harness.getConfig();
  const provider = config.providers[providerId];
  if (provider === undefined) {
    writeProviderErr(deps, 'cli.runtime.provider.notFound', { providerId });
    deps.exit(1);
  }
  if (providerHasOAuth(provider)) {
    writeProviderErr(deps, 'cli.runtime.provider.oauthApiKeyCannotRemove', { providerId });
    deps.exit(1);
  }

  const slots = providerApiKeySlots(provider);
  if (index < 1 || index > slots.length) {
    writeProviderErr(deps, 'cli.runtime.provider.apiKeyNotFound', {
      index: String(index),
      providerId,
    });
    deps.exit(1);
  }

  const nextSlots = slots.filter((_, keyIndex) => keyIndex !== index - 1);
  await harness.setConfig({
    providers: {
      ...config.providers,
      [providerId]: rewriteProviderApiKeySlots(provider, nextSlots),
    },
  });
  writeProviderOut(deps, 'cli.runtime.provider.apiKeyRemoved', { index: String(index), providerId });
}

export async function handleProviderKeyPromote(
  deps: ProviderDeps,
  providerId: string,
  indexText: string,
): Promise<void> {
  const index = parseKeyIndex(indexText, deps);
  const harness = deps.getHarness();
  await harness.ensureConfigFile();
  const config = await harness.getConfig();
  const provider = config.providers[providerId];
  if (provider === undefined) {
    writeProviderErr(deps, 'cli.runtime.provider.notFound', { providerId });
    deps.exit(1);
  }
  if (providerHasOAuth(provider)) {
    writeProviderErr(deps, 'cli.runtime.provider.oauthApiKeyCannotPromote', { providerId });
    deps.exit(1);
  }

  const slots = providerApiKeySlots(provider);
  if (index < 1 || index > slots.length) {
    writeProviderErr(deps, 'cli.runtime.provider.apiKeyNotFound', {
      index: String(index),
      providerId,
    });
    deps.exit(1);
  }
  if (index === 1) {
    writeProviderOut(deps, 'cli.runtime.provider.apiKeyAlreadyPrimary', { providerId });
    return;
  }

  await harness.setConfig({
    providers: {
      ...config.providers,
      [providerId]: rewriteProviderApiKeySlots(provider, promoteSlot(slots, index - 1)),
    },
  });
  writeProviderOut(deps, 'cli.runtime.provider.apiKeyPromoted', {
    index: String(index),
    providerId,
  });
}

export async function handleProviderKeyLabel(
  deps: ProviderDeps,
  providerId: string,
  indexText: string,
  labelText: string,
): Promise<void> {
  const index = parseKeyIndex(indexText, deps);
  const label = parseCredentialLabel(labelText, deps);
  const harness = deps.getHarness();
  await harness.ensureConfigFile();
  const config = await harness.getConfig();
  const provider = config.providers[providerId];
  if (provider === undefined) {
    writeProviderErr(deps, 'cli.runtime.provider.notFound', { providerId });
    deps.exit(1);
  }
  if (providerHasOAuth(provider)) {
    writeProviderErr(deps, 'cli.runtime.provider.oauthApiKeyCannotLabel', { providerId });
    deps.exit(1);
  }

  const slots = providerApiKeySlots(provider);
  if (index < 1 || index > slots.length) {
    writeProviderErr(deps, 'cli.runtime.provider.apiKeyNotFound', {
      index: String(index),
      providerId,
    });
    deps.exit(1);
  }
  const duplicate = slots.find(
    (slot, slotIndex) =>
      slotIndex !== index - 1 && slot.label?.toLowerCase() === label.toLowerCase(),
  );
  if (duplicate !== undefined) {
    writeProviderErr(deps, 'cli.runtime.provider.credentialLabelDuplicate', { label });
    deps.exit(1);
  }

  const nextSlots = slots.map((slot, slotIndex) =>
    slotIndex === index - 1 ? { ...slot, label } : slot,
  );
  await harness.setConfig({
    providers: {
      ...config.providers,
      [providerId]: rewriteProviderApiKeySlots(provider, nextSlots),
    },
  });
  writeProviderOut(deps, 'cli.runtime.provider.apiKeyLabeled', {
    index: String(index),
    providerId,
    label,
  });
}

export async function handleProviderKeyUnlabel(
  deps: ProviderDeps,
  providerId: string,
  indexText: string,
): Promise<void> {
  const index = parseKeyIndex(indexText, deps);
  const harness = deps.getHarness();
  await harness.ensureConfigFile();
  const config = await harness.getConfig();
  const provider = config.providers[providerId];
  if (provider === undefined) {
    writeProviderErr(deps, 'cli.runtime.provider.notFound', { providerId });
    deps.exit(1);
  }
  if (providerHasOAuth(provider)) {
    writeProviderErr(deps, 'cli.runtime.provider.oauthApiKeyCannotUnlabel', { providerId });
    deps.exit(1);
  }

  const slots = providerApiKeySlots(provider);
  if (index < 1 || index > slots.length) {
    writeProviderErr(deps, 'cli.runtime.provider.apiKeyNotFound', {
      index: String(index),
      providerId,
    });
    deps.exit(1);
  }
  if (slots[index - 1]?.label === undefined) {
    writeProviderOut(deps, 'cli.runtime.provider.apiKeyNoLabel', {
      index: String(index),
      providerId,
    });
    return;
  }

  const nextSlots = slots.map((slot, slotIndex) =>
    slotIndex === index - 1 ? { ...slot, label: undefined } : slot,
  );
  await harness.setConfig({
    providers: {
      ...config.providers,
      [providerId]: rewriteProviderApiKeySlots(provider, nextSlots),
    },
  });
  writeProviderOut(deps, 'cli.runtime.provider.apiKeyLabelRemoved', {
    index: String(index),
    providerId,
  });
}

export async function handleProviderKeyLimit(
  deps: ProviderDeps,
  providerId: string,
  indexText: string,
  opts: KeyLimitOptions,
): Promise<void> {
  if (opts.rpm === undefined && opts.tpm === undefined && opts.clear !== true) {
    writeProviderErr(deps, 'cli.runtime.provider.keyLimitNothingToUpdate');
    deps.exit(1);
  }
  if (opts.clear === true && (opts.rpm !== undefined || opts.tpm !== undefined)) {
    writeProviderErr(deps, 'cli.runtime.provider.keyLimitClearOrValues');
    deps.exit(1);
  }

  const index = parseKeyIndex(indexText, deps);
  const harness = deps.getHarness();
  await harness.ensureConfigFile();
  const config = await harness.getConfig();
  const provider = config.providers[providerId];
  if (provider === undefined) {
    writeProviderErr(deps, 'cli.runtime.provider.notFound', { providerId });
    deps.exit(1);
  }
  if (providerHasOAuth(provider)) {
    writeProviderErr(deps, 'cli.runtime.provider.oauthApiKeyLimitsCannotChange', { providerId });
    deps.exit(1);
  }

  const slots = providerApiKeySlots(provider);
  if (index < 1 || index > slots.length) {
    writeProviderErr(deps, 'cli.runtime.provider.apiKeyNotFound', {
      index: String(index),
      providerId,
    });
    deps.exit(1);
  }

  const current = slots[index - 1]!;
  const rpm =
    opts.clear === true
      ? undefined
      : opts.rpm === undefined
        ? current.rpm
        : parsePositiveInt(opts.rpm, 'Requests per minute', deps);
  const tpm =
    opts.clear === true
      ? undefined
      : opts.tpm === undefined
        ? current.tpm
        : parsePositiveInt(opts.tpm, 'Tokens per minute', deps);
  const nextSlots = slots.map((slot, slotIndex) =>
    slotIndex === index - 1 ? { ...slot, rpm, tpm } : slot,
  );
  await harness.setConfig({
    providers: {
      ...config.providers,
      [providerId]: rewriteProviderApiKeySlots(provider, nextSlots),
    },
  });
  if (opts.clear === true) {
    writeProviderOut(deps, 'cli.runtime.provider.keyLimitsCleared', {
      index: String(index),
      providerId,
    });
    return;
  }
  writeProviderOut(deps, 'cli.runtime.provider.keyLimitsUpdated', {
    index: String(index),
    providerId,
  });
}

export async function handleProviderKeyClear(
  deps: ProviderDeps,
  providerId: string,
): Promise<void> {
  const harness = deps.getHarness();
  await harness.ensureConfigFile();
  const config = await harness.getConfig();
  const provider = config.providers[providerId];
  if (provider === undefined) {
    writeProviderErr(deps, 'cli.runtime.provider.notFound', { providerId });
    deps.exit(1);
  }
  if (providerHasOAuth(provider)) {
    writeProviderErr(deps, 'cli.runtime.provider.oauthApiKeyCannotRemove', { providerId });
    deps.exit(1);
  }

  await harness.setConfig({
    providers: {
      ...config.providers,
      [providerId]: rewriteProviderApiKeySlots(provider, []),
    },
  });
  writeProviderOut(deps, 'cli.runtime.provider.allApiKeysRemoved', { providerId });
}
