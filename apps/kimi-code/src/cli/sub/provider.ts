/**
 * `kimi provider` sub-command — non-interactive provider management.
 *
 * Mirrors the TUI `/provider` flow (apps/kimi-code/src/tui/commands/provider.ts)
 * for the custom-registry path so users can import an api.json document, drop
 * a provider, or inspect what is configured without launching the TUI.
 *
 * `add` writes the same `source = { kind: 'apiJson', url, apiKey }` blob the
 * TUI does; the next launch's `refreshAllProviderModels`
 * (apps/kimi-code/src/tui/utils/refresh-providers.ts) groups by URL, retries
 * available API-key candidates, and re-fetches the model list, so periodic
 * refresh is automatic.
 */

import { createHash } from 'node:crypto';

import {
  applyCustomRegistryProvider,
  CustomRegistryApiError,
  fetchCustomRegistry,
  type CustomRegistrySource,
  type ManagedKimiConfigShape,
} from '@moonshot-ai/kimi-code-oauth';
import {
  applyCatalogProvider,
  catalogBaseUrl,
  catalogProviderModels,
  CatalogFetchError,
  createKimiHarness,
  DEFAULT_CATALOG_URL,
  fetchCatalog,
  inferWireType,
  type Catalog,
  type CatalogProviderEntry,
  type KimiConfig,
  type KimiHarness,
  type ProviderRouteStatus,
} from '@moonshot-ai/kimi-code-sdk';
import type { Command } from 'commander';

import { createKimiCodeHostIdentity } from '#/cli/version';
import {
  applyCustomEndpointProvider,
  DEFAULT_CUSTOM_ENDPOINT_CONTEXT_SIZE,
} from '#/utils/custom-provider';

interface WritableLike {
  write(chunk: string): boolean;
}

export interface ProviderDeps {
  readonly getHarness: () => KimiHarness;
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
  readonly providerType: KimiConfig['providers'][string]['type'];
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
  readonly models?: KimiConfig['models'];
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

type ConfigOAuthRef = NonNullable<KimiConfig['providers'][string]['oauth']>;
type ConfigProviderCredential = NonNullable<
  KimiConfig['providers'][string]['credentials']
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
    deps.stderr.write(
      'Missing API key. Pass --api-key <key> or set KIMI_REGISTRY_API_KEY.\n',
    );
    deps.exit(1);
  }

  const trimmedUrl = url.trim();
  if (trimmedUrl.length === 0) {
    deps.stderr.write('Registry URL is required.\n');
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
    const suffix = error instanceof CustomRegistryApiError ? ` (HTTP ${String(error.status)})` : '';
    deps.stderr.write(`Failed to fetch registry${suffix}: ${errorMessage(error)}\n`);
    deps.exit(1);
  }

  const entryList = Object.values(entries);
  if (entryList.length === 0) {
    deps.stderr.write(`Registry at ${trimmedUrl} contained no usable providers.\n`);
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

  deps.stdout.write(
    `Imported ${String(addedProviderIds.length)} provider${addedProviderIds.length === 1 ? '' : 's'} ` +
      `(${String(modelCount)} model${modelCount === 1 ? '' : 's'}) from ${trimmedUrl}:\n`,
  );
  for (const id of addedProviderIds) {
    deps.stdout.write(`  - ${id}\n`);
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
    deps.stderr.write(`Provider "${providerId}" not found.\n`);
    deps.exit(1);
  }
  await harness.removeProvider(providerId);
  deps.stdout.write(`Removed provider "${providerId}".\n`);
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
    deps.stdout.write('No providers configured.\n');
    return;
  }

  for (const id of providerIds) {
    const provider = config.providers[id]!;
    const aliases = modelsByProvider.get(id) ?? [];
    const sourceLabel = providerSourceLabel(provider);
    deps.stdout.write(
      `${id}  type=${provider.type}  models=${String(aliases.length)}  ` +
        `keys=${String(providerApiKeyCount(provider))}  source=${sourceLabel}\n`,
    );
    if (aliases.length > 0) {
      const labels = aliases
        .toSorted()
        .map((alias) => formatAliasListLabel(alias, models[alias]));
      deps.stdout.write(`  aliases: ${labels.join(', ')}\n`);
    }
  }
  if (config.defaultModel !== undefined) {
    deps.stdout.write(
      `\nDefault model: ${formatModelSelectionLabel(config.defaultModel, models[config.defaultModel])}\n`,
    );
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
    deps.stderr.write('Model alias is required.\n');
    deps.exit(1);
  }

  const harness = deps.getHarness();
  await harness.ensureConfigFile();
  const config = await harness.getConfig();
  const model = config.models?.[alias];
  if (model === undefined) {
    deps.stderr.write(
      `Model "${alias}" not found. Run \`kimi provider list --json\` to see configured model aliases.\n`,
    );
    deps.exit(1);
  }
  if (config.providers[model.provider] === undefined) {
    deps.stderr.write(
      `Model "${alias}" points at missing provider "${model.provider}". Run \`kimi provider\` to inspect configured providers.\n`,
    );
    deps.exit(1);
  }

  await harness.setConfig({ defaultModel: alias });
  deps.stdout.write(`Default model set to ${formatModelSelectionLabel(alias, model)}.\n`);
}

