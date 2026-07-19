/**
 * `liora provider` sub-command — non-interactive provider management.
 *
 * Covers the custom-registry path so users can import an api.json document,
 * drop a provider, or inspect what is configured without launching the TUI.
 *
 * `add` writes the same `source = { kind: 'apiJson', url, apiKey }` blob the
 * TUI does; the next launch's `refreshAllProviderModels`
 * (apps/liora/src/tui/utils/refresh-providers.ts) groups by URL, retries
 * available API-key candidates, and re-fetches the model list, so periodic
 * refresh is automatic.
 */

import {
  applyCustomRegistryProvider,
  CustomRegistryApiError,
  fetchCustomRegistry,
  fingerprintProviderOAuthRef,
  isValidProviderOAuthCredentialLabel,
  listProviderOAuthRefs,
  promoteProviderOAuthSlot,
  rewriteProviderOAuthRefs as rewriteProviderOAuthRefsShared,
  type CustomRegistrySource,
  type ManagedKimiConfigShape,
  type ProviderOAuthRef,
} from '@superliora/oauth';
import {
  applyCatalogProvider,
  catalogBaseUrl,
  catalogProviderModels,
  CatalogFetchError,
  createLioraHarness,
  DEFAULT_CATALOG_URL,
  fetchCatalog,
  inferWireType,
  type Catalog,
  type CatalogProviderEntry,
  type LioraConfig,
  type LioraHarness,
  type ProviderRouteStatus,
} from '@superliora/sdk';
import type { Command } from 'commander';
import { t, tln } from '#/cli/i18n';

import { createLioraHostIdentity } from '#/cli/version';
import {
  applyCustomEndpointProvider,
  DEFAULT_CUSTOM_ENDPOINT_CONTEXT_SIZE,
} from '#/utils/custom-provider';
import { mergeLocalCatalogProviders } from '#/utils/local-catalog-providers';

interface WritableLike {
  write(chunk: string): boolean;
}

function writeProviderErr(deps: ProviderDeps, key: string, params?: Record<string, string | number>): void {
  deps.stderr.write(tln(key, params));
}
function writeProviderOut(deps: ProviderDeps, key: string, params?: Record<string, string | number>): void {
  deps.stdout.write(tln(key, params));
}

function providerUnit(count: number): string {
  return t(count === 1 ? 'cli.runtime.provider.unit.provider' : 'cli.runtime.provider.unit.providers');
}
function modelUnit(count: number): string {
  return t(count === 1 ? 'cli.runtime.provider.unit.model' : 'cli.runtime.provider.unit.models');
}
function apiKeyWord(count: number): string {
  return t(count === 1 ? 'cli.runtime.provider.unit.apiKeyWord' : 'cli.runtime.provider.unit.apiKeysWord');
}
function oauthRefWord(count: number): string {
  return t(count === 1 ? 'cli.runtime.provider.unit.oauthRef' : 'cli.runtime.provider.unit.oauthRefs');
}
function aliasWord(count: number): string {
  return t(count === 1 ? 'cli.runtime.provider.unit.alias' : 'cli.runtime.provider.unit.aliases');
}
function doctorErrorWord(count: number): string {
  return t(count === 1 ? 'cli.runtime.provider.unit.error' : 'cli.runtime.provider.unit.errors');
}
function doctorWarningWord(count: number): string {
  return t(count === 1 ? 'cli.runtime.provider.unit.warning' : 'cli.runtime.provider.unit.warnings');
}
function routeRole(index: number): string {
  return t(index === 0 ? 'cli.runtime.provider.rolePrimary' : 'cli.runtime.provider.roleFallback');
}

export interface ProviderDeps {
  readonly getHarness: () => LioraHarness;
  readonly stdout: WritableLike;
  readonly stderr: WritableLike;
  readonly env: NodeJS.ProcessEnv;
  readonly exit: (code: number) => never;
}

interface AddOptions {
  readonly apiKey?: string;
}

interface ListOptions {
  readonly json: boolean;
}

interface DoctorOptions {
  readonly json: boolean;
}

interface CatalogListOptions {
  readonly json: boolean;
  readonly filter?: string;
  readonly url?: string;
}

interface CatalogAddOptions {
  readonly apiKey?: string;
  readonly apiKeyEnv?: string;
  readonly defaultModel?: string;
  readonly url?: string;
}

interface CustomAddOptions {
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly apiKeyEnv?: string;
  readonly keyless?: boolean;
  readonly model?: string;
  readonly alias?: string;
  readonly type?: string;
  readonly context?: string;
  readonly output?: string;
  readonly displayName?: string;
  readonly thinking?: boolean;
  readonly setDefault?: boolean;
}

interface KeyAddOptions {
  readonly apiKey?: string;
  readonly apiKeys?: string;
  readonly apiKeyEnv?: string;
  readonly apiKeyEnvs?: string;
  readonly baseUrl?: string;
  readonly label?: string;
  readonly labels?: string;
  readonly rpm?: string;
  readonly tpm?: string;
  readonly autoRoute?: boolean;
}

interface OAuthAddOptions {
  readonly key?: string;
  readonly storage?: string;
  readonly oauthHost?: string;
  readonly label?: string;
  readonly autoRoute?: boolean;
}

interface KeyLimitOptions {
  readonly rpm?: string;
  readonly tpm?: string;
  readonly clear?: boolean;
}

interface RouteSetOptions {
  readonly fallback?: string;
  readonly strategy?: string;
  readonly cooldownMs?: string;
  readonly weights?: string;
  readonly sessionAffinity?: string;
  readonly preferredCredential?: string;
}

interface RouteAutoOptions {
  readonly fallback?: string;
  readonly cooldownMs?: string;
  readonly sessionAffinity?: string;
  readonly preferredCredential?: string;
}

interface RouteStatusOptions {
  readonly json: boolean;
}

interface RoutePreviewOptions {
  readonly json: boolean;
}

interface RoutePreview {
  readonly modelAlias: string;
  readonly strategy:
    | 'auto'
    | 'fallback'
    | 'fill_first'
    | 'round_robin'
    | 'weighted_round_robin'
    | 'least_used'
    | 'lowest_latency'
    | 'rate_limit_aware'
    | 'random';
  readonly active: boolean;
  readonly fallbackModels: readonly string[];
  readonly sessionAffinity?: boolean;
  readonly preferredCredential?: string;
  readonly candidates: readonly RoutePreviewCandidate[];
}

interface RoutePreviewCandidate {
  readonly modelAlias: string;
  readonly providerName: string;
  readonly providerType: LioraConfig['providers'][string]['type'];
  readonly providerModel: string;
  readonly weight?: number;
  readonly credentialLabel?: string;
  readonly credentialSource: string;
  readonly auth: 'api_key' | 'oauth' | 'keyless' | 'none' | 'vertexai_service_account';
  readonly baseUrl?: string;
  readonly rpm?: number;
  readonly tpm?: number;
  readonly preferred?: boolean;
}

interface ProviderAutoRouteResult {
  readonly aliases: readonly string[];
  readonly models?: LioraConfig['models'];
}

interface ProviderCredentialPreview {
  readonly credentialLabel?: string;
  readonly credentialSource: string;
  readonly auth: RoutePreviewCandidate['auth'];
  readonly baseUrl?: string;
  readonly rpm?: number;
  readonly tpm?: number;
}

interface OAuthCredentialPreview {
  readonly ref: ConfigOAuthRef;
  readonly source: string;
}

type ConfigOAuthRef = NonNullable<LioraConfig['providers'][string]['oauth']>;
type ConfigProviderCredential = NonNullable<
  LioraConfig['providers'][string]['credentials']
>[number];

interface ProviderApiKeySlot {
  readonly apiKey: string;
  readonly credentialSource?: string;
  readonly baseUrl?: string;
  readonly label?: string;
  readonly rpm?: number;
  readonly tpm?: number;
}

interface ProviderDoctorReport {
  readonly ok: boolean;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly providerCount: number;
  readonly modelCount: number;
  readonly routeCount: number;
  readonly candidateCount: number;
  readonly issues: readonly ProviderDoctorIssue[];
}

interface ProviderDoctorIssue {
  readonly level: 'error' | 'warning';
  readonly code: string;
  readonly message: string;
  readonly providerId?: string;
  readonly modelAlias?: string;
  readonly envVar?: string;
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

  // `harness.removeProvider` reloads the config from disk on each call (see
  // `core-impl.ts removeKimiProvider`), so calling it inside the apply loop
  // would discard providers we already applied in memory but have not yet
  // persisted. Drop every stale id up front in a single batch instead, then
  // apply against the resulting fresh config.
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

export async function handleProviderRemove(
  deps: ProviderDeps,
  providerId: string,
): Promise<void> {
  const harness = deps.getHarness();
  await harness.ensureConfigFile();
  const config = await harness.getConfig();
  if (config.providers[providerId] === undefined) {
    writeProviderErr(deps, 'cli.runtime.provider.notFound', { providerId });
    deps.exit(1);
  }
  await harness.removeProvider(providerId);
  writeProviderOut(deps, 'cli.runtime.provider.removed', { providerId });
}

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

export async function handleProviderDoctor(
  deps: ProviderDeps,
  opts: DoctorOptions,
): Promise<void> {
  const harness = deps.getHarness();
  await harness.ensureConfigFile();
  const config = await harness.getConfig();
  const report = buildProviderDoctorReport(config, deps.env);

  if (opts.json) {
    deps.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    deps.stdout.write(formatProviderDoctorReport(report));
  }

  if (report.errorCount > 0) {
    deps.exit(1);
  }
}

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

export async function handleProviderRouteShow(
  deps: ProviderDeps,
  modelAlias: string,
): Promise<void> {
  const harness = deps.getHarness();
  await harness.ensureConfigFile();
  const config = await harness.getConfig();
  const model = config.models?.[modelAlias];
  if (model === undefined) {
    writeProviderErr(deps, 'cli.runtime.provider.modelNotFound', { modelAlias });
    deps.exit(1);
  }

  writeProviderOut(deps, 'cli.runtime.provider.routeShowHeader', { modelAlias });
  writeProviderOut(deps, 'cli.runtime.provider.routeShowProvider', { provider: model.provider });
  writeProviderOut(deps, 'cli.runtime.provider.routeShowModel', { model: model.model });
  writeProviderOut(deps, 'cli.runtime.provider.routeShowFallbackModels', {
    fallbacks: (model.fallbackModels ?? []).join(', ') || t('cli.runtime.provider.valueNone'),
  });
  writeProviderOut(deps, 'cli.runtime.provider.routeShowStrategy', {
    strategy: model.routing?.strategy ?? t('cli.runtime.provider.valueAuto'),
  });
  writeProviderOut(deps, 'cli.runtime.provider.routeShowWeights', {
    weights: formatRouteWeights(model.routing?.weights),
  });
  writeProviderOut(deps, 'cli.runtime.provider.routeShowSessionAffinity', {
    value:
      model.routing?.sessionAffinity === true
        ? t('cli.runtime.provider.valueOn')
        : t('cli.runtime.provider.valueOff'),
  });
  writeProviderOut(deps, 'cli.runtime.provider.routeShowPreferredCredential', {
    value: model.routing?.preferredCredential ?? t('cli.runtime.provider.valueNone'),
  });
  writeProviderOut(deps, 'cli.runtime.provider.routeShowCooldownMs', {
    value:
      model.routing?.cooldownMs === undefined
        ? t('cli.runtime.provider.valueDefault')
        : String(model.routing.cooldownMs),
  });
}

export async function handleProviderRoutePreview(
  deps: ProviderDeps,
  modelAlias: string,
  opts: RoutePreviewOptions,
): Promise<void> {
  const harness = deps.getHarness();
  await harness.ensureConfigFile();
  const config = await harness.getConfig();
  let preview: RoutePreview;
  try {
    preview = buildRoutePreview(config, modelAlias);
  } catch (error) {
    deps.stderr.write(`${errorMessage(error)}\n`);
    deps.exit(1);
  }

  if (opts.json) {
    deps.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);
    return;
  }
  deps.stdout.write(formatRoutePreview(preview));
}

