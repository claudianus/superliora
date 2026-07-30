import {
  applyCatalogProvider,
  catalogBaseUrl,
  catalogProviderModels,
  DEFAULT_CATALOG_URL,
  fetchCatalog,
  inferWireType,
  type Catalog,
} from '@superliora/sdk';

import { formatErrorMessage } from '../../utils/event-payload';
import { loadCatalog } from '#/utils/catalog-cache';
import { ttui } from '#/tui/utils/tui-i18n';
import { type ProviderCatalogOption } from '#/tui/utils/model/provider-catalog-options';
import { promptApiKeyForCatalogProvider } from '../prompts';
import type { SlashCommandHost } from '../hub/dispatch';
import { openModelPickerForProvider } from './model-picker';

export { DEFAULT_CATALOG_URL, fetchCatalog };

/**
 * Loads the models.dev catalog via the disk cache. Shows a spinner while
 * fetching and surfaces a friendly error on failure. Returns `undefined`
 * when the user cancels or the catalog cannot be loaded.
 */
export async function loadCatalogWithSpinner(
  host: SlashCommandHost,
): Promise<Catalog | undefined> {
  const controller = new AbortController();
  const cancel = (): void => {
    controller.abort();
  };
  host.cancelInFlight = cancel;

  const spinner = host.showLoginProgressSpinner(ttui('tui.provider.catalogLoading'));
  let catalog: Catalog | undefined;
  try {
    catalog = await loadCatalog(controller.signal);
    spinner.stop({ ok: true, label: ttui('tui.provider.catalogLoaded') });
  } catch (error) {
    if (controller.signal.aborted) {
      spinner.stop({ ok: false, label: ttui('tui.provider.catalogAborted') });
    } else {
      spinner.stop({ ok: false, label: ttui('tui.provider.catalogFailed') });
      host.showError(ttui('tui.provider.catalogFailedDetail', { message: formatErrorMessage(error) }));
    }
  } finally {
    if (host.cancelInFlight === cancel) host.cancelInFlight = undefined;
  }
  return catalog;
}

/**
 * Connects a catalog (API-key) provider end-to-end: reads the API key,
 * persists provider + model aliases, then opens the model picker so the user
 * can choose a default. Returns `false` when the user cancels or the provider
 * cannot be configured.
 */
export async function connectCatalogProvider(
  host: SlashCommandHost,
  catalog: Catalog,
  providerId: string,
): Promise<boolean> {
  const entry = catalog[providerId];
  if (entry === undefined) {
    host.showError(ttui('tui.provider.notInCatalog', { provider: providerId }));
    return false;
  }

  const models = catalogProviderModels(entry);
  if (models.length === 0) {
    host.showError(ttui('tui.provider.noModels', { provider: providerId }));
    return false;
  }

  const option: ProviderCatalogOption = {
    value: `catalog:${providerId}`,
    label: entry.name ?? providerId,
    authKind: 'api-key',
    modelCount: models.length,
    baseUrl: typeof entry.api === 'string' && entry.api.length > 0 ? entry.api : undefined,
    envVars: entry.env,
    docUrl: typeof entry.doc === 'string' && entry.doc.length > 0 ? entry.doc : undefined,
    catalogId: providerId,
  };

  const apiKey = await promptApiKeyForCatalogProvider(host, option);
  if (apiKey === undefined) return false;

  const wire = inferWireType(entry);
  if (wire === undefined) {
    host.showError(ttui('tui.provider.unsupportedWire', { provider: providerId }));
    return false;
  }
  const baseUrl = catalogBaseUrl(entry, wire);

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
    selectedModelId: '',
    thinking: false,
  });

  await host.harness.setConfig({
    providers: config.providers,
    models: config.models,
  });

  await host.authFlow.refreshConfigAfterLogin();
  host.track('connect', { provider: providerId, method: 'catalog' });
  host.showStatus(ttui('tui.provider.added', { name: entry.name ?? providerId }));
  host.showNotice(ttui('tui.provider.mediaHint'));

  await openModelPickerForProvider(host, providerId);
  return true;
}
