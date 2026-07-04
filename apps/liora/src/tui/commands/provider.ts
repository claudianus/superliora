import {
  applyCustomRegistryEntries,
  fetchCustomRegistry,
  type CustomRegistrySource,
  type ManagedKimiConfigShape,
} from '@superliora/oauth';
import {
  applyCatalogProvider,
  catalogBaseUrl,
  catalogProviderModels,
  CatalogFetchError,
  DEFAULT_CATALOG_URL,
  fetchCatalog,
  inferWireType,
  type Catalog,
  type ProviderConfig,
} from '@superliora/sdk';

import { ChoicePickerComponent } from '../components/dialogs/choice-picker';
import {
  CustomEndpointImportDialogComponent,
  type CustomEndpointImportResult,
} from '../components/dialogs/custom-endpoint-import';
import {
  CustomRegistryImportDialogComponent,
  type CustomRegistryImportResult,
} from '../components/dialogs/custom-registry-import';
import {
  ProviderManagerComponent,
  type ProviderManagerOptions,
} from '../components/dialogs/provider-manager';
import { TabbedModelSelectorComponent } from '../components/dialogs/tabbed-model-selector';
import { DEFAULT_OAUTH_PROVIDER_NAME } from '../constant/liora-tui';
import { formatErrorMessage } from '../utils/event-payload';
import {
  promptApiKey,
  promptCatalogProviderSelection,
} from './prompts';
import type { SlashCommandHost } from './dispatch';
import { applyCustomEndpointProvider } from '#/utils/custom-provider';

// ---------------------------------------------------------------------------
// /provider command
// ---------------------------------------------------------------------------

export async function handleProviderCommand(host: SlashCommandHost): Promise<void> {
  const options = buildProviderManagerOptions(host);
  const component = new ProviderManagerComponent(options);
  host.mountEditorReplacement(component);
}

function buildProviderManagerOptions(host: SlashCommandHost): ProviderManagerOptions {
  const activeProviderId =
    host.state.appState.availableModels[host.state.appState.model]?.provider;
  return {
    providers: host.state.appState.availableProviders,
    activeProviderId,
    onAdd: () => {
      void handleProviderAdd(host).catch((error: unknown) => {
        host.showError(`Add provider failed: ${formatErrorMessage(error)}`);
      });
    },
    onAddApiKey: (providerIds) => {
      void handleProviderManagerAddApiKey(host, providerIds).catch((error: unknown) => {
        host.showError(`Add API key failed: ${formatErrorMessage(error)}`);
      });
    },
    onRemoveApiKey: (providerIds) => {
      void handleProviderManagerRemoveApiKey(host, providerIds).catch((error: unknown) => {
        host.showError(`Remove API key failed: ${formatErrorMessage(error)}`);
      });
    },
    onDeleteSource: (providerIds) => {
      void handleProviderManagerDeleteSource(host, providerIds).catch((error: unknown) => {
        host.showError(`Remove provider failed: ${formatErrorMessage(error)}`);
      });
    },
    onClose: () => {
      host.restoreEditor();
    },
  };
}

async function handleProviderManagerAddApiKey(
  host: SlashCommandHost,
  providerIds: readonly string[],
): Promise<void> {
  if (providerIds.length === 0) {
    reopenProviderManager(host);
    return;
  }

  const config = await host.harness.getConfig();
  const providers = config.providers ?? {};
  const missing = providerIds.find((providerId) => providers[providerId] === undefined);
  if (missing !== undefined) {
    host.showError(`Provider "${missing}" not found.`);
    reopenProviderManager(host);
    return;
  }

  const oauthProvider = providerIds.find(
    (providerId) => providers[providerId]?.oauth !== undefined,
  );
  if (oauthProvider !== undefined) {
    host.showError(`Provider "${oauthProvider}" uses OAuth; API keys cannot be mixed into it.`);
    reopenProviderManager(host);
    return;
  }

  const label = providerIds.length === 1 ? providerIds[0]! : 'selected provider source';
  const apiKey = await promptApiKey(host, label, [
    'Saved as an additional key and used for automatic fallback/load balancing',
  ]);
  if (apiKey === undefined) {
    reopenProviderManager(host);
    return;
  }

  let changed = false;
  const nextProviders = { ...providers };
  for (const providerId of providerIds) {
    const provider = nextProviders[providerId];
    if (provider === undefined) continue;
    const nextProvider = addApiKeyToProvider(provider, apiKey);
    if (nextProvider !== undefined) {
      nextProviders[providerId] = nextProvider;
      changed = true;
    }
  }

  if (!changed) {
    host.showStatus('API key is already configured for this provider.');
    reopenProviderManager(host);
    return;
  }

  await host.harness.setConfig({ providers: nextProviders });
  await host.authFlow.refreshConfigAfterLogin();
  host.showStatus(
    providerIds.length === 1
      ? `Added API key to ${providerIds[0]}.`
      : `Added API key to ${String(providerIds.length)} providers.`,
    'success',
  );
  reopenProviderManager(host);
}