export async function handleProviderRouteSet(
  deps: ProviderDeps,
  modelAlias: string,
  opts: RouteSetOptions,
): Promise<void> {
  if (
    opts.fallback === undefined &&
    opts.strategy === undefined &&
    opts.cooldownMs === undefined &&
    opts.weights === undefined &&
    opts.sessionAffinity === undefined &&
    opts.preferredCredential === undefined
  ) {
    writeProviderErr(deps, 'cli.runtime.provider.routeSetNothingToUpdate');
    deps.exit(1);
  }

  const harness = deps.getHarness();
  await harness.ensureConfigFile();
  const config = await harness.getConfig();
  const models = config.models ?? {};
  const model = models[modelAlias];
  if (model === undefined) {
    writeProviderErr(deps, 'cli.runtime.provider.modelNotFound', { modelAlias });
    deps.exit(1);
  }

  const fallbackModels =
    opts.fallback === undefined ? model.fallbackModels : parseFallbackModels(opts.fallback);
  const missingFallback = fallbackModels?.find((alias) => models[alias] === undefined);
  if (missingFallback !== undefined) {
    writeProviderErr(deps, 'cli.runtime.provider.fallbackModelNotConfigured', { fallback: missingFallback });
    deps.exit(1);
  }
  if (fallbackModels?.includes(modelAlias) === true) {
    writeProviderErr(deps, 'cli.runtime.provider.selfFallback');
    deps.exit(1);
  }

  const strategy =
    opts.strategy === undefined
      ? model.routing?.strategy
      : parseRoutingStrategy(opts.strategy, deps);
  const cooldownMs =
    opts.cooldownMs === undefined
      ? model.routing?.cooldownMs
      : parseCooldownMs(opts.cooldownMs, deps);
  const weights =
    opts.weights === undefined ? model.routing?.weights : parseRouteWeights(opts.weights, deps);
  const sessionAffinity =
    opts.sessionAffinity === undefined
      ? model.routing?.sessionAffinity
      : parseSessionAffinity(opts.sessionAffinity, deps);
  const preferredCredential =
    opts.preferredCredential === undefined
      ? model.routing?.preferredCredential
      : parsePreferredCredential(opts.preferredCredential);
  validateRouteWeights(weights, uniqueStrings([modelAlias, ...(fallbackModels ?? [])]), deps);
  validatePreferredCredential(
    preferredCredential,
    routeCandidateCredentialLabels(config, modelAlias, fallbackModels ?? []),
    deps,
  );
  const routing =
    strategy === undefined &&
    cooldownMs === undefined &&
    weights === undefined &&
    sessionAffinity !== true &&
    preferredCredential === undefined
      ? undefined
      : {
          strategy,
          cooldownMs,
          weights,
          sessionAffinity: sessionAffinity === true ? true : undefined,
          preferredCredential,
        };

  const nextModel: ConfigModelAlias = {
    ...model,
    fallbackModels,
    routing,
  };

  await harness.setConfig({
    models: {
      ...models,
      [modelAlias]: nextModel,
    },
  });
  writeProviderOut(deps, 'cli.runtime.provider.routeUpdated', { modelAlias });
}

export async function handleProviderRouteAuto(
  deps: ProviderDeps,
  modelAlias: string,
  opts: RouteAutoOptions,
): Promise<void> {
  const harness = deps.getHarness();
  await harness.ensureConfigFile();
  const config = await harness.getConfig();
  const models = config.models ?? {};
  const model = models[modelAlias];
  if (model === undefined) {
    writeProviderErr(deps, 'cli.runtime.provider.modelNotFound', { modelAlias });
    deps.exit(1);
  }

  const fallbackModels =
    opts.fallback === undefined ? model.fallbackModels : parseFallbackModels(opts.fallback);
  const missingFallback = fallbackModels?.find((alias) => models[alias] === undefined);
  if (missingFallback !== undefined) {
    writeProviderErr(deps, 'cli.runtime.provider.fallbackModelNotConfigured', { fallback: missingFallback });
    deps.exit(1);
  }
  if (fallbackModels?.includes(modelAlias) === true) {
    writeProviderErr(deps, 'cli.runtime.provider.selfFallback');
    deps.exit(1);
  }

  const routeAliases = uniqueStrings([modelAlias, ...(fallbackModels ?? [])]);
  const cooldownMs =
    opts.cooldownMs === undefined
      ? model.routing?.cooldownMs
      : parseCooldownMs(opts.cooldownMs, deps);
  const sessionAffinity =
    opts.sessionAffinity === undefined ? true : parseSessionAffinity(opts.sessionAffinity, deps);
  const preferredCredential =
    opts.preferredCredential === undefined
      ? model.routing?.preferredCredential
      : parsePreferredCredential(opts.preferredCredential);
  const weights = model.routing?.weights;

  validateRouteWeights(weights, routeAliases, deps);
  validatePreferredCredential(
    preferredCredential,
    routeCandidateCredentialLabels(config, modelAlias, fallbackModels ?? []),
    deps,
  );

  const nextModel: ConfigModelAlias = {
    ...model,
    fallbackModels,
    routing: {
      strategy: 'auto',
      cooldownMs,
      weights,
      sessionAffinity: sessionAffinity === true ? true : undefined,
      preferredCredential,
    },
  };
  const nextConfig: LioraConfig = {
    ...config,
    models: {
      ...models,
      [modelAlias]: nextModel,
    },
  };
  const preview = buildRoutePreview(nextConfig, modelAlias);
  if (preview.candidates.length < 2) {
    writeProviderErr(deps, 'cli.runtime.provider.autoRouteNeedsCandidates', { modelAlias });
    deps.exit(1);
  }

  await harness.setConfig({ models: nextConfig.models });
  writeProviderOut(deps, 'cli.runtime.provider.autoRouteEnabled', {
    modelAlias,
    count: String(preview.candidates.length),
  });
  deps.stdout.write(formatRoutePreview(preview));
}

export async function handleProviderRouteReset(
  deps: ProviderDeps,
  sessionId: string,
): Promise<void> {
  const harness = deps.getHarness();
  const session = await harness.resumeSession({ id: sessionId });
  const status = await session.resetProviderRouteStatus();
  if (status === null) {
    writeProviderOut(deps, 'cli.runtime.provider.routeResetNone', { sessionId });
    return;
  }
  writeProviderOut(deps, 'cli.runtime.provider.routeResetDone', {
    modelAlias: status.modelAlias,
    sessionId,
    count: String(status.candidates.length),
  });
}

export async function handleProviderRouteStatus(
  deps: ProviderDeps,
  sessionId: string,
  opts: RouteStatusOptions,
): Promise<void> {
  const harness = deps.getHarness();
  const session = await harness.resumeSession({ id: sessionId });
  const routeStatus = (await session.getStatus()).providerRouteStatus ?? null;
  if (opts.json) {
    deps.stdout.write(`${JSON.stringify(routeStatus, null, 2)}\n`);
    return;
  }
  if (routeStatus === null) {
    writeProviderOut(deps, 'cli.runtime.provider.routeStatusNone', { sessionId });
    return;
  }
  deps.stdout.write(formatProviderRouteStatus(routeStatus, Date.now()));
}

type ConfigModelAlias = NonNullable<LioraConfig['models']>[string];

function formatProviderRouteStatus(status: ProviderRouteStatus, now: number): string {
  const affinityText = status.sessionAffinity === true ? t('cli.runtime.provider.routeHealthAffinityOn') : '';
  const preferredText =
    status.preferredCredential === undefined
      ? ''
      : t('cli.runtime.provider.routeHealthPreferred', { credential: status.preferredCredential });
  const lines = [
    t('cli.runtime.provider.routeHealthHeader', {
      modelAlias: status.modelAlias,
      strategy: status.strategy,
      affinityText,
      preferredText,
    }),
    ...status.candidates.map((candidate, index) =>
      formatProviderRouteCandidate(candidate, index, now),
    ),
  ];
  return `${lines.join('\n')}\n`;
}