export async function handleProviderCustomAdd(
  deps: ProviderDeps,
  providerId: string,
  opts: CustomAddOptions,
): Promise<void> {
  const baseUrl = opts.baseUrl?.trim();
  if (baseUrl === undefined || baseUrl.length === 0) {
    deps.stderr.write('Missing base URL. Pass --base-url <url>.\n');
    deps.exit(1);
  }
  const modelId = opts.model?.trim();
  if (modelId === undefined || modelId.length === 0) {
    deps.stderr.write('Missing model id. Pass --model <modelId>.\n');
    deps.exit(1);
  }
  const apiKey = resolveProviderApiKeySource(
    { apiKey: opts.apiKey, apiKeyEnv: opts.apiKeyEnv },
    deps,
  );
  if (apiKey === undefined && opts.keyless !== true) {
    deps.stderr.write(
      'Missing API key. Pass --api-key <key>, --api-key-env <name>, set KIMI_PROVIDER_API_KEY, ' +
        'or use --keyless for local endpoints.\n',
    );
    deps.exit(1);
  }

  const providerType = parseProviderType(opts.type ?? 'openai', deps);
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
    deps.stderr.write(`Provider "${providerId}" uses OAuth; choose a different provider id.\n`);
    deps.exit(1);
  }

  let applied: ReturnType<typeof applyCustomEndpointProvider>;
  try {
    applied = applyCustomEndpointProvider(config, {
      providerId,
      baseUrl,
      modelId,
      apiKey: apiKey ?? 'no-key-required',
      providerType,
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
  deps.stdout.write(
    `Added custom endpoint provider "${applied.providerId}" with model "${applied.modelAlias}".\n`,
  );
  if (opts.setDefault === true) {
    deps.stdout.write(`Default model set to ${applied.modelAlias}.\n`);
  }
}

export async function handleProviderKeyAdd(
  deps: ProviderDeps,
  providerId: string,
  opts: KeyAddOptions,
): Promise<void> {
  const apiKeys = resolveProviderApiKeySources(opts, deps);
  if (apiKeys.length === 0) {
    deps.stderr.write(
      'Missing API key. Pass --api-key <key>, --api-keys <keys>, --api-key-env <name>, --api-key-envs <names>, or set KIMI_PROVIDER_API_KEY.\n',
    );
    deps.exit(1);
  }

  const harness = deps.getHarness();
  await harness.ensureConfigFile();
  const config = await harness.getConfig();
  const provider = config.providers[providerId];
  if (provider === undefined) {
    deps.stderr.write(`Provider "${providerId}" not found.\n`);
    deps.exit(1);
  }
  if (providerHasOAuth(provider)) {
    deps.stderr.write(`Provider "${providerId}" uses OAuth; API keys cannot be mixed into it.\n`);
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
    deps.stdout.write(`API key${apiKeys.length === 1 ? '' : 's'} already configured for provider "${providerId}".\n`);
    writeProviderAutoRouteSummary(deps, providerId, autoRoute);
    return;
  }

  const nextConfig: KimiConfig = {
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
    deps.stdout.write(`Added API key to provider "${providerId}".\n`);
    writeProviderAutoRouteSummary(deps, providerId, autoRoute);
    return;
  }
  deps.stdout.write(`Added ${String(apiKeys.length)} API keys to provider "${providerId}".\n`);
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
    deps.stderr.write(`Provider "${providerId}" not found.\n`);
    deps.exit(1);
  }

  const slots = providerApiKeySlots(provider);
  if (slots.length === 0) {
    deps.stdout.write(`Provider "${providerId}" has no configured API keys.\n`);
    return;
  }

  deps.stdout.write(
    `Provider "${providerId}" has ${String(slots.length)} configured ` +
      `API key${slots.length === 1 ? '' : 's'}:\n`,
  );
  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index]!;
    const role = index === 0 ? 'primary' : 'fallback';
    const labelText = slot.label === undefined ? '' : `  label=${slot.label}`;
    const rpmText = slot.rpm === undefined ? '' : `  rpm=${String(slot.rpm)}`;
    const tpmText = slot.tpm === undefined ? '' : `  tpm=${String(slot.tpm)}`;
    const baseUrlText = slot.baseUrl === undefined ? '' : `  base_url=${slot.baseUrl}`;
    deps.stdout.write(
      `  #${String(index + 1)}  ${role}${labelText}${rpmText}${tpmText}${baseUrlText}\n`,
    );
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
    deps.stderr.write(`Provider "${providerId}" not found.\n`);
    deps.exit(1);
  }
  if (providerHasOAuth(provider)) {
    deps.stderr.write(`Provider "${providerId}" uses OAuth; API keys cannot be removed from it.\n`);
    deps.exit(1);
  }

  const slots = providerApiKeySlots(provider);
  if (index < 1 || index > slots.length) {
    deps.stderr.write(
      `API key #${String(index)} not found for provider "${providerId}". ` +
        `Run \`kimi provider key list ${providerId}\`.\n`,
    );
    deps.exit(1);
  }

  const nextSlots = slots.filter((_, keyIndex) => keyIndex !== index - 1);
  await harness.setConfig({
    providers: {
      ...config.providers,
      [providerId]: rewriteProviderApiKeySlots(provider, nextSlots),
    },
  });
  deps.stdout.write(`Removed API key #${String(index)} from provider "${providerId}".\n`);
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
    deps.stderr.write(`Provider "${providerId}" not found.\n`);
    deps.exit(1);
  }
  if (providerHasOAuth(provider)) {
    deps.stderr.write(`Provider "${providerId}" uses OAuth; API keys cannot be promoted.\n`);
    deps.exit(1);
  }

  const slots = providerApiKeySlots(provider);
  if (index < 1 || index > slots.length) {
    deps.stderr.write(
      `API key #${String(index)} not found for provider "${providerId}". ` +
        `Run \`kimi provider key list ${providerId}\`.\n`,
    );
    deps.exit(1);
  }
  if (index === 1) {
    deps.stdout.write(`API key #1 is already primary for provider "${providerId}".\n`);
    return;
  }

  await harness.setConfig({
    providers: {
      ...config.providers,
      [providerId]: rewriteProviderApiKeySlots(provider, promoteSlot(slots, index - 1)),
    },
  });
  deps.stdout.write(`Promoted API key #${String(index)} to primary for provider "${providerId}".\n`);
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
    deps.stderr.write(`Provider "${providerId}" not found.\n`);
    deps.exit(1);
  }
  if (providerHasOAuth(provider)) {
    deps.stderr.write(`Provider "${providerId}" uses OAuth; API keys cannot be labeled.\n`);
    deps.exit(1);
  }

  const slots = providerApiKeySlots(provider);
  if (index < 1 || index > slots.length) {
    deps.stderr.write(
      `API key #${String(index)} not found for provider "${providerId}". ` +
        `Run \`kimi provider key list ${providerId}\`.\n`,
    );
    deps.exit(1);
  }
  const duplicate = slots.find(
    (slot, slotIndex) =>
      slotIndex !== index - 1 && slot.label?.toLowerCase() === label.toLowerCase(),
  );
  if (duplicate !== undefined) {
    deps.stderr.write(`Credential label "${label}" is already used by another API key.\n`);
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
  deps.stdout.write(
    `Labeled API key #${String(index)} for provider "${providerId}" as "${label}".\n`,
  );
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
    deps.stderr.write(`Provider "${providerId}" not found.\n`);
    deps.exit(1);
  }
  if (providerHasOAuth(provider)) {
    deps.stderr.write(`Provider "${providerId}" uses OAuth; API keys cannot be unlabeled.\n`);
    deps.exit(1);
  }

  const slots = providerApiKeySlots(provider);
  if (index < 1 || index > slots.length) {
    deps.stderr.write(
      `API key #${String(index)} not found for provider "${providerId}". ` +
        `Run \`kimi provider key list ${providerId}\`.\n`,
    );
    deps.exit(1);
  }
  if (slots[index - 1]?.label === undefined) {
    deps.stdout.write(`API key #${String(index)} for provider "${providerId}" has no label.\n`);
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
  deps.stdout.write(`Removed label from API key #${String(index)} for provider "${providerId}".\n`);
}

export async function handleProviderKeyLimit(
  deps: ProviderDeps,
  providerId: string,
  indexText: string,
  opts: KeyLimitOptions,
): Promise<void> {
  if (opts.rpm === undefined && opts.tpm === undefined && opts.clear !== true) {
    deps.stderr.write('Nothing to update. Pass --rpm, --tpm, or --clear.\n');
    deps.exit(1);
  }
  if (opts.clear === true && (opts.rpm !== undefined || opts.tpm !== undefined)) {
    deps.stderr.write('Pass either --clear or limit values, not both.\n');
    deps.exit(1);
  }

  const index = parseKeyIndex(indexText, deps);
  const harness = deps.getHarness();
  await harness.ensureConfigFile();
  const config = await harness.getConfig();
  const provider = config.providers[providerId];
  if (provider === undefined) {
    deps.stderr.write(`Provider "${providerId}" not found.\n`);
    deps.exit(1);
  }
  if (providerHasOAuth(provider)) {
    deps.stderr.write(`Provider "${providerId}" uses OAuth; API key limits cannot be changed.\n`);
    deps.exit(1);
  }

  const slots = providerApiKeySlots(provider);
  if (index < 1 || index > slots.length) {
    deps.stderr.write(
      `API key #${String(index)} not found for provider "${providerId}". ` +
        `Run \`kimi provider key list ${providerId}\`.\n`,
    );
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
    deps.stdout.write(
      `Cleared local limits for API key #${String(index)} on provider "${providerId}".\n`,
    );
    return;
  }
  deps.stdout.write(
    `Updated local limits for API key #${String(index)} on provider "${providerId}".\n`,
  );
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
    deps.stderr.write(`Provider "${providerId}" not found.\n`);
    deps.exit(1);
  }
  if (providerHasOAuth(provider)) {
    deps.stderr.write(`Provider "${providerId}" uses OAuth; API keys cannot be removed from it.\n`);
    deps.exit(1);
  }

  await harness.setConfig({
    providers: {
      ...config.providers,
      [providerId]: rewriteProviderApiKeySlots(provider, []),
    },
  });
  deps.stdout.write(`Removed all API keys from provider "${providerId}".\n`);
}

