/**
 * `liora provider oauth *` handlers — OAuth credential management.
 */

import type { LioraConfig } from '@superliora/sdk';

import {
  addOAuthRefToProvider,
  fingerprintOAuthRef,
  parseCredentialLabel,
  parseOAuthIndex,
  parseOAuthStorage,
  promoteSlot,
  providerHasApiKeySource,
  providerOAuthRefs,
  rewriteProviderOAuthRefs,
} from '../credential';
import { providerAutoRouteModels, writeProviderAutoRouteSummary } from '../route-utils';
import {
  nonEmptyString,
  oauthRefWord,
  routeRole,
  writeProviderErr,
  writeProviderOut,
} from '../shared';
import type { ConfigOAuthRef, OAuthAddOptions, ProviderDeps } from '../types';

export async function handleProviderOAuthAdd(
  deps: ProviderDeps,
  providerId: string,
  opts: OAuthAddOptions,
): Promise<void> {
  const key = nonEmptyString(opts.key);
  if (key === undefined) {
    writeProviderErr(deps, 'cli.runtime.provider.missingOAuthStorageKey');
    deps.exit(1);
  }
  const storage = parseOAuthStorage(opts.storage ?? 'file', deps);
  const oauthHost = nonEmptyString(opts.oauthHost);
  const label =
    opts.label === undefined ? undefined : parseCredentialLabel(opts.label, deps);
  const oauthRef: ConfigOAuthRef = {
    storage,
    key,
    oauthHost,
    label,
  };

  const harness = deps.getHarness();
  await harness.ensureConfigFile();
  const config = await harness.getConfig();
  const provider = config.providers[providerId];
  if (provider === undefined) {
    writeProviderErr(deps, 'cli.runtime.provider.notFound', { providerId });
    deps.exit(1);
  }
  if (providerHasApiKeySource(provider)) {
    writeProviderErr(deps, 'cli.runtime.provider.oauthApiKeyMixedInto', { providerId });
    deps.exit(1);
  }

  const nextProvider = addOAuthRefToProvider(provider, oauthRef);
  if (nextProvider === undefined) {
    const autoRoute = opts.autoRoute === true ? providerAutoRouteModels(config, providerId) : undefined;
    if (autoRoute?.models !== undefined) {
      await harness.setConfig({ models: autoRoute.models });
    }
    writeProviderOut(deps, 'cli.runtime.provider.oauthRefAlreadyConfigured', { providerId });
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
  writeProviderOut(deps, 'cli.runtime.provider.oauthRefAdded', { providerId });
  writeProviderAutoRouteSummary(deps, providerId, autoRoute);
}

export async function handleProviderOAuthList(
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

  const refs = providerOAuthRefs(provider);
  if (refs.length === 0) {
    writeProviderOut(deps, 'cli.runtime.provider.noOAuthRefs', { providerId });
    return;
  }

  writeProviderOut(deps, 'cli.runtime.provider.oauthRefsHeader', {
    providerId,
    count: String(refs.length),
    refWord: oauthRefWord(refs.length),
  });
  for (let index = 0; index < refs.length; index += 1) {
    const ref = refs[index]!;
    const role = routeRole(index);
    const labelText = ref.label === undefined ? '' : `  label=${ref.label}`;
    writeProviderOut(deps, 'cli.runtime.provider.oauthListLine', {
      index: String(index + 1),
      role,
      labelText,
      storage: ref.storage,
      host: ref.oauthHost ?? '(default)',
      fingerprint: fingerprintOAuthRef(ref),
    });
  }
}

export async function handleProviderOAuthRemove(
  deps: ProviderDeps,
  providerId: string,
  indexText: string,
): Promise<void> {
  const index = parseOAuthIndex(indexText, deps);
  const harness = deps.getHarness();
  await harness.ensureConfigFile();
  const config = await harness.getConfig();
  const provider = config.providers[providerId];
  if (provider === undefined) {
    writeProviderErr(deps, 'cli.runtime.provider.notFound', { providerId });
    deps.exit(1);
  }

  const refs = providerOAuthRefs(provider);
  if (index < 1 || index > refs.length) {
    writeProviderErr(deps, 'cli.runtime.provider.oauthRefNotFound', {
      index: String(index),
      providerId,
    });
    deps.exit(1);
  }

  const nextRefs = refs.filter((_, refIndex) => refIndex !== index - 1);
  await harness.setConfig({
    providers: {
      ...config.providers,
      [providerId]: rewriteProviderOAuthRefs(provider, nextRefs),
    },
  });
  writeProviderOut(deps, 'cli.runtime.provider.oauthRefRemoved', {
    index: String(index),
    providerId,
  });
}

export async function handleProviderOAuthPromote(
  deps: ProviderDeps,
  providerId: string,
  indexText: string,
): Promise<void> {
  const index = parseOAuthIndex(indexText, deps);
  const harness = deps.getHarness();
  await harness.ensureConfigFile();
  const config = await harness.getConfig();
  const provider = config.providers[providerId];
  if (provider === undefined) {
    writeProviderErr(deps, 'cli.runtime.provider.notFound', { providerId });
    deps.exit(1);
  }
  if (providerHasApiKeySource(provider)) {
    writeProviderErr(deps, 'cli.runtime.provider.oauthApiKeyCannotPromoteOAuth', { providerId });
    deps.exit(1);
  }

  const refs = providerOAuthRefs(provider);
  if (index < 1 || index > refs.length) {
    writeProviderErr(deps, 'cli.runtime.provider.oauthRefNotFound', {
      index: String(index),
      providerId,
    });
    deps.exit(1);
  }
  if (index === 1) {
    writeProviderOut(deps, 'cli.runtime.provider.oauthRefAlreadyPrimary', { providerId });
    return;
  }

  await harness.setConfig({
    providers: {
      ...config.providers,
      [providerId]: rewriteProviderOAuthRefs(provider, promoteSlot(refs, index - 1)),
    },
  });
  writeProviderOut(deps, 'cli.runtime.provider.oauthRefPromoted', {
    index: String(index),
    providerId,
  });
}

export async function handleProviderOAuthLabel(
  deps: ProviderDeps,
  providerId: string,
  indexText: string,
  labelText: string,
): Promise<void> {
  const index = parseOAuthIndex(indexText, deps);
  const label = parseCredentialLabel(labelText, deps);
  const harness = deps.getHarness();
  await harness.ensureConfigFile();
  const config = await harness.getConfig();
  const provider = config.providers[providerId];
  if (provider === undefined) {
    writeProviderErr(deps, 'cli.runtime.provider.notFound', { providerId });
    deps.exit(1);
  }
  if (providerHasApiKeySource(provider)) {
    writeProviderErr(deps, 'cli.runtime.provider.oauthApiKeyCannotLabelOAuth', { providerId });
    deps.exit(1);
  }

  const refs = providerOAuthRefs(provider);
  if (index < 1 || index > refs.length) {
    writeProviderErr(deps, 'cli.runtime.provider.oauthRefNotFound', {
      index: String(index),
      providerId,
    });
    deps.exit(1);
  }
  const duplicate = refs.find(
    (ref, refIndex) =>
      refIndex !== index - 1 && ref.label?.toLowerCase() === label.toLowerCase(),
  );
  if (duplicate !== undefined) {
    writeProviderErr(deps, 'cli.runtime.provider.oauthLabelDuplicate', { label });
    deps.exit(1);
  }

  const nextRefs = refs.map((ref, refIndex) =>
    refIndex === index - 1 ? { ...ref, label } : ref,
  );
  await harness.setConfig({
    providers: {
      ...config.providers,
      [providerId]: rewriteProviderOAuthRefs(provider, nextRefs),
    },
  });
  writeProviderOut(deps, 'cli.runtime.provider.oauthRefLabeled', {
    index: String(index),
    providerId,
    label,
  });
}

export async function handleProviderOAuthUnlabel(
  deps: ProviderDeps,
  providerId: string,
  indexText: string,
): Promise<void> {
  const index = parseOAuthIndex(indexText, deps);
  const harness = deps.getHarness();
  await harness.ensureConfigFile();
  const config = await harness.getConfig();
  const provider = config.providers[providerId];
  if (provider === undefined) {
    writeProviderErr(deps, 'cli.runtime.provider.notFound', { providerId });
    deps.exit(1);
  }
  if (providerHasApiKeySource(provider)) {
    writeProviderErr(deps, 'cli.runtime.provider.oauthApiKeyCannotUnlabelOAuth', { providerId });
    deps.exit(1);
  }

  const refs = providerOAuthRefs(provider);
  if (index < 1 || index > refs.length) {
    writeProviderErr(deps, 'cli.runtime.provider.oauthRefNotFound', {
      index: String(index),
      providerId,
    });
    deps.exit(1);
  }
  if (refs[index - 1]?.label === undefined) {
    writeProviderOut(deps, 'cli.runtime.provider.oauthRefNoLabel', {
      index: String(index),
      providerId,
    });
    return;
  }

  const nextRefs = refs.map((ref, refIndex) =>
    refIndex === index - 1 ? { ...ref, label: undefined } : ref,
  );
  await harness.setConfig({
    providers: {
      ...config.providers,
      [providerId]: rewriteProviderOAuthRefs(provider, nextRefs),
    },
  });
  writeProviderOut(deps, 'cli.runtime.provider.oauthRefLabelRemoved', {
    index: String(index),
    providerId,
  });
}

export async function handleProviderOAuthClear(
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

  await harness.setConfig({
    providers: {
      ...config.providers,
      [providerId]: rewriteProviderOAuthRefs(provider, []),
    },
  });
  writeProviderOut(deps, 'cli.runtime.provider.allOAuthRefsRemoved', { providerId });
}