function formatProviderRouteCandidate(
  candidate: ProviderRouteStatus['candidates'][number],
  index: number,
  now: number,
): string {
  const cooling = candidate.cooldownUntil !== undefined && candidate.cooldownUntil > now;
  const state = cooling
    ? t('cli.runtime.provider.routeHealthCooling', {
        duration: formatDuration(candidate.cooldownUntil! - now),
      })
    : t('cli.runtime.provider.routeHealthReady');
  const parts = [
    `  #${String(index + 1)}`,
    state,
    `alias=${candidate.modelAlias}`,
    `provider=${candidate.providerName}`,
    `model=${candidate.providerModel}`,
  ];
  if (candidate.credentialLabel !== undefined) {
    parts.push(`credential=${candidate.credentialLabel}`);
  }
  if (candidate.baseUrl !== undefined) {
    parts.push(`base_url=${candidate.baseUrl}`);
  }
  if (candidate.preferred === true) {
    parts.push('preferred');
  }
  if (candidate.pinned === true) {
    parts.push('pinned');
  }
  if (candidate.weight !== undefined) {
    parts.push(`weight=${String(candidate.weight)}`);
  }
  if (candidate.avgLatencyMs !== undefined) {
    parts.push(`latency=${String(candidate.avgLatencyMs)}ms`);
  }
  if (candidate.lastLatencyMs !== undefined) {
    parts.push(`last_latency=${String(candidate.lastLatencyMs)}ms`);
  }
  if (candidate.rateLimitHeadroom !== undefined) {
    parts.push(`headroom=${formatPercent(candidate.rateLimitHeadroom)}`);
  }
  if (cooling && candidate.cooldownKind !== undefined) {
    parts.push(`cooldown=${candidate.cooldownKind}`);
  }
  if (candidate.rateLimits !== undefined && candidate.rateLimits.length > 0) {
    parts.push(`limits=${formatProviderRouteRateLimits(candidate.rateLimits, now)}`);
  }
  parts.push(`ok=${String(candidate.successCount ?? 0)}`);
  parts.push(`fail=${String(candidate.failureCount ?? 0)}`);
  if (candidate.lastFailureKind !== undefined) {
    parts.push(`last_failure=${candidate.lastFailureKind}`);
  }
  if (candidate.lastFailureAt !== undefined) {
    parts.push(`last_failure_at=${new Date(candidate.lastFailureAt).toISOString()}`);
  }
  if (candidate.lastSuccessAt !== undefined) {
    parts.push(`last_success_at=${new Date(candidate.lastSuccessAt).toISOString()}`);
  }
  return parts.join('  ');
}

function formatProviderRouteRateLimits(
  rateLimits: NonNullable<ProviderRouteStatus['candidates'][number]['rateLimits']>,
  now: number,
): string {
  return rateLimits
    .map((rateLimit) => {
      const quota =
        rateLimit.remaining === undefined && rateLimit.limit === undefined
          ? rateLimit.name
          : `${rateLimit.name}:${String(rateLimit.remaining ?? '?')}/${String(rateLimit.limit ?? '?')}`;
      return rateLimit.resetAt === undefined
        ? quota
        : `${quota}@${formatDuration(rateLimit.resetAt - now)}`;
    })
    .join(',');
}

function buildProviderDoctorReport(
  config: LioraConfig,
  env: NodeJS.ProcessEnv,
): ProviderDoctorReport {
  const issues: ProviderDoctorIssue[] = [];
  const providers = config.providers;
  const models = config.models ?? {};
  let routeCount = 0;
  let candidateCount = 0;

  if (Object.keys(providers).length === 0) {
    addDoctorIssue(issues, {
      level: 'warning',
      code: 'no_providers',
      message: t('cli.runtime.provider.doctor.noProviders'),
    });
  }
  if (Object.keys(models).length === 0) {
    addDoctorIssue(issues, {
      level: 'warning',
      code: 'no_models',
      message: t('cli.runtime.provider.doctor.noModels'),
    });
  }
  if (config.defaultModel !== undefined && models[config.defaultModel] === undefined) {
    addDoctorIssue(issues, {
      level: 'error',
      code: 'missing_default_model',
      message: t('cli.runtime.provider.doctor.missingDefaultModel', { alias: config.defaultModel }),
      modelAlias: config.defaultModel,
    });
  }

  for (const providerId of Object.keys(providers).toSorted()) {
    const provider = providers[providerId]!;
    collectProviderDoctorIssues(issues, providerId, provider, env);
  }

  for (const modelAlias of Object.keys(models).toSorted()) {
    const model = models[modelAlias]!;
    collectModelDoctorIssues(issues, modelAlias, model, config);
    try {
      const preview = buildRoutePreview(config, modelAlias);
      if (preview.active) {
        routeCount += 1;
        candidateCount += preview.candidates.length;
      }
    } catch (error) {
      addDoctorIssue(issues, {
        level: 'error',
        code: 'invalid_route',
        message: errorMessage(error),
        modelAlias,
      });
    }
  }

  const errorCount = issues.filter((issue) => issue.level === 'error').length;
  const warningCount = issues.length - errorCount;
  return {
    ok: errorCount === 0,
    errorCount,
    warningCount,
    providerCount: Object.keys(providers).length,
    modelCount: Object.keys(models).length,
    routeCount,
    candidateCount,
    issues,
  };
}

function collectProviderDoctorIssues(
  issues: ProviderDoctorIssue[],
  providerId: string,
  provider: LioraConfig['providers'][string],
  env: NodeJS.ProcessEnv,
): void {
  const hasApiKey = providerHasApiKeySource(provider);
  const hasOAuth = providerHasOAuth(provider);
  const hasServiceAccount = hasVertexAIServiceAccountSource(provider);
  const hasAuth =
    hasApiKey ||
    hasOAuth ||
    hasServiceAccount ||
    providerCredentialSources(provider).some((source) => source.auth === 'keyless');

  if (!hasAuth) {
    addDoctorIssue(issues, {
      level: 'error',
      code: 'missing_auth',
      message: t('cli.runtime.provider.doctor.missingAuth'),
      providerId,
    });
  }

  if (hasApiKey && hasOAuth) {
    addDoctorIssue(issues, {
      level: 'warning',
      code: 'mixed_auth',
      message: t('cli.runtime.provider.doctor.mixedAuth'),
      providerId,
    });
  }

  for (const ref of providerEnvReferences(provider)) {
    if (nonEmptyString(env[ref.envVar]) === undefined) {
      addDoctorIssue(issues, {
        level: 'error',
        code: 'missing_env',
        message: t('cli.runtime.provider.doctor.missingEnv', {
          envVar: ref.envVar,
          source: ref.source,
        }),
        providerId,
        envVar: ref.envVar,
      });
    }
  }

  collectProviderCredentialDoctorIssues(issues, providerId, provider);
  collectProviderOAuthDoctorIssues(issues, providerId, provider);
}

function collectProviderCredentialDoctorIssues(
  issues: ProviderDoctorIssue[],
  providerId: string,
  provider: LioraConfig['providers'][string],
): void {
  const seen = new Set<string>();
  for (let index = 0; index < (provider.credentials ?? []).length; index += 1) {
    const credential = provider.credentials?.[index];
    if (credential === undefined) continue;
    const source = `credentials[${String(index + 1)}]`;
    const apiKey = nonEmptyString(credential.apiKey);
    if (apiKey === undefined) {
      addDoctorIssue(issues, {
        level: 'error',
        code: 'empty_credential_api_key',
        message: t('cli.runtime.provider.doctor.emptyCredentialApiKey', { source }),
        providerId,
      });
      continue;
    }
    const label = nonEmptyString(credential.label);
    if (label !== undefined && !isValidCredentialLabel(label)) {
      addDoctorIssue(issues, {
        level: 'error',
        code: 'invalid_credential_label',
        message: t('cli.runtime.provider.doctor.invalidCredentialLabel', { source }),
        providerId,
      });
    }
    const baseUrl = nonEmptyString(credential.baseUrl);
    if (baseUrl !== undefined && parseEnvReference(baseUrl) === undefined && !isHttpUrl(baseUrl)) {
      addDoctorIssue(issues, {
        level: 'error',
        code: 'invalid_credential_base_url',
        message: t('cli.runtime.provider.doctor.invalidCredentialBaseUrl', { source }),
        providerId,
      });
    }
    const key = `${apiKey}\n${baseUrl ?? ''}`;
    if (seen.has(key)) {
      addDoctorIssue(issues, {
        level: 'warning',
        code: 'duplicate_credential',
        message: t('cli.runtime.provider.doctor.duplicateCredential', { source }),
        providerId,
      });
    }
    seen.add(key);
  }
  const seenLabels = new Set<string>();
  for (let index = 0; index < (provider.credentials ?? []).length; index += 1) {
    const label = nonEmptyString(provider.credentials?.[index]?.label);
    if (label === undefined) continue;
    const normalized = label.toLowerCase();
    if (seenLabels.has(normalized)) {
      addDoctorIssue(issues, {
        level: 'error',
        code: 'duplicate_credential_label',
        message: t('cli.runtime.provider.doctor.duplicateCredentialLabel', {
          index: String(index + 1),
        }),
        providerId,
      });
    }
    seenLabels.add(normalized);
  }
}

function collectProviderOAuthDoctorIssues(
  issues: ProviderDoctorIssue[],
  providerId: string,
  provider: LioraConfig['providers'][string],
): void {
  const refs = providerOAuthRefs(provider);
  const seenLabels = new Set<string>();
  for (let index = 0; index < refs.length; index += 1) {
    const label = nonEmptyString(refs[index]?.label);
    if (label === undefined) continue;
    if (!isValidCredentialLabel(label)) {
      addDoctorIssue(issues, {
        level: 'error',
        code: 'invalid_oauth_label',
        message: t('cli.runtime.provider.doctor.invalidOAuthLabel', { index: String(index + 1) }),
        providerId,
      });
    }
    const normalized = label.toLowerCase();
    if (seenLabels.has(normalized)) {
      addDoctorIssue(issues, {
        level: 'error',
        code: 'duplicate_oauth_label',
        message: t('cli.runtime.provider.doctor.duplicateOAuthLabel', { index: String(index + 1) }),
        providerId,
      });
    }
    seenLabels.add(normalized);
  }
}