export async function handleProviderOAuthAdd(
  deps: ProviderDeps,
  providerId: string,
  opts: OAuthAddOptions,
): Promise<void> {
  const key = nonEmptyString(opts.key);
  if (key === undefined) {
    deps.stderr.write('Missing OAuth storage key. Pass --key <key>.\n');
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
    deps.stderr.write(`Provider "${providerId}" not found.\n`);
    deps.exit(1);
  }
  if (providerHasApiKeySource(provider)) {
    deps.stderr.write(
      `Provider "${providerId}" uses API keys; OAuth accounts cannot be mixed into it.\n`,
    );
    deps.exit(1);
  }

  const nextProvider = addOAuthRefToProvider(provider, oauthRef);
  if (nextProvider === undefined) {
    const autoRoute = opts.autoRoute === true ? providerAutoRouteModels(config, providerId) : undefined;
    if (autoRoute?.models !== undefined) {
      await harness.setConfig({ models: autoRoute.models });
    }
    deps.stdout.write(`OAuth account ref is already configured for provider "${providerId}".\n`);
    writeProviderAutoRouteSummary(deps, providerId, autoRoute);
    return;
  }

  const nextConfig: KimiConfig = {
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
  deps.stdout.write(`Added OAuth account ref to provider "${providerId}".\n`);
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
    deps.stderr.write(`Provider "${providerId}" not found.\n`);
    deps.exit(1);
  }

  const refs = providerOAuthRefs(provider);
  if (refs.length === 0) {
    deps.stdout.write(`Provider "${providerId}" has no configured OAuth account refs.\n`);
    return;
  }

  deps.stdout.write(
    `Provider "${providerId}" has ${String(refs.length)} configured ` +
      `OAuth account ref${refs.length === 1 ? '' : 's'}:\n`,
  );
  for (let index = 0; index < refs.length; index += 1) {
    const ref = refs[index]!;
    const role = index === 0 ? 'primary' : 'fallback';
    const labelText = ref.label === undefined ? '' : `  label=${ref.label}`;
    deps.stdout.write(
      `  #${String(index + 1)}  ${role}${labelText}  storage=${ref.storage}  ` +
        `host=${ref.oauthHost ?? '(default)'}  fingerprint=${fingerprintOAuthRef(ref)}\n`,
    );
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
    deps.stderr.write(`Provider "${providerId}" not found.\n`);
    deps.exit(1);
  }

  const refs = providerOAuthRefs(provider);
  if (index < 1 || index > refs.length) {
    deps.stderr.write(
      `OAuth account ref #${String(index)} not found for provider "${providerId}". ` +
        `Run \`kimi provider oauth list ${providerId}\`.\n`,
    );
    deps.exit(1);
  }

  const nextRefs = refs.filter((_, refIndex) => refIndex !== index - 1);
  await harness.setConfig({
    providers: {
      ...config.providers,
      [providerId]: rewriteProviderOAuthRefs(provider, nextRefs),
    },
  });
  deps.stdout.write(`Removed OAuth account ref #${String(index)} from provider "${providerId}".\n`);
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
    deps.stderr.write(`Provider "${providerId}" not found.\n`);
    deps.exit(1);
  }
  if (providerHasApiKeySource(provider)) {
    deps.stderr.write(
      `Provider "${providerId}" uses API keys; OAuth accounts cannot be promoted.\n`,
    );
    deps.exit(1);
  }

  const refs = providerOAuthRefs(provider);
  if (index < 1 || index > refs.length) {
    deps.stderr.write(
      `OAuth account ref #${String(index)} not found for provider "${providerId}". ` +
        `Run \`kimi provider oauth list ${providerId}\`.\n`,
    );
    deps.exit(1);
  }
  if (index === 1) {
    deps.stdout.write(`OAuth account ref #1 is already primary for provider "${providerId}".\n`);
    return;
  }

  await harness.setConfig({
    providers: {
      ...config.providers,
      [providerId]: rewriteProviderOAuthRefs(provider, promoteSlot(refs, index - 1)),
    },
  });
  deps.stdout.write(
    `Promoted OAuth account ref #${String(index)} to primary for provider "${providerId}".\n`,
  );
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
    deps.stderr.write(`Provider "${providerId}" not found.\n`);
    deps.exit(1);
  }
  if (providerHasApiKeySource(provider)) {
    deps.stderr.write(
      `Provider "${providerId}" uses API keys; OAuth account refs cannot be labeled.\n`,
    );
    deps.exit(1);
  }

  const refs = providerOAuthRefs(provider);
  if (index < 1 || index > refs.length) {
    deps.stderr.write(
      `OAuth account ref #${String(index)} not found for provider "${providerId}". ` +
        `Run \`kimi provider oauth list ${providerId}\`.\n`,
    );
    deps.exit(1);
  }
  const duplicate = refs.find(
    (ref, refIndex) =>
      refIndex !== index - 1 && ref.label?.toLowerCase() === label.toLowerCase(),
  );
  if (duplicate !== undefined) {
    deps.stderr.write(`OAuth label "${label}" is already used by another account ref.\n`);
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
  deps.stdout.write(
    `Labeled OAuth account ref #${String(index)} for provider "${providerId}" as "${label}".\n`,
  );
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
    deps.stderr.write(`Provider "${providerId}" not found.\n`);
    deps.exit(1);
  }
  if (providerHasApiKeySource(provider)) {
    deps.stderr.write(
      `Provider "${providerId}" uses API keys; OAuth account refs cannot be unlabeled.\n`,
    );
    deps.exit(1);
  }

  const refs = providerOAuthRefs(provider);
  if (index < 1 || index > refs.length) {
    deps.stderr.write(
      `OAuth account ref #${String(index)} not found for provider "${providerId}". ` +
        `Run \`kimi provider oauth list ${providerId}\`.\n`,
    );
    deps.exit(1);
  }
  if (refs[index - 1]?.label === undefined) {
    deps.stdout.write(
      `OAuth account ref #${String(index)} for provider "${providerId}" has no label.\n`,
    );
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
  deps.stdout.write(
    `Removed label from OAuth account ref #${String(index)} for provider "${providerId}".\n`,
  );
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
    deps.stderr.write(`Provider "${providerId}" not found.\n`);
    deps.exit(1);
  }

  await harness.setConfig({
    providers: {
      ...config.providers,
      [providerId]: rewriteProviderOAuthRefs(provider, []),
    },
  });
  deps.stdout.write(`Removed all OAuth account refs from provider "${providerId}".\n`);
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
    deps.stderr.write(`Model "${modelAlias}" not found.\n`);
    deps.exit(1);
  }

  deps.stdout.write(`Route for ${modelAlias}:\n`);
  deps.stdout.write(`  provider: ${model.provider}\n`);
  deps.stdout.write(`  model: ${model.model}\n`);
  deps.stdout.write(`  fallback_models: ${(model.fallbackModels ?? []).join(', ') || '(none)'}\n`);
  deps.stdout.write(`  strategy: ${model.routing?.strategy ?? '(auto)'}\n`);
  deps.stdout.write(`  weights: ${formatRouteWeights(model.routing?.weights)}\n`);
  deps.stdout.write(
    `  session_affinity: ${model.routing?.sessionAffinity === true ? 'on' : 'off'}\n`,
  );
  deps.stdout.write(
    `  preferred_credential: ${model.routing?.preferredCredential ?? '(none)'}\n`,
  );
  deps.stdout.write(
    `  cooldown_ms: ${
      model.routing?.cooldownMs === undefined ? '(default)' : String(model.routing.cooldownMs)
    }\n`,
  );
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
    deps.stderr.write(
      'Nothing to update. Pass --fallback, --strategy, --cooldown-ms, --weights, --session-affinity, or --prefer-credential.\n',
    );
    deps.exit(1);
  }

  const harness = deps.getHarness();
  await harness.ensureConfigFile();
  const config = await harness.getConfig();
  const models = config.models ?? {};
  const model = models[modelAlias];
  if (model === undefined) {
    deps.stderr.write(`Model "${modelAlias}" not found.\n`);
    deps.exit(1);
  }

  const fallbackModels =
    opts.fallback === undefined ? model.fallbackModels : parseFallbackModels(opts.fallback);
  const missingFallback = fallbackModels?.find((alias) => models[alias] === undefined);
  if (missingFallback !== undefined) {
    deps.stderr.write(`Fallback model "${missingFallback}" is not configured.\n`);
    deps.exit(1);
  }
  if (fallbackModels?.includes(modelAlias) === true) {
    deps.stderr.write('A model cannot list itself as a fallback.\n');
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
  deps.stdout.write(`Updated route for model "${modelAlias}".\n`);
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
    deps.stderr.write(`Model "${modelAlias}" not found.\n`);
    deps.exit(1);
  }

  const fallbackModels =
    opts.fallback === undefined ? model.fallbackModels : parseFallbackModels(opts.fallback);
  const missingFallback = fallbackModels?.find((alias) => models[alias] === undefined);
  if (missingFallback !== undefined) {
    deps.stderr.write(`Fallback model "${missingFallback}" is not configured.\n`);
    deps.exit(1);
  }
  if (fallbackModels?.includes(modelAlias) === true) {
    deps.stderr.write('A model cannot list itself as a fallback.\n');
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
  const nextConfig: KimiConfig = {
    ...config,
    models: {
      ...models,
      [modelAlias]: nextModel,
    },
  };
  const preview = buildRoutePreview(nextConfig, modelAlias);
  if (preview.candidates.length < 2) {
    deps.stderr.write(
      `Auto route for model "${modelAlias}" needs at least two candidates. Add another API key/OAuth account or pass --fallback <alias>.\n`,
    );
    deps.exit(1);
  }

  await harness.setConfig({ models: nextConfig.models });
  deps.stdout.write(
    `Enabled auto route for model "${modelAlias}" with ${String(preview.candidates.length)} candidates.\n`,
  );
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
    deps.stdout.write(`No provider route health to reset for session "${sessionId}".\n`);
    return;
  }
  deps.stdout.write(
    `Reset provider route health for "${status.modelAlias}" in session "${sessionId}" (${status.candidates.length} candidates).\n`,
  );
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
    deps.stdout.write(`No provider route health for session "${sessionId}".\n`);
    return;
  }
  deps.stdout.write(formatProviderRouteStatus(routeStatus, Date.now()));
}