async function handleProviderManagerRemoveApiKey(
  host: SlashCommandHost,
  providerIds: readonly string[],
): Promise<void> {
  if (providerIds.length === 0) {
    reopenProviderManager(host);
    return;
  }

  const config = await host.harness.getConfig();
  const providers = config.providers ?? {};
  const missing = providerIds.find((providerId) => providers[providerId] === undefined);
  if (missing !== undefined) {
    host.showError(`Provider "${missing}" not found.`);
    reopenProviderManager(host);
    return;
  }

  const oauthProvider = providerIds.find(
    (providerId) => providers[providerId]?.oauth !== undefined,
  );
  if (oauthProvider !== undefined) {
    host.showError(`Provider "${oauthProvider}" uses OAuth; API keys cannot be removed from it.`);
    reopenProviderManager(host);
    return;
  }

  let changed = false;
  const nextProviders = { ...providers };
  for (const providerId of providerIds) {
    const provider = nextProviders[providerId];
    if (provider === undefined) continue;
    const keys = providerApiKeySlots(provider);
    if (keys.length === 0) continue;
    nextProviders[providerId] = rewriteProviderApiKeySlots(provider, keys.slice(0, -1));
    changed = true;
  }

  if (!changed) {
    host.showStatus('No configured API keys to remove.');
    reopenProviderManager(host);
    return;
  }

  await host.harness.setConfig({ providers: nextProviders });
  await host.authFlow.refreshConfigAfterLogin();
  host.showStatus(
    providerIds.length === 1
      ? `Removed newest API key from ${providerIds[0]}.`
      : `Removed newest API key from ${String(providerIds.length)} providers.`,
    'success',
  );
  reopenProviderManager(host);
}

async function handleProviderManagerDeleteSource(
  host: SlashCommandHost,
  providerIds: readonly string[],
): Promise<void> {
  for (const providerId of providerIds) {
    try {
      await handleProviderDelete(host, providerId);
    } catch (error) {
      const msg = formatErrorMessage(error);
      host.showError(`Failed to delete provider ${providerId}: ${msg}`);
    }
  }
  reopenProviderManager(host);
}

async function handleProviderDelete(host: SlashCommandHost, providerId: string): Promise<void> {
  if (providerId === DEFAULT_OAUTH_PROVIDER_NAME) {
    await host.harness.auth.logout(DEFAULT_OAUTH_PROVIDER_NAME);
    await host.authFlow.refreshConfigAfterLogout();
    await host.authFlow.clearActiveSessionAfterLogout();
    return;
  }

  const activeProvider =
    host.state.appState.availableModels[host.state.appState.model]?.provider;
  const config = await host.harness.removeProvider(providerId);
  if (activeProvider === providerId) {
    await host.authFlow.refreshConfigAfterLogout();
    await host.authFlow.clearActiveSessionAfterLogout();
  } else {
    host.setAppState({
      availableProviders: config.providers ?? {},
      availableModels: config.models ?? {},
    });
  }
}

function addApiKeyToProvider(
  provider: ProviderConfig,
  apiKey: string,
): ProviderConfig | undefined {
  const key = apiKey.trim();
  if (key.length === 0) return undefined;
  const existing = providerApiKeySlots(provider);
  if (existing.some((slot) => slot.apiKey === key && slot.baseUrl === undefined)) {
    return undefined;
  }
  const primary = nonEmptyString(provider.apiKey);
  if (primary === undefined && existing.length === 0) {
    return { ...provider, apiKey: key };
  }
  return { ...provider, apiKeys: [...(provider.apiKeys ?? []), key] };
}

interface ProviderApiKeySlot {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly label?: string;
}