function collectModelDoctorIssues(
  issues: ProviderDoctorIssue[],
  modelAlias: string,
  model: ConfigModelAlias,
  config: LioraConfig,
): void {
  const providerName = model.provider ?? config.defaultProvider;
  if (providerName === undefined) {
    addDoctorIssue(issues, {
      level: 'error',
      code: 'missing_model_provider',
      message: t('cli.runtime.provider.doctor.missingModelProvider'),
      modelAlias,
    });
  } else if (config.providers[providerName] === undefined) {
    addDoctorIssue(issues, {
      level: 'error',
      code: 'missing_model_provider',
      message: t('cli.runtime.provider.doctor.missingModelProviderName', { providerName }),
      modelAlias,
    });
  }

  for (const fallbackAlias of model.fallbackModels ?? []) {
    if (fallbackAlias === modelAlias) {
      addDoctorIssue(issues, {
        level: 'error',
        code: 'self_fallback_model',
        message: t('cli.runtime.provider.doctor.selfFallback'),
        modelAlias,
      });
    } else if (config.models?.[fallbackAlias] === undefined) {
      addDoctorIssue(issues, {
        level: 'error',
        code: 'missing_fallback_model',
        message: t('cli.runtime.provider.doctor.missingFallbackModel', { fallback: fallbackAlias }),
        modelAlias,
      });
    }
  }

  const routeAliases = new Set([modelAlias, ...(model.fallbackModels ?? [])]);
  for (const weightAlias of Object.keys(model.routing?.weights ?? {})) {
    if (!routeAliases.has(weightAlias)) {
      addDoctorIssue(issues, {
        level: 'warning',
        code: 'unused_route_weight',
        message: t('cli.runtime.provider.doctor.unusedRouteWeight', { weightAlias }),
        modelAlias,
      });
    }
  }

  const preferredCredential = model.routing?.preferredCredential;
  if (preferredCredential !== undefined) {
    let labels: string[];
    try {
      labels = routeCandidateCredentialLabels(config, modelAlias, model.fallbackModels ?? []);
    } catch {
      return;
    }
    if (!labels.includes(preferredCredential)) {
      addDoctorIssue(issues, {
        level: 'error',
        code: 'invalid_preferred_credential',
        message: t('cli.runtime.provider.doctor.invalidPreferredCredential', {
          credential: preferredCredential,
        }),
        modelAlias,
      });
    }
  }
}

function addDoctorIssue(
  issues: ProviderDoctorIssue[],
  issue: ProviderDoctorIssue,
): void {
  issues.push(issue);
}

function providerEnvReferences(
  provider: LioraConfig['providers'][string],
): { readonly source: string; readonly envVar: string }[] {
  const refs: { source: string; envVar: string }[] = [];
  const append = (source: string, value: string | undefined): void => {
    const normalized = nonEmptyString(value);
    if (normalized === undefined) return;
    const envVar = parseEnvReference(normalized);
    if (envVar !== undefined) refs.push({ source, envVar });
  };
  append('api_key', provider.apiKey);
  for (let index = 0; index < (provider.apiKeys ?? []).length; index += 1) {
    append(`api_keys[${String(index + 1)}]`, provider.apiKeys?.[index]);
  }
  for (let index = 0; index < (provider.credentials ?? []).length; index += 1) {
    const credential = provider.credentials?.[index];
    append(`credentials[${String(index + 1)}].api_key`, credential?.apiKey);
    append(`credentials[${String(index + 1)}].base_url`, credential?.baseUrl);
  }
  for (const [key, value] of Object.entries(provider.env ?? {})) {
    append(`env.${key}`, value);
  }
  return refs;
}

function formatProviderDoctorReport(report: ProviderDoctorReport): string {
  const lines =
    report.issues.length === 0
      ? [
          t('cli.runtime.provider.doctor.ok', {
            providerCount: String(report.providerCount),
            modelCount: String(report.modelCount),
            routeCount: String(report.routeCount),
            candidateCount: String(report.candidateCount),
          }),
        ]
      : [
          t('cli.runtime.provider.doctor.summary', {
            errorCount: String(report.errorCount),
            errorWord: doctorErrorWord(report.errorCount),
            warningCount: String(report.warningCount),
            warningWord: doctorWarningWord(report.warningCount),
          }),
          ...report.issues.map(formatProviderDoctorIssue),
        ];
  return `${lines.join('\n')}\n`;
}

function formatProviderDoctorIssue(issue: ProviderDoctorIssue): string {
  const scope = [
    issue.providerId === undefined
      ? undefined
      : t('cli.runtime.provider.doctor.scopeProvider', { providerId: issue.providerId }),
    issue.modelAlias === undefined
      ? undefined
      : t('cli.runtime.provider.doctor.scopeModel', { modelAlias: issue.modelAlias }),
    issue.envVar === undefined
      ? undefined
      : t('cli.runtime.provider.doctor.scopeEnv', { envVar: issue.envVar }),
  ].filter((part): part is string => part !== undefined);
  const scopeText = scope.length === 0 ? '' : scope.join('');
  return t('cli.runtime.provider.doctor.issueLine', {
    level: issue.level,
    code: issue.code,
    scope: scopeText,
    message: issue.message,
  });
}

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes < 60) return remainder === 0 ? `${String(minutes)}m` : `${String(minutes)}m${String(remainder)}s`;
  const hours = Math.floor(minutes / 60);
  const minuteRemainder = minutes % 60;
  return minuteRemainder === 0
    ? `${String(hours)}h`
    : `${String(hours)}h${String(minuteRemainder)}m`;
}

function buildRoutePreview(config: LioraConfig, modelAlias: string): RoutePreview {
  const models = config.models ?? {};
  const model = models[modelAlias];
  if (model === undefined) {
    throw new Error(t('cli.runtime.provider.modelNotFoundThrow', { modelAlias }));
  }
  const fallbackModels = model.fallbackModels ?? [];
  const candidateAliases = uniqueStrings([modelAlias, ...fallbackModels]);
  const preferredCredential = model.routing?.preferredCredential;
  const candidates = candidateAliases
    .flatMap((alias) =>
      routePreviewCandidatesForAlias(config, alias, model.routing?.weights?.[alias]),
    )
    .map((candidate) => ({
      ...candidate,
      preferred: matchesRoutePreviewPreferred(preferredCredential, candidate) ? true : undefined,
    }));
  const hasLocalLimits = candidates.some(
    (candidate) => candidate.rpm !== undefined || candidate.tpm !== undefined,
  );
  const active =
    fallbackModels.length > 0 ||
    model.routing !== undefined ||
    candidates.length > 1 ||
    hasLocalLimits;
  const strategy = model.routing?.strategy ?? (active ? 'auto' : 'fallback');
  return {
    modelAlias,
    strategy,
    active,
    fallbackModels,
    sessionAffinity: model.routing?.sessionAffinity,
    preferredCredential: model.routing?.preferredCredential,
    candidates,
  };
}

function providerAutoRouteModels(
  config: LioraConfig,
  providerId: string,
): ProviderAutoRouteResult {
  const models = config.models ?? {};
  const nextModels: NonNullable<LioraConfig['models']> = { ...models };
  const aliases: string[] = [];

  for (const [alias, model] of Object.entries(models).toSorted(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (model.provider !== providerId) continue;
    const nextModel: ConfigModelAlias = {
      ...model,
      routing: {
        strategy: 'auto',
        cooldownMs: model.routing?.cooldownMs,
        weights: model.routing?.weights,
        sessionAffinity:
          model.routing?.sessionAffinity === undefined ? true : model.routing.sessionAffinity,
        preferredCredential: model.routing?.preferredCredential,
      },
    };
    const previewConfig: LioraConfig = {
      ...config,
      models: {
        ...nextModels,
        [alias]: nextModel,
      },
    };
    let preview: RoutePreview;
    try {
      preview = buildRoutePreview(previewConfig, alias);
    } catch {
      continue;
    }
    if (preview.candidates.length < 2) continue;
    nextModels[alias] = nextModel;
    aliases.push(alias);
  }

  return aliases.length === 0 ? { aliases } : { aliases, models: nextModels };
}

function writeProviderAutoRouteSummary(
  deps: ProviderDeps,
  providerId: string,
  result: ProviderAutoRouteResult | undefined,
): void {
  if (result === undefined) return;
  if (result.aliases.length === 0) {
    writeProviderOut(deps, 'cli.runtime.provider.autoRouteNoCandidates', { providerId });
    return;
  }
  writeProviderOut(deps, 'cli.runtime.provider.autoRouteEnabledSummary', {
    count: String(result.aliases.length),
    aliasWord: aliasWord(result.aliases.length),
    aliases: result.aliases.join(', '),
  });
}

function routePreviewCandidatesForAlias(
  config: LioraConfig,
  modelAlias: string,
  weight: number | undefined,
): RoutePreviewCandidate[] {
  const model = config.models?.[modelAlias];
  if (model === undefined) {
    throw new Error(t('cli.runtime.provider.fallbackModelNotConfiguredThrow', { modelAlias }));
  }
  const providerName = model.provider ?? config.defaultProvider;
  if (providerName === undefined) {
    throw new Error(t('cli.runtime.provider.modelMustDefineProvider', { modelAlias }));
  }
  const provider = config.providers[providerName];
  if (provider === undefined) {
    throw new Error(
      t('cli.runtime.provider.providerNotConfiguredForModel', { providerName, modelAlias }),
    );
  }

  const credentialSources = providerCredentialSources(provider);
  if (credentialSources.length === 0) {
    return [
      {
        modelAlias,
        providerName,
        providerType: provider.type,
        providerModel: model.model,
        weight,
        credentialSource: providerFallbackCredentialSource(provider),
        auth: providerFallbackAuth(provider),
        baseUrl: nonEmptyString(provider.baseUrl),
      },
    ];
  }

  return credentialSources.map((source) => ({
    modelAlias,
    providerName,
    providerType: provider.type,
    providerModel: model.model,
    weight,
    credentialLabel: source.credentialLabel,
    credentialSource: source.credentialSource,
    auth: source.auth,
    baseUrl: source.baseUrl ?? nonEmptyString(provider.baseUrl),
    rpm: source.rpm,
    tpm: source.tpm,
  }));
}

function providerCredentialSources(
  provider: LioraConfig['providers'][string],
): ProviderCredentialPreview[] {
  const apiKeySlots = providerApiKeySlots(provider);
  if (apiKeySlots.length > 0) {
    return apiKeySlots.map((slot, index) => ({
      credentialLabel: apiKeySlotLabel(slot, index),
      credentialSource: slot.credentialSource ?? `api_key:${String(index + 1)}`,
      auth: slot.credentialSource === 'keyless' ? 'keyless' : 'api_key',
      baseUrl: slot.baseUrl,
      rpm: slot.rpm,
      tpm: slot.tpm,
    }));
  }

  const oauthSources = providerOAuthCredentialSources(provider);
  if (oauthSources.length <= 1) return [];
  return oauthSources.map((source, index) => ({
    credentialLabel: oauthSlotLabel(source.ref, index),
    credentialSource: source.source,
    auth: 'oauth',
  }));
}

function providerPrimaryCredentialSource(
  provider: LioraConfig['providers'][string],
): string | undefined {
  const explicit = credentialSourceLabel(provider.apiKey, 'api_key');
  if (explicit !== undefined) return explicit;
  const envKey = providerDefaultApiKeyEnv(provider.type);
  if (envKey === undefined) return undefined;
  return credentialSourceLabel(provider.env?.[envKey], `provider.env.${envKey}`);
}

function providerDefaultApiKeyEnv(
  type: LioraConfig['providers'][string]['type'],
): string | undefined {
  switch (type) {
    case 'anthropic':
      return 'ANTHROPIC_API_KEY';
    case 'openai':
    case 'openai_responses':
      return 'OPENAI_API_KEY';
    case 'kimi':
      return 'KIMI_API_KEY';
    case 'google-genai':
      return 'GOOGLE_API_KEY';
    case 'vertexai':
      return 'VERTEXAI_API_KEY';
    case 'bedrock':
    case 'vertex_claude':
      return undefined;
    default: {
      const exhaustive: never = type;
      return exhaustive;
    }
  }
}

function credentialSourceLabel(value: string | undefined, fallback: string): string | undefined {
  const normalized = nonEmptyString(value);
  if (normalized === undefined) return undefined;
  if (normalized === 'no-key-required') return 'keyless';
  const envRef = parseEnvReference(normalized);
  return envRef === undefined ? fallback : `env:${envRef}`;
}

function parseEnvReference(value: string): string | undefined {
  const patterns = [
    /^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/,
    /^env:([A-Za-z_][A-Za-z0-9_]*)$/,
    /^env\/([A-Za-z_][A-Za-z0-9_]*)$/,
    /^os\.environ\/([A-Za-z_][A-Za-z0-9_]*)$/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(value);
    if (match?.[1] !== undefined) return match[1];
  }
  return undefined;
}

function isHttpUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:';
}