type ConfigModelAlias = NonNullable<KimiConfig['models']>[string];

function formatProviderRouteStatus(status: ProviderRouteStatus, now: number): string {
  const affinityText = status.sessionAffinity === true ? ', affinity=on' : '';
  const preferredText =
    status.preferredCredential === undefined ? '' : `, preferred=${status.preferredCredential}`;
  const lines = [
    `Route health for ${status.modelAlias} (strategy=${status.strategy}${affinityText}${preferredText}):`,
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
    ? `cooling ${formatDuration(candidate.cooldownUntil! - now)}`
    : 'ready';
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
  config: KimiConfig,
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
      message: 'No providers are configured.',
    });
  }
  if (Object.keys(models).length === 0) {
    addDoctorIssue(issues, {
      level: 'warning',
      code: 'no_models',
      message: 'No model aliases are configured.',
    });
  }
  if (config.defaultModel !== undefined && models[config.defaultModel] === undefined) {
    addDoctorIssue(issues, {
      level: 'error',
      code: 'missing_default_model',
      message: `Default model "${config.defaultModel}" is not configured.`,
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
  provider: KimiConfig['providers'][string],
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
      message: 'Provider has no API key, OAuth account, keyless marker, or supported service account source.',
      providerId,
    });
  }

  if (hasApiKey && hasOAuth) {
    addDoctorIssue(issues, {
      level: 'warning',
      code: 'mixed_auth',
      message: 'Provider has both API key sources and OAuth refs; API key sources take precedence.',
      providerId,
    });
  }

  for (const ref of providerEnvReferences(provider)) {
    if (nonEmptyString(env[ref.envVar]) === undefined) {
      addDoctorIssue(issues, {
        level: 'error',
        code: 'missing_env',
        message: `Environment variable "${ref.envVar}" is referenced by ${ref.source} but is not set.`,
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
  provider: KimiConfig['providers'][string],
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
        message: `${source} has an empty api_key.`,
        providerId,
      });
      continue;
    }
    const label = nonEmptyString(credential.label);
    if (label !== undefined && !isValidCredentialLabel(label)) {
      addDoctorIssue(issues, {
        level: 'error',
        code: 'invalid_credential_label',
        message:
          `${source} label must use only letters, numbers, dot, underscore, or dash.`,
        providerId,
      });
    }
    const baseUrl = nonEmptyString(credential.baseUrl);
    if (baseUrl !== undefined && parseEnvReference(baseUrl) === undefined && !isHttpUrl(baseUrl)) {
      addDoctorIssue(issues, {
        level: 'error',
        code: 'invalid_credential_base_url',
        message: `${source} base_url must start with http:// or https://.`,
        providerId,
      });
    }
    const key = `${apiKey}\n${baseUrl ?? ''}`;
    if (seen.has(key)) {
      addDoctorIssue(issues, {
        level: 'warning',
        code: 'duplicate_credential',
        message: `${source} duplicates an earlier API key/base_url slot and will be ignored.`,
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
        message:
          `credentials[${String(index + 1)}] label duplicates an earlier credential label.`,
        providerId,
      });
    }
    seenLabels.add(normalized);
  }
}