function rewriteProviderApiKeySlots(
  provider: ProviderConfig,
  slots: readonly ProviderApiKeySlot[],
): ProviderConfig {
  const unique = uniqueApiKeySlots(slots);
  const hasObjectCredential = unique.some(
    (slot) => slot.baseUrl !== undefined || slot.label !== undefined,
  );
  const { apiKey: _apiKey, apiKeys: _apiKeys, credentials: _credentials, ...rest } = provider;
  if (unique.length === 0) {
    return { ...rest, apiKey: '', apiKeys: [], credentials: [] };
  }
  if (hasObjectCredential) {
    return {
      ...rest,
      apiKey: '',
      apiKeys: [],
      credentials: unique.map((slot) => ({
        apiKey: slot.apiKey,
        baseUrl: slot.baseUrl,
        label: slot.label,
      })),
    };
  }
  return {
    ...rest,
    apiKey: unique[0]?.apiKey ?? '',
    apiKeys: unique.slice(1).map((slot) => slot.apiKey),
    credentials: [],
  };
}

function providerApiKeySlots(provider: ProviderConfig): ProviderApiKeySlot[] {
  const slots: ProviderApiKeySlot[] = [];
  const primary = nonEmptyString(provider.apiKey);
  if (primary !== undefined) slots.push({ apiKey: primary });
  for (const key of provider.apiKeys ?? []) {
    const normalized = nonEmptyString(key);
    if (normalized !== undefined) slots.push({ apiKey: normalized });
  }
  for (const credential of provider.credentials ?? []) {
    const apiKey = nonEmptyString(credential.apiKey);
    if (apiKey === undefined) continue;
    slots.push({
      apiKey,
      baseUrl: nonEmptyString(credential.baseUrl),
      label: nonEmptyString(credential.label),
    });
  }
  return uniqueApiKeySlots(slots);
}