function providerFallbackCredentialSource(provider: LioraConfig['providers'][string]): string {
  if (provider.type === 'vertexai' && hasVertexAIServiceAccountSource(provider)) {
    return 'google_cloud';
  }
  if (providerHasOAuth(provider)) return 'oauth';
  return 'none';
}

function providerFallbackAuth(
  provider: LioraConfig['providers'][string],
): RoutePreviewCandidate['auth'] {
  if (provider.type === 'vertexai' && hasVertexAIServiceAccountSource(provider)) {
    return 'vertexai_service_account';
  }
  if (providerHasOAuth(provider)) return 'oauth';
  return 'none';
}

function providerOAuthCredentialSources(
  provider: LioraConfig['providers'][string],
): OAuthCredentialPreview[] {
  const seen = new Set<string>();
  const sources: OAuthCredentialPreview[] = [];
  const append = (
    oauth: LioraConfig['providers'][string]['oauth'] | undefined,
    source: string,
  ): void => {
    if (oauth === undefined) return;
    const key = JSON.stringify([oauth.storage, oauth.key, oauth.oauthHost ?? '']);
    if (seen.has(key)) return;
    seen.add(key);
    sources.push({ ref: oauth, source });
  };
  append(provider.oauth, 'oauth');
  for (let index = 0; index < (provider.oauths ?? []).length; index += 1) {
    append(provider.oauths?.[index], `oauths[${String(index + 1)}]`);
  }
  return sources;
}

function oauthSlotLabel(ref: ConfigOAuthRef, index: number): string {
  const label = nonEmptyString(ref.label);
  return label === undefined ? `oauth:${String(index + 1)}` : `oauth:${label}`;
}

function providerHasOAuth(provider: LioraConfig['providers'][string]): boolean {
  return provider.oauth !== undefined || (provider.oauths ?? []).length > 0;
}

function hasVertexAIServiceAccountSource(provider: LioraConfig['providers'][string]): boolean {
  return (
    provider.type === 'vertexai' &&
    nonEmptyString(provider.env?.['GOOGLE_CLOUD_PROJECT']) !== undefined &&
    nonEmptyString(provider.env?.['GOOGLE_CLOUD_LOCATION']) !== undefined
  );
}

function formatRoutePreview(preview: RoutePreview): string {
  const lines = [
    t('cli.runtime.provider.routePreviewHeader', { modelAlias: preview.modelAlias }),
    t('cli.runtime.provider.routePreviewActive', {
      value: preview.active ? t('cli.runtime.provider.valueYes') : t('cli.runtime.provider.valueNo'),
    }),
    t('cli.runtime.provider.routePreviewStrategy', { strategy: preview.strategy }),
    t('cli.runtime.provider.routePreviewFallbackModels', {
      fallbacks:
        preview.fallbackModels.length === 0
          ? t('cli.runtime.provider.valueNone')
          : preview.fallbackModels.join(', '),
    }),
    t('cli.runtime.provider.routePreviewSessionAffinity', {
      value:
        preview.sessionAffinity === true
          ? t('cli.runtime.provider.valueOn')
          : t('cli.runtime.provider.valueOff'),
    }),
    t('cli.runtime.provider.routePreviewPreferredCredential', {
      value: preview.preferredCredential ?? t('cli.runtime.provider.valueNone'),
    }),
    t('cli.runtime.provider.routePreviewCandidatesLabel'),
    ...preview.candidates.map((candidate, index) =>
      formatRoutePreviewCandidate(candidate, index),
    ),
  ];
  return `${lines.join('\n')}\n`;
}

function formatRoutePreviewCandidate(candidate: RoutePreviewCandidate, index: number): string {
  const parts = [
    `    #${String(index + 1)}`,
    `alias=${candidate.modelAlias}`,
    `provider=${candidate.providerName}`,
    `type=${candidate.providerType}`,
    `model=${candidate.providerModel}`,
    `auth=${candidate.auth}`,
    `source=${candidate.credentialSource}`,
  ];
  if (candidate.credentialLabel !== undefined) {
    parts.push(`credential=${candidate.credentialLabel}`);
  }
  if (candidate.preferred === true) {
    parts.push('preferred');
  }
  if (candidate.weight !== undefined) {
    parts.push(`weight=${String(candidate.weight)}`);
  }
  if (candidate.rpm !== undefined) {
    parts.push(`rpm=${String(candidate.rpm)}`);
  }
  if (candidate.tpm !== undefined) {
    parts.push(`tpm=${String(candidate.tpm)}`);
  }
  if (candidate.baseUrl !== undefined) {
    parts.push(`base_url=${candidate.baseUrl}`);
  }
  return parts.join('  ');
}

function formatPercent(value: number): string {
  const percent = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return `${String(percent)}%`;
}

function formatAliasListLabel(alias: string, model: ConfigModelAlias | undefined): string {
  const displayName = modelDisplayName(model);
  return displayName === undefined ? alias : `${alias} (${displayName})`;
}

function formatModelSelectionLabel(alias: string, model: ConfigModelAlias | undefined): string {
  const displayName = modelDisplayName(model);
  return displayName === undefined ? alias : `${displayName} (${alias})`;
}

function modelDisplayName(model: ConfigModelAlias | undefined): string | undefined {
  const displayName = model?.displayName?.trim();
  if (displayName === undefined || displayName.length === 0) return undefined;
  if (displayName === model?.model) return undefined;
  return displayName;
}

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