function collectProviderOAuthDoctorIssues(
  issues: ProviderDoctorIssue[],
  providerId: string,
  provider: KimiConfig['providers'][string],
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
        message:
          `OAuth account ref #${String(index + 1)} label must use only letters, numbers, dot, underscore, or dash.`,
        providerId,
      });
    }
    const normalized = label.toLowerCase();
    if (seenLabels.has(normalized)) {
      addDoctorIssue(issues, {
        level: 'error',
        code: 'duplicate_oauth_label',
        message:
          `OAuth account ref #${String(index + 1)} label duplicates an earlier OAuth label.`,
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
  config: KimiConfig,
): void {
  const providerName = model.provider ?? config.defaultProvider;
  if (providerName === undefined) {
    addDoctorIssue(issues, {
      level: 'error',
      code: 'missing_model_provider',
      message: 'Model does not define a provider and no default provider is configured.',
      modelAlias,
    });
  } else if (config.providers[providerName] === undefined) {
    addDoctorIssue(issues, {
      level: 'error',
      code: 'missing_model_provider',
      message: `Model points at missing provider "${providerName}".`,
      modelAlias,
    });
  }

  for (const fallbackAlias of model.fallbackModels ?? []) {
    if (fallbackAlias === modelAlias) {
      addDoctorIssue(issues, {
        level: 'error',
        code: 'self_fallback_model',
        message: 'Model lists itself as a fallback.',
        modelAlias,
      });
    } else if (config.models?.[fallbackAlias] === undefined) {
      addDoctorIssue(issues, {
        level: 'error',
        code: 'missing_fallback_model',
        message: `Fallback model "${fallbackAlias}" is not configured.`,
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
        message: `Route weight for "${weightAlias}" is ignored because it is not the model or a fallback.`,
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
        message:
          `Preferred credential "${preferredCredential}" is not one of the expanded route candidates.`,
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
  provider: KimiConfig['providers'][string],
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
          `Provider doctor: ok (providers=${String(report.providerCount)}, models=${String(report.modelCount)}, routes=${String(report.routeCount)}, candidates=${String(report.candidateCount)})`,
        ]
      : [
          `Provider doctor: ${String(report.errorCount)} error${report.errorCount === 1 ? '' : 's'}, ${String(report.warningCount)} warning${report.warningCount === 1 ? '' : 's'}`,
          ...report.issues.map(formatProviderDoctorIssue),
        ];
  return `${lines.join('\n')}\n`;
}

function formatProviderDoctorIssue(issue: ProviderDoctorIssue): string {
  const scope = [
    issue.providerId === undefined ? undefined : `provider=${issue.providerId}`,
    issue.modelAlias === undefined ? undefined : `model=${issue.modelAlias}`,
    issue.envVar === undefined ? undefined : `env=${issue.envVar}`,
  ].filter((part): part is string => part !== undefined);
  const scopeText = scope.length === 0 ? '' : ` ${scope.join(' ')}`;
  return `  [${issue.level}] ${issue.code}${scopeText}: ${issue.message}`;
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

function buildRoutePreview(config: KimiConfig, modelAlias: string): RoutePreview {
  const models = config.models ?? {};
  const model = models[modelAlias];
  if (model === undefined) {
    throw new Error(`Model "${modelAlias}" not found.`);
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
  config: KimiConfig,
  providerId: string,
): ProviderAutoRouteResult {
  const models = config.models ?? {};
  const nextModels: NonNullable<KimiConfig['models']> = { ...models };
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
    const previewConfig: KimiConfig = {
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
    deps.stdout.write(
      `No model aliases for provider "${providerId}" had enough route candidates to auto-route.\n`,
    );
    return;
  }
  deps.stdout.write(
    `Enabled auto route for ${String(result.aliases.length)} model ` +
      `alias${result.aliases.length === 1 ? '' : 'es'}: ${result.aliases.join(', ')}.\n`,
  );
}

function routePreviewCandidatesForAlias(
  config: KimiConfig,
  modelAlias: string,
  weight: number | undefined,
): RoutePreviewCandidate[] {
  const model = config.models?.[modelAlias];
  if (model === undefined) {
    throw new Error(`Fallback model "${modelAlias}" is not configured.`);
  }
  const providerName = model.provider ?? config.defaultProvider;
  if (providerName === undefined) {
    throw new Error(`Model "${modelAlias}" must define a provider.`);
  }
  const provider = config.providers[providerName];
  if (provider === undefined) {
    throw new Error(`Provider "${providerName}" for model "${modelAlias}" is not configured.`);
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
  provider: KimiConfig['providers'][string],
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
  provider: KimiConfig['providers'][string],
): string | undefined {
  const explicit = credentialSourceLabel(provider.apiKey, 'api_key');
  if (explicit !== undefined) return explicit;
  const envKey = providerDefaultApiKeyEnv(provider.type);
  if (envKey === undefined) return undefined;
  return credentialSourceLabel(provider.env?.[envKey], `provider.env.${envKey}`);
}

function providerDefaultApiKeyEnv(
  type: KimiConfig['providers'][string]['type'],
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

function providerFallbackCredentialSource(provider: KimiConfig['providers'][string]): string {
  if (provider.type === 'vertexai' && hasVertexAIServiceAccountSource(provider)) {
    return 'google_cloud';
  }
  if (providerHasOAuth(provider)) return 'oauth';
  return 'none';
}

function providerFallbackAuth(
  provider: KimiConfig['providers'][string],
): RoutePreviewCandidate['auth'] {
  if (provider.type === 'vertexai' && hasVertexAIServiceAccountSource(provider)) {
    return 'vertexai_service_account';
  }
  if (providerHasOAuth(provider)) return 'oauth';
  return 'none';
}

function providerOAuthCredentialSources(
  provider: KimiConfig['providers'][string],
): OAuthCredentialPreview[] {
  const seen = new Set<string>();
  const sources: OAuthCredentialPreview[] = [];
  const append = (
    oauth: KimiConfig['providers'][string]['oauth'] | undefined,
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

function providerHasOAuth(provider: KimiConfig['providers'][string]): boolean {
  return provider.oauth !== undefined || (provider.oauths ?? []).length > 0;
}

function hasVertexAIServiceAccountSource(provider: KimiConfig['providers'][string]): boolean {
  return (
    provider.type === 'vertexai' &&
    nonEmptyString(provider.env?.['GOOGLE_CLOUD_PROJECT']) !== undefined &&
    nonEmptyString(provider.env?.['GOOGLE_CLOUD_LOCATION']) !== undefined
  );
}

function formatRoutePreview(preview: RoutePreview): string {
  const lines = [
    `Route preview for ${preview.modelAlias}:`,
    `  active: ${preview.active ? 'yes' : 'no'}`,
    `  strategy: ${preview.strategy}`,
    `  fallback_models: ${preview.fallbackModels.length === 0 ? '(none)' : preview.fallbackModels.join(', ')}`,
    `  session_affinity: ${preview.sessionAffinity === true ? 'on' : 'off'}`,
    `  preferred_credential: ${preview.preferredCredential ?? '(none)'}`,
    '  candidates:',
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
      deps.stderr.write(`Provider "${providerId}" not found in catalog at ${url}.\n`);
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
      deps.stdout.write(`Provider "${providerId}" lists no usable models in this catalog.\n`);
      return;
    }
    deps.stdout.write(`${entry.name ?? providerId} (${providerId})\n`);
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
      deps.stdout.write(`  ${model.id}  ctx=${ctx}${capLabel}\n`);
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
      deps.stdout.write(`No providers in catalog match "${filter}".\n`);
    } else {
      deps.stdout.write('Catalog is empty.\n');
    }
    return;
  }

  for (const [id, entry] of entries) {
    const modelCount = entry.models === undefined ? 0 : Object.keys(entry.models).length;
    const wire = inferWireType(entry) ?? '?';
    deps.stdout.write(
      `${id}  wire=${wire}  models=${String(modelCount)}  ${entry.name ?? ''}\n`,
    );
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
    deps.stderr.write(
      'Missing API key. Pass --api-key <key>, --api-key-env <name>, or set KIMI_REGISTRY_API_KEY.\n',
    );
    deps.exit(1);
  }

  const url = opts.url ?? DEFAULT_CATALOG_URL;
  const catalog = await loadCatalogOrExit(deps, url);

  const entry = catalog[providerId];
  if (entry === undefined) {
    deps.stderr.write(`Provider "${providerId}" not found in catalog at ${url}.\n`);
    deps.exit(1);
  }

  const wire = inferWireType(entry);
  if (wire === undefined) {
    deps.stderr.write(`Provider "${providerId}" has an unsupported wire type in the catalog.\n`);
    deps.exit(1);
  }

  const models = catalogProviderModels(entry);
  if (models.length === 0) {
    deps.stderr.write(`Provider "${providerId}" lists no usable models in this catalog.\n`);
    deps.exit(1);
  }

  if (opts.defaultModel !== undefined && !models.some((m) => m.id === opts.defaultModel)) {
    deps.stderr.write(
      `Model "${opts.defaultModel}" is not in provider "${providerId}". Run "kimi provider catalog list ${providerId}" to see available ids.\n`,
    );
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
  deps.stdout.write(
    `Imported ${displayName} (${providerId}) with ${String(models.length)} model${models.length === 1 ? '' : 's'} from ${url}.\n`,
  );
  if (opts.defaultModel !== undefined) {
    deps.stdout.write(`Default model set to ${providerId}/${opts.defaultModel}.\n`);
  }
}

async function loadCatalogOrExit(deps: ProviderDeps, url: string): Promise<Catalog> {
  try {
    return await fetchCatalog(url);
  } catch (error) {
    const suffix = error instanceof CatalogFetchError ? ` (HTTP ${String(error.status)})` : '';
    deps.stderr.write(`Failed to fetch catalog from ${url}${suffix}: ${errorMessage(error)}\n`);
    deps.exit(1);
  }
}

export function registerProviderCommand(parent: Command, deps?: Partial<ProviderDeps>): void {
  const provider = parent
    .command('provider')
    .description('Manage LLM providers non-interactively.')
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
    .description('Import every provider listed in a custom registry (api.json).')
    .option('--api-key <key>', 'Registry API key. Falls back to KIMI_REGISTRY_API_KEY.')
    .action(async (url: string, options: { apiKey?: string }) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleProviderAdd(resolved, url, { apiKey: options.apiKey }));
    });

  provider
    .command('remove <providerId>')
    .description('Remove a provider and every model alias that referenced it.')
    .action(async (providerId: string) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleProviderRemove(resolved, providerId));
    });

  provider
    .command('list')
    .description('Show configured providers and their model counts.')
    .option('--json', 'Emit the raw providers/models config as JSON.', false)
    .action(async (options: { json?: boolean }) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleProviderList(resolved, { json: options.json === true }));
    });

  provider
    .command('doctor')
    .description('Validate provider auth, environment refs, and routes without exposing secrets.')
    .option('--json', 'Emit provider diagnostics as JSON.', false)
    .action(async (options: { json?: boolean }) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () =>
        handleProviderDoctor(resolved, { json: options.json === true }),
      );
    });

  provider
    .command('use <modelAlias>')
    .description('Set the default model alias for future runs.')
    .action(async (modelAlias: string) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleProviderUse(resolved, modelAlias));
    });

  const custom = provider
    .command('custom')
    .description('Add direct custom endpoints without an api.json registry.');

  custom
    .command('add <providerId>')
    .description('Add an OpenAI-compatible or supported direct custom endpoint.')
    .requiredOption('--base-url <url>', 'Endpoint base URL, for example http://localhost:11434/v1.')
    .requiredOption('--model <modelId>', 'Upstream model id to send to the endpoint.')
    .option('--api-key <key>', 'Provider API key. Falls back to KIMI_PROVIDER_API_KEY.')
    .option('--api-key-env <name>', 'Store {env:NAME} instead of a raw provider API key.')
    .option(
      '--keyless',
      'Use a placeholder key for local endpoints that do not require auth.',
      false,
    )
    .option('--alias <alias>', 'Model alias to create. Defaults to <providerId>/<modelId>.')
    .option('--type <type>', 'Provider wire type. Defaults to openai.')
    .option(
      '--context <tokens>',
      `Context window. Defaults to ${String(DEFAULT_CUSTOM_ENDPOINT_CONTEXT_SIZE)}.`,
    )
    .option('--output <tokens>', 'Max output tokens for this model.')
    .option('--display-name <name>', 'Friendly model name shown in selectors.')
    .option('--thinking', 'Mark the model as thinking-capable.', false)
    .option('--set-default', 'Make the added model the default model.', false)
    .action(async (providerId: string, options: CustomAddOptions) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleProviderCustomAdd(resolved, providerId, options));
    });

  const key = provider
    .command('key')
    .description('Manage API keys for configured providers.');

  key
    .command('add <providerId>')
    .description('Add an API key to a configured provider for fallback/load balancing.')
    .option('--api-key <key>', 'Provider API key. Falls back to KIMI_PROVIDER_API_KEY.')
    .option('--api-keys <keys>', 'Comma-separated provider API keys to add in one write.')
    .option('--api-key-env <name>', 'Store {env:NAME} instead of a raw provider API key.')
    .option('--api-key-envs <names>', 'Comma-separated env var names to store as {env:NAME} refs.')
    .option('--base-url <url>', 'Per-credential endpoint override for the added key(s).')
    .option('--label <label>', 'Friendly label for one added key, e.g. work or account-1.')
    .option('--labels <labels>', 'Comma-separated labels for bulk key adds.')
    .option('--rpm <count>', 'Local requests-per-minute limit for the added key(s).')
    .option('--tpm <tokens>', 'Local tokens-per-minute limit for the added key(s).')
    .option('--auto-route', 'Enable auto routing for model aliases that use this provider.')
    .action(async (providerId: string, options: KeyAddOptions) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleProviderKeyAdd(resolved, providerId, options));
    });

  key
    .command('list <providerId>')
    .description('List configured API key slots without printing secret values.')
    .action(async (providerId: string) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleProviderKeyList(resolved, providerId));
    });

  key
    .command('remove <providerId> <index>')
    .description('Remove one configured API key by its 1-based slot number.')
    .action(async (providerId: string, index: string) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleProviderKeyRemove(resolved, providerId, index));
    });

  key
    .command('promote <providerId> <index>')
    .description('Move one configured API key slot to primary without printing secret values.')
    .action(async (providerId: string, index: string) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleProviderKeyPromote(resolved, providerId, index));
    });

  key
    .command('label <providerId> <index> <label>')
    .description('Set a friendly label on one configured API key slot.')
    .action(async (providerId: string, index: string, label: string) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () =>
        handleProviderKeyLabel(resolved, providerId, index, label),
      );
    });

  key
    .command('unlabel <providerId> <index>')
    .description('Remove the friendly label from one configured API key slot.')
    .action(async (providerId: string, index: string) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleProviderKeyUnlabel(resolved, providerId, index));
    });

  key
    .command('limit <providerId> <index>')
    .description('Set or clear local RPM/TPM limits on one API key slot.')
    .option('--rpm <count>', 'Local requests-per-minute limit.')
    .option('--tpm <tokens>', 'Local tokens-per-minute limit.')
    .option('--clear', 'Remove local RPM/TPM limits from this key.', false)
    .action(async (providerId: string, index: string, options: KeyLimitOptions) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () =>
        handleProviderKeyLimit(resolved, providerId, index, options),
      );
    });

  key
    .command('clear <providerId>')
    .description('Remove every configured API key from a provider.')
    .action(async (providerId: string) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleProviderKeyClear(resolved, providerId));
    });

  const oauth = provider
    .command('oauth')
    .description('Manage OAuth account refs for configured providers.');

  oauth
    .command('add <providerId>')
    .description('Add an OAuth account ref to a configured provider for fallback/load balancing.')
    .requiredOption('--key <key>', 'OAuth credential storage key to reference.')
    .option('--storage <storage>', 'OAuth storage backend: file or keyring. Defaults to file.')
    .option('--oauth-host <host>', 'OAuth host override for providers with multiple auth hosts.')
    .option('--label <label>', 'Friendly label for this OAuth account ref.')
    .option('--auto-route', 'Enable auto routing for model aliases that use this provider.')
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
    .description('List configured OAuth account ref slots without printing storage keys.')
    .action(async (providerId: string) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleProviderOAuthList(resolved, providerId));
    });

  oauth
    .command('remove <providerId> <index>')
    .description('Remove one configured OAuth account ref by its 1-based slot number.')
    .action(async (providerId: string, index: string) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleProviderOAuthRemove(resolved, providerId, index));
    });

  oauth
    .command('promote <providerId> <index>')
    .description('Move one configured OAuth account ref slot to primary without printing storage keys.')
    .action(async (providerId: string, index: string) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleProviderOAuthPromote(resolved, providerId, index));
    });

  oauth
    .command('label <providerId> <index> <label>')
    .description('Set a friendly label on one OAuth account ref slot.')
    .action(async (providerId: string, index: string, label: string) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () =>
        handleProviderOAuthLabel(resolved, providerId, index, label),
      );
    });

  oauth
    .command('unlabel <providerId> <index>')
    .description('Remove the friendly label from one OAuth account ref slot.')
    .action(async (providerId: string, index: string) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleProviderOAuthUnlabel(resolved, providerId, index));
    });

  oauth
    .command('clear <providerId>')
    .description('Remove every configured OAuth account ref from a provider.')
    .action(async (providerId: string) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleProviderOAuthClear(resolved, providerId));
    });

  const route = provider
    .command('route')
    .description('Manage model fallback and load-balancing routes.');

  route
    .command('show <modelAlias>')
    .description('Show fallback routing config for a model alias.')
    .action(async (modelAlias: string) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleProviderRouteShow(resolved, modelAlias));
    });

  route
    .command('preview <modelAlias>')
    .description('Preview expanded route candidates without exposing secret values.')
    .option('--json', 'Emit expanded route candidates as JSON.', false)
    .action(async (modelAlias: string, options: { json?: boolean }) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () =>
        handleProviderRoutePreview(resolved, modelAlias, { json: options.json === true }),
      );
    });

  route
    .command('auto <modelAlias>')
    .description('Enable smart auto routing when a model has a credential pool or fallbacks.')
    .option('--fallback <aliases>', 'Comma-separated fallback model aliases. Empty string clears.')
    .option('--cooldown-ms <ms>', 'Cooldown after rate/auth/quota failures.')
    .option(
      '--session-affinity <mode>',
      'Pin a session to the first successful route candidate: on or off. Defaults to on.',
    )
    .option(
      '--prefer-credential <label>',
      'Prefer a credential label, e.g. api_key:2 or primary:api_key:2. Empty string clears.',
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
    .description('Set fallback routing config for a model alias.')
    .option('--fallback <aliases>', 'Comma-separated fallback model aliases. Empty string clears.')
      .option(
        '--strategy <strategy>',
        'Routing strategy: auto, fallback, fill_first, round_robin, weighted_round_robin, least_used, lowest_latency, rate_limit_aware, or random.',
      )
      .option('--cooldown-ms <ms>', 'Cooldown after rate/auth/quota failures.')
      .option('--weights <aliases>', 'Comma-separated model weights, e.g. primary=3,backup=1. Empty string clears.')
      .option(
        '--session-affinity <mode>',
        'Pin a session to the first successful route candidate: on or off.',
      )
      .option(
        '--prefer-credential <label>',
        'Prefer a credential label, e.g. api_key:2 or primary:api_key:2. Empty string clears.',
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
    .description('Reset runtime route cooldown and health counters for a session.')
    .action(async (sessionId: string) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () => handleProviderRouteReset(resolved, sessionId));
    });

  route
    .command('status <sessionId>')
    .description('Show runtime route health, cooldowns, and counters for a session.')
    .option('--json', 'Emit route health as JSON.', false)
    .action(async (sessionId: string, options: { json?: boolean }) => {
      const resolved = resolveDeps(deps);
      await runAction(resolved, () =>
        handleProviderRouteStatus(resolved, sessionId, { json: options.json === true }),
      );
    });

  const catalog = provider
    .command('catalog')
    .description('Discover and import providers from the public models.dev catalog.');

  catalog
    .command('list [providerId]')
    .description('List providers in the catalog, or models when a providerId is given.')
    .option('--filter <substring>', 'Case-insensitive id/name substring filter.')
    .option('--url <url>', `Override catalog URL. Defaults to ${DEFAULT_CATALOG_URL}.`)
    .option('--json', 'Emit the matching catalog slice as JSON.', false)
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
    .description('Import a known provider from the catalog by id.')
    .option('--api-key <key>', 'API key for the provider. Falls back to KIMI_REGISTRY_API_KEY.')
    .option('--api-key-env <name>', 'Store {env:NAME} instead of a raw provider API key.')
    .option('--default-model <modelId>', 'Mark the imported model as default_model after import.')
    .option('--url <url>', `Override catalog URL. Defaults to ${DEFAULT_CATALOG_URL}.`)
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
  let harness: KimiHarness | undefined;
  const identity = createKimiCodeHostIdentity();
  return {
    getHarness:
      overrides.getHarness ??
      (() => {
        harness ??= createKimiHarness({ identity });
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
    deps.stderr.write('Pass either --api-key or --api-key-env, not both.\n');
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
    deps.stderr.write('Pass either --api-key or --api-key-env, not both.\n');
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
    deps.stderr.write(
      'Pass either raw API key options (--api-key/--api-keys) or environment reference options (--api-key-env/--api-key-envs), not both.\n',
    );
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
    deps.stderr.write('Pass either --label or --labels, not both.\n');
    deps.exit(1);
  }
  if (label !== undefined) {
    if (keyCount !== 1) {
      deps.stderr.write(
        '--label can only be used when adding one API key. Use --labels for bulk adds.\n',
      );
      deps.exit(1);
    }
    return [parseCredentialLabel(label, deps)];
  }
  if (labelsText === undefined) return Array.from({ length: keyCount }, () => undefined);

  const labels = labelsText.split(',').map((entry) => parseCredentialLabel(entry, deps));
  if (labels.length !== keyCount) {
    deps.stderr.write('The number of --labels entries must match the number of added API keys.\n');
    deps.exit(1);
  }
  const seen = new Set<string>();
  for (const value of labels) {
    const normalized = value.toLowerCase();
    if (seen.has(normalized)) {
      deps.stderr.write(`Duplicate credential label "${value}".\n`);
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
    deps.stderr.write(
      `Invalid credential label "${value}". Use only letters, numbers, dot, underscore, or dash.\n`,
    );
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
    deps.stderr.write(`Invalid environment variable name "${value}".\n`);
    deps.exit(1);
  }
  return name;
}

function addApiKeySlotsToProvider(
  provider: KimiConfig['providers'][string],
  slots: readonly ProviderApiKeySlot[],
): KimiConfig['providers'][string] | undefined {
  const currentSlots = providerApiKeySlots(provider);
  const nextSlots = uniqueApiKeySlots([...currentSlots, ...slots]);
  if (nextSlots.length === currentSlots.length) return undefined;
  return rewriteProviderApiKeySlots(provider, nextSlots);
}

function rewriteProviderApiKeySlots(
  provider: KimiConfig['providers'][string],
  slots: readonly ProviderApiKeySlot[],
): KimiConfig['providers'][string] {
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

function providerApiKeyCount(provider: KimiConfig['providers'][string]): number {
  return providerApiKeySlots(provider).length;
}

function providerApiKeySlots(provider: KimiConfig['providers'][string]): ProviderApiKeySlot[] {
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
  provider: KimiConfig['providers'][string],
  oauthRef: ConfigOAuthRef,
): KimiConfig['providers'][string] | undefined {
  const refs = providerOAuthRefs(provider);
  if (refs.some((ref) => sameOAuthRef(ref, oauthRef))) return undefined;
  return rewriteProviderOAuthRefs(provider, [...refs, oauthRef]);
}

function rewriteProviderOAuthRefs(
  provider: KimiConfig['providers'][string],
  refs: readonly ConfigOAuthRef[],
): KimiConfig['providers'][string] {
  const unique = uniqueOAuthRefs(refs);
  const { oauth: _oauth, oauths: _oauths, ...rest } = provider;
  if (unique.length === 0) return rest;
  return {
    ...rest,
    oauth: unique[0],
    oauths: unique.slice(1),
  };
}

function providerOAuthRefs(provider: KimiConfig['providers'][string]): ConfigOAuthRef[] {
  return uniqueOAuthRefs([
    ...(provider.oauth === undefined ? [] : [provider.oauth]),
    ...(provider.oauths ?? []),
  ]);
}

function promoteSlot<T>(values: readonly T[], index: number): T[] {
  return [values[index]!, ...values.slice(0, index), ...values.slice(index + 1)];
}

function uniqueOAuthRefs(refs: readonly ConfigOAuthRef[]): ConfigOAuthRef[] {
  const unique: ConfigOAuthRef[] = [];
  for (const ref of refs) {
    if (unique.some((existing) => sameOAuthRef(existing, ref))) continue;
    unique.push(ref);
  }
  return unique;
}

function sameOAuthRef(left: ConfigOAuthRef, right: ConfigOAuthRef): boolean {
  return (
    left.storage === right.storage &&
    left.key === right.key &&
    (left.oauthHost ?? '') === (right.oauthHost ?? '')
  );
}

function providerHasApiKeySource(provider: KimiConfig['providers'][string]): boolean {
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
  return /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(value);
}

function parseKeyIndex(indexText: string, deps: ProviderDeps): number {
  const index = Number(indexText);
  if (!Number.isInteger(index) || index < 1) {
    deps.stderr.write('API key index must be a positive integer.\n');
    deps.exit(1);
  }
  return index;
}

function parseOAuthIndex(indexText: string, deps: ProviderDeps): number {
  const index = Number(indexText);
  if (!Number.isInteger(index) || index < 1) {
    deps.stderr.write('OAuth account ref index must be a positive integer.\n');
    deps.exit(1);
  }
  return index;
}

function parseOAuthStorage(value: string, deps: ProviderDeps): ConfigOAuthRef['storage'] {
  if (value === 'file' || value === 'keyring') return value;
  deps.stderr.write('OAuth storage must be "file" or "keyring".\n');
  deps.exit(1);
}

function fingerprintOAuthRef(ref: ConfigOAuthRef): string {
  return createHash('sha256')
    .update(JSON.stringify([ref.storage, ref.key, ref.oauthHost ?? '']))
    .digest('hex')
    .slice(0, 12);
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
  deps.stderr.write(
    'Routing strategy must be "auto", "fallback", "fill_first", "round_robin", "weighted_round_robin", "least_used", "lowest_latency", "rate_limit_aware", or "random".\n',
  );
  deps.exit(1);
}

function parseCooldownMs(value: string, deps: ProviderDeps): number {
  const cooldownMs = Number(value);
  if (!Number.isInteger(cooldownMs) || cooldownMs < 0) {
    deps.stderr.write('Cooldown must be a non-negative integer number of milliseconds.\n');
    deps.exit(1);
  }
  return cooldownMs;
}

function parseSessionAffinity(value: string, deps: ProviderDeps): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'on' || normalized === 'true' || normalized === '1') return true;
  if (normalized === 'off' || normalized === 'false' || normalized === '0') return false;
  deps.stderr.write('Session affinity must be "on" or "off".\n');
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
      deps.stderr.write('Weights must use comma-separated alias=weight entries.\n');
      deps.exit(1);
    }
    const weight = Number(weightText);
    if (!Number.isInteger(weight) || weight <= 0) {
      deps.stderr.write('Route weights must be positive integers.\n');
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
      deps.stderr.write(
        `Route weight "${alias}" is not the model alias or one of its fallback models.\n`,
      );
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
  deps.stderr.write(
    `Preferred credential "${preferredCredential}" is not one of the route candidates. Run \`kimi provider route preview\` to inspect credential labels.\n`,
  );
  deps.exit(1);
}

function routeCandidateCredentialLabels(
  config: KimiConfig,
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
  if (weights === undefined || Object.keys(weights).length === 0) return '(none)';
  return Object.entries(weights)
    .map(([alias, weight]) => `${alias}=${String(weight)}`)
    .join(', ');
}

function parsePositiveInt(value: string, label: string, deps: ProviderDeps): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    deps.stderr.write(`${label} must be a positive integer.\n`);
    deps.exit(1);
  }
  return parsed;
}

function parseProviderType(
  value: string,
  deps: ProviderDeps,
): KimiConfig['providers'][string]['type'] {
  switch (value) {
    case 'anthropic':
    case 'openai':
    case 'kimi':
    case 'google-genai':
    case 'openai_responses':
    case 'vertexai':
      return value;
    default:
      deps.stderr.write(
        'Provider type must be one of: anthropic, openai, kimi, google-genai, ' +
          'openai_responses, vertexai.\n',
      );
      deps.exit(1);
  }
}

function asManaged(config: KimiConfig): ManagedKimiConfigShape {
  return config as unknown as ManagedKimiConfigShape;
}

function providerSourceLabel(provider: KimiConfig['providers'][string]): string {
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
