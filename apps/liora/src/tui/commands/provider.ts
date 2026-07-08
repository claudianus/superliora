import type { ProviderConfig } from '@superliora/sdk';

import {
  ProviderManagerComponent,
  type ProviderManagerOptions,
} from '../components/dialogs/provider-manager';
import { DEFAULT_OAUTH_PROVIDER_NAME } from '../constant/liora-tui';
import { formatErrorMessage } from '../utils/event-payload';
import type { SlashCommandHost } from './dispatch';
import { promptApiKey } from './prompts';
import { loadCatalogWithSpinner, runUnifiedProviderConnect } from './provider-connect';

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
  const catalog = await loadCatalogWithSpinner(host);
  if (catalog === undefined) {
    reopenProviderManager(host);
    return;
  }

  await runUnifiedProviderConnect(host, catalog);
  reopenProviderManager(host);
}

function reopenProviderManager(host: SlashCommandHost): void {
  const options = buildProviderManagerOptions(host);
  const component = new ProviderManagerComponent(options);
  host.mountEditorReplacement(component);
}