async function loadCatalogOrExit(deps: ProviderDeps, url: string): Promise<Catalog> {
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

export function registerProviderCommand(parent: Command, deps?: Partial<ProviderDeps>): void {
  const provider = parent
    .command('provider')
    .description(t('cli.sub.provider.description'))
    .action(async () => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleProviderList(resolved, { json: false }));
    });

  // Last-resort boundary: handlers report expected failures themselves, but
  // anything that escapes (e.g. a config write rejected because config.toml
  // is invalid) must end as a one-line error + exit 1, not an unhandled
  // rejection dumping a stack trace.
  const runAction = async (resolved: ProviderDeps, run: () => Promise<void>): Promise<void> => {
    try {
      await run();
    } catch (error) {
      resolved.stderr.write(`${errorMessage(error)}\n`);
      resolved.exit(1);
    }
  };

  provider
    .command('add <url>')
    .description(t('cli.sub.provider.cmd.add.desc'))
    .option('--api-key <key>', t('cli.sub.provider.cmd.add.option.apiKey'))
    .action(async (url: string, options: { apiKey?: string }) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleProviderAdd(resolved, url, { apiKey: options.apiKey }));
    });

  provider
    .command('remove <providerId>')
    .description(t('cli.sub.provider.cmd.remove.desc'))
    .action(async (providerId: string) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleProviderRemove(resolved, providerId));
    });

  provider
    .command('list')
    .description(t('cli.sub.provider.cmd.list.desc'))
    .option('--json', t('cli.sub.provider.cmd.list.option.json'), false)
    .action(async (options: { json?: boolean }) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleProviderList(resolved, { json: options.json === true }));
    });

  provider
    .command('doctor')
    .description(t('cli.sub.provider.cmd.doctor.desc'))
    .option('--json', t('cli.sub.provider.cmd.doctor.option.json'), false)
    .action(async (options: { json?: boolean }) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () =>
        handleProviderDoctor(resolved, { json: options.json === true }),
      );
    });

  provider
    .command('use <modelAlias>')
    .description(t('cli.sub.provider.cmd.use.desc'))
    .action(async (modelAlias: string) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleProviderUse(resolved, modelAlias));
    });

  const custom = provider
    .command('custom')
    .description(t('cli.sub.provider.cmd.custom.desc'));

  custom
    .command('add <providerId>')
    .description(t('cli.sub.provider.cmd.customAdd.desc'))
    .requiredOption('--base-url <url>', t('cli.sub.provider.cmd.customAdd.option.baseUrl'))
    .requiredOption('--model <modelId>', t('cli.sub.provider.cmd.customAdd.option.model'))
    .option('--api-key <key>', t('cli.sub.provider.cmd.customAdd.option.apiKey'))
    .option('--api-key-env <name>', t('cli.sub.provider.cmd.customAdd.option.apiKeyEnv'))
    .option(
      '--keyless',
      t('cli.sub.provider.cmd.customAdd.option.keyless'),
      false,
    )
    .option('--alias <alias>', t('cli.sub.provider.cmd.customAdd.option.alias'))
    .option('--type <type>', t('cli.sub.provider.cmd.customAdd.option.type'))
    .option(
      '--context <tokens>',
      t('cli.sub.provider.cmd.customAdd.option.context', {
        size: String(DEFAULT_CUSTOM_ENDPOINT_CONTEXT_SIZE),
      }),
    )
    .option('--output <tokens>', t('cli.sub.provider.cmd.customAdd.option.output'))
    .option('--display-name <name>', t('cli.sub.provider.cmd.customAdd.option.displayName'))
    .option('--thinking', t('cli.sub.provider.cmd.customAdd.option.thinking'), false)
    .option('--set-default', t('cli.sub.provider.cmd.customAdd.option.setDefault'), false)
    .action(async (providerId: string, options: CustomAddOptions) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleProviderCustomAdd(resolved, providerId, options));
    });

  const key = provider
    .command('key')
    .description(t('cli.sub.provider.cmd.key.desc'));

  key
    .command('add <providerId>')
    .description(t('cli.sub.provider.cmd.keyAdd.desc'))
    .option('--api-key <key>', t('cli.sub.provider.cmd.keyAdd.option.apiKey'))
    .option('--api-keys <keys>', t('cli.sub.provider.cmd.keyAdd.option.apiKeys'))
    .option('--api-key-env <name>', t('cli.sub.provider.cmd.keyAdd.option.apiKeyEnv'))
    .option('--api-key-envs <names>', t('cli.sub.provider.cmd.keyAdd.option.apiKeyEnvs'))
    .option('--base-url <url>', t('cli.sub.provider.cmd.keyAdd.option.baseUrl'))
    .option('--label <label>', t('cli.sub.provider.cmd.keyAdd.option.label'))
    .option('--labels <labels>', t('cli.sub.provider.cmd.keyAdd.option.labels'))
    .option('--rpm <count>', t('cli.sub.provider.cmd.keyAdd.option.rpm'))
    .option('--tpm <tokens>', t('cli.sub.provider.cmd.keyAdd.option.tpm'))
    .option('--auto-route', t('cli.sub.provider.cmd.keyAdd.option.autoRoute'))
    .action(async (providerId: string, options: KeyAddOptions) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleProviderKeyAdd(resolved, providerId, options));
    });

  key
    .command('list <providerId>')
    .description(t('cli.sub.provider.cmd.keyList.desc'))
    .action(async (providerId: string) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleProviderKeyList(resolved, providerId));
    });

  key
    .command('remove <providerId> <index>')
    .description(t('cli.sub.provider.cmd.keyRemove.desc'))
    .action(async (providerId: string, index: string) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleProviderKeyRemove(resolved, providerId, index));
    });

  key
    .command('promote <providerId> <index>')
    .description(t('cli.sub.provider.cmd.keyPromote.desc'))
    .action(async (providerId: string, index: string) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleProviderKeyPromote(resolved, providerId, index));
    });

  key
    .command('label <providerId> <index> <label>')
    .description(t('cli.sub.provider.cmd.keyLabel.desc'))
    .action(async (providerId: string, index: string, label: string) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () =>
        handleProviderKeyLabel(resolved, providerId, index, label),
      );
    });

  key
    .command('unlabel <providerId> <index>')
    .description(t('cli.sub.provider.cmd.keyUnlabel.desc'))
    .action(async (providerId: string, index: string) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleProviderKeyUnlabel(resolved, providerId, index));
    });

  key
    .command('limit <providerId> <index>')
    .description(t('cli.sub.provider.cmd.keyLimit.desc'))
    .option('--rpm <count>', t('cli.sub.provider.cmd.keyLimit.option.rpm'))
    .option('--tpm <tokens>', t('cli.sub.provider.cmd.keyLimit.option.tpm'))
    .option('--clear', t('cli.sub.provider.cmd.keyLimit.option.clear'), false)
    .action(async (providerId: string, index: string, options: KeyLimitOptions) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () =>
        handleProviderKeyLimit(resolved, providerId, index, options),
      );
    });

  key
    .command('clear <providerId>')
    .description(t('cli.sub.provider.cmd.keyClear.desc'))
    .action(async (providerId: string) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleProviderKeyClear(resolved, providerId));
    });

  const oauth = provider
    .command('oauth')
    .description(t('cli.sub.provider.cmd.oauth.desc'));

  oauth
    .command('add <providerId>')
    .description(t('cli.sub.provider.cmd.oauthAdd.desc'))
    .requiredOption('--key <key>', t('cli.sub.provider.cmd.oauthAdd.option.key'))
    .option('--storage <storage>', t('cli.sub.provider.cmd.oauthAdd.option.storage'))
    .option('--oauth-host <host>', t('cli.sub.provider.cmd.oauthAdd.option.oauthHost'))
    .option('--label <label>', t('cli.sub.provider.cmd.oauthAdd.option.label'))
    .option('--auto-route', t('cli.sub.provider.cmd.oauthAdd.option.autoRoute'))
    .action(
      async (
        providerId: string,
        options: {
          key?: string;
          storage?: string;
          oauthHost?: string;
          label?: string;
          autoRoute?: boolean;
        },
      ) => {
        const resolved = resolveDeps(deps);
        await runAction(resolved, () =>
          handleProviderOAuthAdd(resolved, providerId, {
            ...(options.key === undefined ? {} : { key: options.key }),
            ...(options.storage === undefined ? {} : { storage: options.storage }),
            ...(options.oauthHost === undefined ? {} : { oauthHost: options.oauthHost }),
            ...(options.label === undefined ? {} : { label: options.label }),
            autoRoute: options.autoRoute,
          }),
        );
      },
    );

  oauth
    .command('list <providerId>')
    .description(t('cli.sub.provider.cmd.oauthList.desc'))
    .action(async (providerId: string) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleProviderOAuthList(resolved, providerId));
    });

  oauth
    .command('remove <providerId> <index>')
    .description(t('cli.sub.provider.cmd.oauthRemove.desc'))
    .action(async (providerId: string, index: string) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleProviderOAuthRemove(resolved, providerId, index));
    });

  oauth
    .command('promote <providerId> <index>')
    .description(t('cli.sub.provider.cmd.oauthPromote.desc'))
    .action(async (providerId: string, index: string) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleProviderOAuthPromote(resolved, providerId, index));
    });

  oauth
    .command('label <providerId> <index> <label>')
    .description(t('cli.sub.provider.cmd.oauthLabel.desc'))
    .action(async (providerId: string, index: string, label: string) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () =>
        handleProviderOAuthLabel(resolved, providerId, index, label),
      );
    });

  oauth
    .command('unlabel <providerId> <index>')
    .description(t('cli.sub.provider.cmd.oauthUnlabel.desc'))
    .action(async (providerId: string, index: string) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleProviderOAuthUnlabel(resolved, providerId, index));
    });

  oauth
    .command('clear <providerId>')
    .description(t('cli.sub.provider.cmd.oauthClear.desc'))
    .action(async (providerId: string) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleProviderOAuthClear(resolved, providerId));
    });

  const route = provider
    .command('route')
    .description(t('cli.sub.provider.cmd.route.desc'));

  route
    .command('show <modelAlias>')
    .description(t('cli.sub.provider.cmd.routeShow.desc'))
    .action(async (modelAlias: string) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleProviderRouteShow(resolved, modelAlias));
    });

  route
    .command('preview <modelAlias>')
    .description(t('cli.sub.provider.cmd.routePreview.desc'))
    .option('--json', t('cli.sub.provider.cmd.routePreview.option.json'), false)
    .action(async (modelAlias: string, options: { json?: boolean }) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () =>
        handleProviderRoutePreview(resolved, modelAlias, { json: options.json === true }),
      );
    });

  route
    .command('auto <modelAlias>')
    .description(t('cli.sub.provider.cmd.routeAuto.desc'))
    .option('--fallback <aliases>', t('cli.sub.provider.cmd.routeAuto.option.fallback'))
    .option('--cooldown-ms <ms>', t('cli.sub.provider.cmd.routeAuto.option.cooldownMs'))
    .option(
      '--session-affinity <mode>',
      t('cli.sub.provider.cmd.routeAuto.option.sessionAffinity'),
    )
    .option(
      '--prefer-credential <label>',
      t('cli.sub.provider.cmd.routeAuto.option.preferCredential'),
    )
    .action(
      async (
        modelAlias: string,
        options: {
          fallback?: string;
          cooldownMs?: string;
          sessionAffinity?: string;
          preferCredential?: string;
        },
      ) => {
        const resolved = resolveDeps(deps);
        await runAction(resolved, () =>
          handleProviderRouteAuto(resolved, modelAlias, {
            fallback: options.fallback,
            cooldownMs: options.cooldownMs,
            sessionAffinity: options.sessionAffinity,
            preferredCredential: options.preferCredential,
          }),
        );
      },
    );

  route
    .command('set <modelAlias>')
    .description(t('cli.sub.provider.cmd.routeSet.desc'))
    .option('--fallback <aliases>', t('cli.sub.provider.cmd.routeSet.option.fallback'))
      .option(
        '--strategy <strategy>',
        t('cli.sub.provider.cmd.routeSet.option.strategy'),
      )
      .option('--cooldown-ms <ms>', t('cli.sub.provider.cmd.routeSet.option.cooldownMs'))
      .option('--weights <aliases>', t('cli.sub.provider.cmd.routeSet.option.weights'))
      .option(
        '--session-affinity <mode>',
        t('cli.sub.provider.cmd.routeSet.option.sessionAffinity'),
      )
      .option(
        '--prefer-credential <label>',
        t('cli.sub.provider.cmd.routeSet.option.preferCredential'),
      )
      .action(
        async (
          modelAlias: string,
          options: {
            fallback?: string;
            strategy?: string;
            cooldownMs?: string;
            weights?: string;
            sessionAffinity?: string;
            preferCredential?: string;
          },
        ) => {
        const resolved = resolveDeps(deps);
        await runAction(resolved, () =>
          handleProviderRouteSet(resolved, modelAlias, {
            fallback: options.fallback,
            strategy: options.strategy,
            cooldownMs: options.cooldownMs,
            weights: options.weights,
            sessionAffinity: options.sessionAffinity,
            preferredCredential: options.preferCredential,
          }),
        );
      },
    );

  route
    .command('reset <sessionId>')
    .description(t('cli.sub.provider.cmd.routeReset.desc'))
    .action(async (sessionId: string) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleProviderRouteReset(resolved, sessionId));
    });

  route
    .command('status <sessionId>')
    .description(t('cli.sub.provider.cmd.routeStatus.desc'))
    .option('--json', t('cli.sub.provider.cmd.routeStatus.option.json'), false)
    .action(async (sessionId: string, options: { json?: boolean }) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () =>
        handleProviderRouteStatus(resolved, sessionId, { json: options.json === true }),
      );
    });

  const catalog = provider
    .command('catalog')
    .description(t('cli.sub.provider.cmd.catalog.desc'));

  catalog
    .command('list [providerId]')
    .description(t('cli.sub.provider.cmd.catalogList.desc'))
    .option('--filter <substring>', t('cli.sub.provider.cmd.catalogList.option.filter'))
    .option('--url <url>', t('cli.sub.provider.cmd.catalogList.option.url', { url: DEFAULT_CATALOG_URL }))
    .option('--json', t('cli.sub.provider.cmd.catalogList.option.json'), false)
    .action(
      async (
        providerId: string | undefined,
        options: { filter?: string; url?: string; json?: boolean },
      ) => {
        const resolved = resolveDeps(deps);
        await runAction(resolved, () =>
          handleCatalogList(resolved, providerId, {
            json: options.json === true,
            ...(options.filter === undefined ? {} : { filter: options.filter }),
            ...(options.url === undefined ? {} : { url: options.url }),
          }),
        );
      },
    );

  catalog
    .command('add <providerId>')
    .description(t('cli.sub.provider.cmd.catalogAdd.desc'))
    .option('--api-key <key>', t('cli.sub.provider.cmd.catalogAdd.option.apiKey'))
    .option('--api-key-env <name>', t('cli.sub.provider.cmd.catalogAdd.option.apiKeyEnv'))
    .option('--default-model <modelId>', t('cli.sub.provider.cmd.catalogAdd.option.defaultModel'))
    .option('--url <url>', t('cli.sub.provider.cmd.catalogAdd.option.url', { url: DEFAULT_CATALOG_URL }))
    .action(
      async (
        providerId: string,
        options: { apiKey?: string; apiKeyEnv?: string; defaultModel?: string; url?: string },
      ) => {
        const resolved = resolveDeps(deps);
        await runAction(resolved, () =>
          handleCatalogAdd(resolved, providerId, {
            ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
            ...(options.apiKeyEnv === undefined ? {} : { apiKeyEnv: options.apiKeyEnv }),
            ...(options.defaultModel === undefined ? {} : { defaultModel: options.defaultModel }),
            ...(options.url === undefined ? {} : { url: options.url }),
          }),
        );
      },
    );
}