function uniqueApiKeySlots(slots: readonly ProviderApiKeySlot[]): ProviderApiKeySlot[] {
  const seen = new Set<string>();
  const unique: ProviderApiKeySlot[] = [];
  for (const slot of slots) {
    const apiKey = nonEmptyString(slot.apiKey);
    if (apiKey === undefined) continue;
    const baseUrl = nonEmptyString(slot.baseUrl);
    const key = `${apiKey}\n${baseUrl ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ apiKey, baseUrl, label: nonEmptyString(slot.label) });
  }
  return unique;
}

function nonEmptyString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

async function handleProviderAdd(host: SlashCommandHost): Promise<void> {
  const source = await promptProviderAddSource(host);
  if (source === undefined) {
    reopenProviderManager(host);
    return;
  }

  if (source === 'known') {
    await handleCatalogProviderAdd(host);
    return;
  }
  if (source === 'endpoint') {
    const handled = await handleCustomEndpointAddViaDialog(host);
    if (!handled) reopenProviderManager(host);
    return;
  }
  const handled = await handleCustomRegistryAddViaDialog(host);
  if (!handled) {
    reopenProviderManager(host);
  }
}

function reopenProviderManager(host: SlashCommandHost): void {
  const options = buildProviderManagerOptions(host);
  const component = new ProviderManagerComponent(options);
  host.mountEditorReplacement(component);
}

function promptProviderAddSource(
  host: SlashCommandHost,
): Promise<'known' | 'endpoint' | 'custom' | undefined> {
  return new Promise((resolve) => {
    const picker = new ChoicePickerComponent({
      title: 'Add provider',
      options: [
        { value: 'known', label: 'Known third-party provider' },
        {
          value: 'endpoint',
          label: 'Custom endpoint',
          description: 'OpenAI-compatible base URL, model id, and API key',
        },
        { value: 'custom', label: 'Custom registry (api.json)' },
      ],
      onSelect: (value) => {
        host.restoreEditor();
        resolve(
          value === 'known' || value === 'endpoint' || value === 'custom'
            ? value
            : undefined,
        );
      },
      onCancel: () => {
        host.restoreEditor();
        resolve(undefined);
      },
    });
    host.mountEditorReplacement(picker);
  });
}

async function handleCustomEndpointAddViaDialog(host: SlashCommandHost): Promise<boolean> {
  const value = await promptCustomEndpointImport(host);
  if (value === undefined) return false;

  try {
    const config = await host.harness.getConfig();
    const existingProvider = config.providers[value.providerId];
    if (existingProvider?.oauth !== undefined) {
      host.showError(`Provider "${value.providerId}" uses OAuth; choose a different provider id.`);
      return false;
    }
    const applied = applyCustomEndpointProvider(config, {
      providerId: value.providerId,
      baseUrl: value.baseUrl,
      modelId: value.modelId,
      apiKey: value.apiKey ?? 'no-key-required',
      maxContextSize: value.maxContextSize,
      setDefault: true,
    });
    await host.harness.setConfig({
      providers: config.providers,
      models: config.models,
      defaultModel: config.defaultModel,
    });
    await host.authFlow.refreshConfigAfterLogin();
    host.track('connect', { provider: applied.providerId, method: 'custom_endpoint' });
    host.showStatus(`Custom endpoint added: ${applied.modelAlias}`, 'success');
    return true;
  } catch (error) {
    host.showError(`Failed to add custom endpoint: ${formatErrorMessage(error)}`);
    return false;
  }
}

async function handleCatalogProviderAdd(host: SlashCommandHost): Promise<void> {
  const controller = new AbortController();
  const cancel = (): void => {
    controller.abort();
  };
  host.cancelInFlight = cancel;

  const spinner = host.showLoginProgressSpinner(`Fetching catalog from ${DEFAULT_CATALOG_URL}`);
  let catalog: Catalog | undefined;
  try {
    catalog = await fetchCatalog(DEFAULT_CATALOG_URL, controller.signal);
    spinner.stop({ ok: true, label: 'Catalog loaded.' });
  } catch (error) {
    if (controller.signal.aborted) {
      spinner.stop({ ok: false, label: 'Aborted.' });
    } else {
      const hint = error instanceof CatalogFetchError ? ` (HTTP ${error.status})` : '';
      spinner.stop({ ok: false, label: 'Failed to load catalog.' });
      host.showError(`Failed to fetch catalog${hint}: ${formatErrorMessage(error)}`);
    }
  } finally {
    if (host.cancelInFlight === cancel) host.cancelInFlight = undefined;
  }

  if (catalog === undefined) return;

  const providerId = await promptCatalogProviderSelection(host, catalog);
  if (providerId === undefined) return;
  const entry = catalog[providerId];
  if (entry === undefined) return;

  const models = catalogProviderModels(entry);
  if (models.length === 0) {
    host.showError(`Provider "${providerId}" has no usable models in this catalog.`);
    return;
  }

  const apiKey = await promptApiKey(host, entry.name ?? providerId);
  if (apiKey === undefined) return;

  const wire = inferWireType(entry);
  if (wire === undefined) {
    host.showError(`Provider "${providerId}" has unsupported wire type.`);
    return;
  }
  const baseUrl = catalogBaseUrl(entry, wire);

  // Persist the provider and all its models immediately after the api key is
  // entered. The model selector that follows is just a convenience to pick the
  // default model; ESC leaves the provider in place without a default selection.
  const existingConfig = await host.harness.getConfig();
  if (existingConfig.providers[providerId] !== undefined) {
    await host.harness.removeProvider(providerId);
  }

  const config = await host.harness.getConfig();
  applyCatalogProvider(config, {
    providerId,
    wire,
    baseUrl,
    apiKey,
    models,
    selectedModelId: '', // no default yet; user picks in the model selector
    thinking: false,    // will be resolved by the model selector
  });

  await host.harness.setConfig({
    providers: config.providers,
    models: config.models,
  });

  await host.authFlow.refreshConfigAfterLogin();
  host.track('connect', { provider: providerId, method: 'catalog' });
  host.showStatus(`Provider added: ${entry.name ?? providerId}`);

  // Build a merged model dictionary that includes existing models plus the
  // newly-persisted provider's models, so the tabbed selector shows every
  // provider's tab (the new provider's tab starts active via initialTabId).
  const stateModels = await host.harness.getConfig().then((c) => c.models ?? {});
  const mergedModels = { ...stateModels };

  const selector = new TabbedModelSelectorComponent({
    models: mergedModels,
    currentValue: host.state.appState.model,
    selectedValue: Object.keys(mergedModels).find((a) => a.startsWith(`${providerId}/`)),
    currentThinking: host.state.appState.thinking,
    initialTabId: providerId,
    onSelect: ({ alias, thinking }) => {
      host.restoreEditor();
      void setDefaultModel(host, alias, thinking).catch((error: unknown) => {
        host.showError(`Set default model failed: ${formatErrorMessage(error)}`);
      });
    },
    onCancel: () => {
      host.restoreEditor();
    },
  });
  host.mountEditorReplacement(selector);
}

async function setDefaultModel(
  host: SlashCommandHost,
  alias: string,
  thinking: boolean,
): Promise<void> {
  await host.harness.setConfig({
    defaultModel: alias,
    defaultThinking: thinking,
  });
  await host.authFlow.refreshConfigAfterLogin();
  host.track('model_switch', { model: alias });
  host.showStatus(`Default model set to ${alias} with thinking ${thinking ? 'on' : 'off'}.`);
}

async function handleCustomRegistryAddViaDialog(host: SlashCommandHost): Promise<boolean> {
  const value = await promptCustomRegistryImport(host);
  if (value === undefined) return false;

  const source: CustomRegistrySource = {
    kind: 'apiJson',
    url: value.url,
    apiKey: value.apiKey,
  };

  let entries: Awaited<ReturnType<typeof fetchCustomRegistry>>;
  try {
    entries = await fetchCustomRegistry(source);
  } catch (error) {
    host.showError(`Failed to import registry: ${formatErrorMessage(error)}`);
    return false;
  }

  const addedProviderIds = Object.values(entries).map((entry) => entry.id);
  try {
    const config = await host.harness.getConfig();
    applyCustomRegistryEntries(
      config as unknown as ManagedKimiConfigShape,
      entries,
      source,
    );
    await host.harness.setConfig({
      providers: config.providers,
      models: config.models,
    });
    await host.authFlow.refreshConfigAfterLogin();
  } catch (error) {
    host.showError(`Failed to apply registry: ${formatErrorMessage(error)}`);
    return false;
  }

  const count = addedProviderIds.length;
  if (count === 0) {
    host.showStatus('Registry contained no providers.');
    return false;
  }
  host.showStatus(
    count === 1
      ? 'Imported 1 provider from registry.'
      : `Imported ${String(count)} providers from registry.`,
    'success',
  );

  // Offer the model selector so the user can pick a default, just like the
  // catalog (known-provider) flow.
  const stateModels = await host.harness.getConfig().then((c) => c.models ?? {});
  const firstNewAlias = Object.keys(stateModels).find((a) =>
    addedProviderIds.some((pid) => a.startsWith(`${pid}/`)),
  );
  const firstNewProvider = firstNewAlias
    ? stateModels[firstNewAlias]?.provider
    : addedProviderIds[0];
  const selector = new TabbedModelSelectorComponent({
    models: stateModels,
    currentValue: host.state.appState.model,
    selectedValue: firstNewAlias,
    currentThinking: host.state.appState.thinking,
    initialTabId: firstNewProvider,
    onSelect: ({ alias, thinking }) => {
      host.restoreEditor();
      void setDefaultModel(host, alias, thinking).catch((error: unknown) => {
        host.showError(`Set default model failed: ${formatErrorMessage(error)}`);
      });
    },
    onCancel: () => {
      host.restoreEditor();
    },
  });
  host.mountEditorReplacement(selector);
  return true;
}

function promptCustomRegistryImport(
  host: SlashCommandHost,
): Promise<{ readonly url: string; readonly apiKey: string } | undefined> {
  return new Promise((resolve) => {
    const dialog = new CustomRegistryImportDialogComponent(
      (result: CustomRegistryImportResult) => {
        host.restoreEditor();
        resolve(result.kind === 'ok' ? result.value : undefined);
      },
    );
    host.mountEditorReplacement(dialog);
  });
}

function promptCustomEndpointImport(
  host: SlashCommandHost,
): Promise<
  | {
      readonly providerId: string;
      readonly baseUrl: string;
      readonly modelId: string;
      readonly apiKey?: string;
      readonly maxContextSize: number;
    }
  | undefined
> {
  return new Promise((resolve) => {
    const dialog = new CustomEndpointImportDialogComponent(
      (result: CustomEndpointImportResult) => {
        host.restoreEditor();
        resolve(result.kind === 'ok' ? result.value : undefined);
      },
    );
    host.mountEditorReplacement(dialog);
  });
}