function resolveDeps(overrides: Partial<ProviderDeps> = {}): ProviderDeps {
  let harness: LioraHarness | undefined;
  const identity = createLioraHostIdentity();
  return {
    getHarness:
      overrides.getHarness ??
      (() => {
        harness ??= createLioraHarness({ identity });
        return harness;
      }),
    stdout: overrides.stdout ?? process.stdout,
    stderr: overrides.stderr ?? process.stderr,
    env: overrides.env ?? process.env,
    exit: overrides.exit ?? ((code: number) => process.exit(code)),
  };
}

function resolveApiKey(flag: string | undefined, env: NodeJS.ProcessEnv): string | undefined {
  if (typeof flag === 'string' && flag.length > 0) return flag;
  const fromEnv = env['KIMI_REGISTRY_API_KEY'];
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv;
  return undefined;
}

function resolveProviderApiKey(
  flag: string | undefined,
  env: NodeJS.ProcessEnv,
): string | undefined {
  if (typeof flag === 'string' && flag.length > 0) return flag;
  const fromEnv = env['KIMI_PROVIDER_API_KEY'];
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv;
  return undefined;
}

function resolveProviderApiKeySource(
  input: { readonly apiKey?: string; readonly apiKeyEnv?: string },
  deps: ProviderDeps,
): string | undefined {
  const apiKey = nonEmptyString(input.apiKey);
  const apiKeyEnv = nonEmptyString(input.apiKeyEnv);
  if (apiKey !== undefined && apiKeyEnv !== undefined) {
    writeProviderErr(deps, 'cli.runtime.provider.passApiKeyOrEnv');
    deps.exit(1);
  }
  if (apiKeyEnv !== undefined) return `{env:${parseEnvVarName(apiKeyEnv, deps)}}`;
  return resolveProviderApiKey(apiKey, deps.env);
}

function resolveCatalogProviderApiKeySource(
  input: CatalogAddOptions,
  deps: ProviderDeps,
): string | undefined {
  const apiKey = nonEmptyString(input.apiKey);
  const apiKeyEnv = nonEmptyString(input.apiKeyEnv);
  if (apiKey !== undefined && apiKeyEnv !== undefined) {
    writeProviderErr(deps, 'cli.runtime.provider.passApiKeyOrEnv');
    deps.exit(1);
  }
  if (apiKeyEnv !== undefined) return `{env:${parseEnvVarName(apiKeyEnv, deps)}}`;
  return resolveApiKey(apiKey, deps.env);
}

function resolveProviderApiKeySources(input: KeyAddOptions, deps: ProviderDeps): string[] {
  const rawKeys = uniqueStrings([
    ...optionalList(nonEmptyString(input.apiKey)),
    ...splitCommaList(input.apiKeys),
  ]);
  const envNames = uniqueStrings([
    ...optionalList(nonEmptyString(input.apiKeyEnv)),
    ...splitCommaList(input.apiKeyEnvs),
  ]);
  if (rawKeys.length > 0 && envNames.length > 0) {
    writeProviderErr(deps, 'cli.runtime.provider.passRawOrEnvKeys');
    deps.exit(1);
  }
  if (envNames.length > 0) {
    return envNames.map((name) => `{env:${parseEnvVarName(name, deps)}}`);
  }
  if (rawKeys.length > 0) return rawKeys;
  return optionalList(resolveProviderApiKey(undefined, deps.env));
}

function resolveProviderCredentialLabels(
  input: KeyAddOptions,
  keyCount: number,
  deps: ProviderDeps,
): (string | undefined)[] {
  const label = nonEmptyString(input.label);
  const labelsText = nonEmptyString(input.labels);
  if (label !== undefined && labelsText !== undefined) {
    writeProviderErr(deps, 'cli.runtime.provider.passLabelOrLabels');
    deps.exit(1);
  }
  if (label !== undefined) {
    if (keyCount !== 1) {
      writeProviderErr(deps, 'cli.runtime.provider.labelOnlyForSingleKey');
      deps.exit(1);
    }
    return [parseCredentialLabel(label, deps)];
  }
  if (labelsText === undefined) return Array.from({ length: keyCount }, () => undefined);

  const labels = labelsText.split(',').map((entry) => parseCredentialLabel(entry, deps));
  if (labels.length !== keyCount) {
    writeProviderErr(deps, 'cli.runtime.provider.labelsCountMismatch');
    deps.exit(1);
  }
  const seen = new Set<string>();
  for (const value of labels) {
    const normalized = value.toLowerCase();
    if (seen.has(normalized)) {
      writeProviderErr(deps, 'cli.runtime.provider.duplicateCredentialLabel', { label: value });
      deps.exit(1);
    }
    seen.add(normalized);
  }
  return labels;
}

function resolveProviderCredentialLocalLimits(
  input: KeyAddOptions,
  deps: ProviderDeps,
): { readonly rpm?: number; readonly tpm?: number } {
  return {
    rpm:
      input.rpm === undefined
        ? undefined
        : parsePositiveInt(input.rpm, 'Requests per minute', deps),
    tpm:
      input.tpm === undefined
        ? undefined
        : parsePositiveInt(input.tpm, 'Tokens per minute', deps),
  };
}

function parseCredentialLabel(value: string, deps: ProviderDeps): string {
  const label = value.trim();
  if (!isValidCredentialLabel(label)) {
    writeProviderErr(deps, 'cli.runtime.provider.invalidCredentialLabel', { label: value });
    deps.exit(1);
  }
  return label;
}

function optionalList<T>(value: T | undefined): T[] {
  return value === undefined ? [] : [value];
}

function splitCommaList(value: string | undefined): string[] {
  if (value === undefined) return [];
  return uniqueStrings(value.split(',').map((entry) => entry.trim()));
}

function parseEnvVarName(value: string, deps: ProviderDeps): string {
  const name = value.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    writeProviderErr(deps, 'cli.runtime.provider.invalidEnvVarName', { name: value });
    deps.exit(1);
  }
  return name;
}

function addApiKeySlotsToProvider(
  provider: LioraConfig['providers'][string],
  slots: readonly ProviderApiKeySlot[],
): LioraConfig['providers'][string] | undefined {
  const currentSlots = providerApiKeySlots(provider);
  const nextSlots = uniqueApiKeySlots([...currentSlots, ...slots]);
  if (nextSlots.length === currentSlots.length) return undefined;
  return rewriteProviderApiKeySlots(provider, nextSlots);
}

function rewriteProviderApiKeySlots(
  provider: LioraConfig['providers'][string],
  slots: readonly ProviderApiKeySlot[],
): LioraConfig['providers'][string] {
  const unique = uniqueApiKeySlots(slots);
  const hasObjectCredential = unique.some(
    (slot) =>
      slot.baseUrl !== undefined ||
      slot.label !== undefined ||
      slot.rpm !== undefined ||
      slot.tpm !== undefined,
  );
  const { apiKey: _apiKey, apiKeys: _apiKeys, credentials: _credentials, ...rest } = provider;
  if (unique.length === 0) {
    return {
      ...rest,
      apiKey: '',
      apiKeys: [],
      credentials: [],
    };
  }
  if (hasObjectCredential) {
    return {
      ...rest,
      apiKey: '',
      apiKeys: [],
      credentials: unique.map(apiKeySlotToCredential),
    };
  }
  return {
    ...rest,
    apiKey: unique[0]?.apiKey ?? '',
    apiKeys: unique.slice(1).map((slot) => slot.apiKey),
    credentials: [],
  };
}

function providerApiKeyCount(provider: LioraConfig['providers'][string]): number {
  return providerApiKeySlots(provider).length;
}

function providerApiKeySlots(provider: LioraConfig['providers'][string]): ProviderApiKeySlot[] {
  const slots: ProviderApiKeySlot[] = [];
  const primary = nonEmptyString(provider.apiKey);
  if (primary !== undefined) {
    slots.push({
      apiKey: primary,
      credentialSource: credentialSourceLabel(primary, 'api_key'),
    });
  }
  for (let index = 0; index < (provider.apiKeys ?? []).length; index += 1) {
    const apiKey = nonEmptyString(provider.apiKeys?.[index]);
    if (apiKey === undefined) continue;
    slots.push({
      apiKey,
      credentialSource: credentialSourceLabel(apiKey, `api_keys[${String(index + 1)}]`),
    });
  }
  for (let index = 0; index < (provider.credentials ?? []).length; index += 1) {
    const credential = provider.credentials?.[index];
    if (credential === undefined) continue;
    const apiKey = nonEmptyString(credential.apiKey);
    if (apiKey === undefined) continue;
    slots.push({
      apiKey,
      credentialSource: credentialSourceLabel(
        apiKey,
        `credentials[${String(index + 1)}].api_key`,
      ),
      baseUrl: nonEmptyString(credential.baseUrl),
      label: nonEmptyString(credential.label),
      rpm: credential.rpm,
      tpm: credential.tpm,
    });
  }
  if (slots.length > 0) return uniqueApiKeySlots(slots);

  const keys: string[] = [];
  const defaultSource = providerPrimaryCredentialSource(provider);
  if (defaultSource !== undefined) {
    const envKey = providerDefaultApiKeyEnv(provider.type);
    const configured = envKey === undefined ? undefined : nonEmptyString(provider.env?.[envKey]);
    if (configured !== undefined) {
      keys.push(configured);
    }
  }
  return keys.map((apiKey) => ({ apiKey, credentialSource: defaultSource }));
}

function apiKeySlotToCredential(slot: ProviderApiKeySlot): ConfigProviderCredential {
  return {
    apiKey: slot.apiKey,
    baseUrl: slot.baseUrl,
    label: slot.label,
    rpm: slot.rpm,
    tpm: slot.tpm,
  };
}

function apiKeySlotLabel(slot: ProviderApiKeySlot, index: number): string {
  return slot.label === undefined ? `api_key:${String(index + 1)}` : `api_key:${slot.label}`;
}

function uniqueApiKeySlots(slots: readonly ProviderApiKeySlot[]): ProviderApiKeySlot[] {
  const unique: ProviderApiKeySlot[] = [];
  const seen = new Set<string>();
  for (const slot of slots) {
    const apiKey = nonEmptyString(slot.apiKey);
    if (apiKey === undefined) continue;
    const baseUrl = nonEmptyString(slot.baseUrl);
    const key = `${apiKey}\n${baseUrl ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({
      apiKey,
      credentialSource: slot.credentialSource,
      baseUrl,
      label: nonEmptyString(slot.label),
      rpm: slot.rpm,
      tpm: slot.tpm,
    });
  }
  return unique;
}

function addOAuthRefToProvider(
  provider: LioraConfig['providers'][string],
  oauthRef: ConfigOAuthRef,
): LioraConfig['providers'][string] | undefined {
  const refs = providerOAuthRefs(provider);
  if (refs.some((ref) => sameOAuthRef(ref, oauthRef))) return undefined;
  return rewriteProviderOAuthRefs(provider, [...refs, oauthRef]);
}

function rewriteProviderOAuthRefs(
  provider: LioraConfig['providers'][string],
  refs: readonly ConfigOAuthRef[],
): LioraConfig['providers'][string] {
  return rewriteProviderOAuthRefsShared(
    provider as Record<string, unknown>,
    refs as readonly ProviderOAuthRef[],
  ) as LioraConfig['providers'][string];
}

function providerOAuthRefs(provider: LioraConfig['providers'][string]): ConfigOAuthRef[] {
  return listProviderOAuthRefs(provider as Record<string, unknown>) as ConfigOAuthRef[];
}

function promoteSlot<T>(values: readonly T[], index: number): T[] {
  return promoteProviderOAuthSlot(values, index);
}

function sameOAuthRef(left: ConfigOAuthRef, right: ConfigOAuthRef): boolean {
  return (
    left.storage === right.storage &&
    left.key === right.key &&
    (left.oauthHost ?? '') === (right.oauthHost ?? '')
  );
}

function providerHasApiKeySource(provider: LioraConfig['providers'][string]): boolean {
  if (providerPrimaryCredentialSource(provider) !== undefined) return true;
  return providerApiKeySlots(provider).length > 0;
}

function nonEmptyString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = nonEmptyString(value);
    if (normalized === undefined || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function isValidCredentialLabel(value: string): boolean {
  return isValidProviderOAuthCredentialLabel(value);
}

function parseKeyIndex(indexText: string, deps: ProviderDeps): number {
  const index = Number(indexText);
  if (!Number.isInteger(index) || index < 1) {
    writeProviderErr(deps, 'cli.runtime.provider.apiKeyIndexPositive');
    deps.exit(1);
  }
  return index;
}

function parseOAuthIndex(indexText: string, deps: ProviderDeps): number {
  const index = Number(indexText);
  if (!Number.isInteger(index) || index < 1) {
    writeProviderErr(deps, 'cli.runtime.provider.oauthIndexPositive');
    deps.exit(1);
  }
  return index;
}

function parseOAuthStorage(value: string, deps: ProviderDeps): ConfigOAuthRef['storage'] {
  if (value === 'file' || value === 'keyring') return value;
  writeProviderErr(deps, 'cli.runtime.provider.oauthStorageInvalid');
  deps.exit(1);
}

function fingerprintOAuthRef(ref: ConfigOAuthRef): string {
  return fingerprintProviderOAuthRef(ref as ProviderOAuthRef);
}

function parseFallbackModels(value: string): string[] {
  return uniqueStrings(value.split(',').map((entry) => entry.trim()));
}

function parseRoutingStrategy(
  value: string,
  deps: ProviderDeps,
):
  | 'auto'
  | 'fallback'
  | 'fill_first'
  | 'round_robin'
  | 'weighted_round_robin'
  | 'least_used'
  | 'lowest_latency'
  | 'rate_limit_aware'
  | 'random' {
  if (
    value === 'auto' ||
    value === 'fallback' ||
    value === 'fill_first' ||
    value === 'round_robin' ||
    value === 'weighted_round_robin' ||
    value === 'least_used' ||
    value === 'lowest_latency' ||
    value === 'rate_limit_aware' ||
    value === 'random'
  ) {
    return value;
  }
  writeProviderErr(deps, 'cli.runtime.provider.routingStrategyInvalid');
  deps.exit(1);
}

function parseCooldownMs(value: string, deps: ProviderDeps): number {
  const cooldownMs = Number(value);
  if (!Number.isInteger(cooldownMs) || cooldownMs < 0) {
    writeProviderErr(deps, 'cli.runtime.provider.cooldownNonNegative');
    deps.exit(1);
  }
  return cooldownMs;
}

function parseSessionAffinity(value: string, deps: ProviderDeps): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'on' || normalized === 'true' || normalized === '1') return true;
  if (normalized === 'off' || normalized === 'false' || normalized === '0') return false;
  writeProviderErr(deps, 'cli.runtime.provider.sessionAffinityOnOff');
  deps.exit(1);
}

function parsePreferredCredential(value: string): string | undefined {
  return nonEmptyString(value);
}

function parseRouteWeights(
  value: string,
  deps: ProviderDeps,
): Record<string, number> | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  const weights: Record<string, number> = {};
  for (const entry of trimmed.split(',')) {
    const [rawAlias, rawWeight, ...extra] = entry.split('=');
    const alias = rawAlias?.trim() ?? '';
    const weightText = rawWeight?.trim() ?? '';
    if (alias.length === 0 || weightText.length === 0 || extra.length > 0) {
      writeProviderErr(deps, 'cli.runtime.provider.weightsFormat');
      deps.exit(1);
    }
    const weight = Number(weightText);
    if (!Number.isInteger(weight) || weight <= 0) {
      writeProviderErr(deps, 'cli.runtime.provider.routeWeightsPositive');
      deps.exit(1);
    }
    weights[alias] = weight;
  }
  return weights;
}

function validateRouteWeights(
  weights: Readonly<Record<string, number>> | undefined,
  routeAliases: readonly string[],
  deps: ProviderDeps,
): void {
  if (weights === undefined) return;
  const routeAliasSet = new Set(routeAliases);
  for (const alias of Object.keys(weights)) {
    if (!routeAliasSet.has(alias)) {
      writeProviderErr(deps, 'cli.runtime.provider.routeWeightNotInRoute', { alias });
      deps.exit(1);
    }
  }
}

function validatePreferredCredential(
  preferredCredential: string | undefined,
  labels: readonly string[],
  deps: ProviderDeps,
): void {
  if (preferredCredential === undefined) return;
  if (labels.includes(preferredCredential)) return;
  writeProviderErr(deps, 'cli.runtime.provider.preferredCredentialInvalid', {
    credential: preferredCredential,
  });
  deps.exit(1);
}

function routeCandidateCredentialLabels(
  config: LioraConfig,
  modelAlias: string,
  fallbackModels: readonly string[],
): string[] {
  const candidates = uniqueStrings([modelAlias, ...fallbackModels]).flatMap((alias) =>
    routePreviewCandidatesForAlias(config, alias, undefined),
  );
  return uniqueStrings(
    candidates.flatMap((candidate) => {
      if (candidate.credentialLabel === undefined) return [];
      return [
        candidate.credentialLabel,
        `${candidate.modelAlias}:${candidate.credentialLabel}`,
        `${candidate.providerName}:${candidate.credentialLabel}`,
      ];
    }),
  );
}

function matchesRoutePreviewPreferred(
  preferredCredential: string | undefined,
  candidate: RoutePreviewCandidate,
): boolean {
  const preferred = preferredCredential?.trim();
  const label = candidate.credentialLabel?.trim();
  if (preferred === undefined || preferred.length === 0 || label === undefined || label.length === 0) {
    return false;
  }
  return (
    preferred === label ||
    preferred === `${candidate.modelAlias}:${label}` ||
    preferred === `${candidate.providerName}:${label}`
  );
}

function formatRouteWeights(weights: Readonly<Record<string, number>> | undefined): string {
  if (weights === undefined || Object.keys(weights).length === 0) {
    return t('cli.runtime.provider.valueNone');
  }
  return Object.entries(weights)
    .map(([alias, weight]) => `${alias}=${String(weight)}`)
    .join(', ');
}

function parsePositiveInt(value: string, label: string, deps: ProviderDeps): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    writeProviderErr(deps, 'cli.runtime.provider.positiveIntRequired', { label });
    deps.exit(1);
  }
  return parsed;
}

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

function asManaged(config: LioraConfig): ManagedKimiConfigShape {
  return config as unknown as ManagedKimiConfigShape;
}

function providerSourceLabel(provider: LioraConfig['providers'][string]): string {
  const source = provider.source;
  if (source !== undefined) {
    if (source['kind'] === 'apiJson' && typeof source['url'] === 'string') {
      return `apiJson(${source['url']})`;
    }
  }
  if (providerHasOAuth(provider)) return 'oauth';
  return 'inline';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
