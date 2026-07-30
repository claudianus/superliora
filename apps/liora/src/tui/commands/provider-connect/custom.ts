import {
  applyCustomRegistryEntries,
  fetchCustomRegistry,
  type CustomRegistrySource,
  type ManagedKimiConfigShape,
} from '@superliora/oauth';

import {
  CustomEndpointImportDialogComponent,
  type CustomEndpointImportResult,
  type CustomEndpointImportValue,
} from '../../components/dialogs/provider/custom-endpoint-import';
import {
  CustomRegistryImportDialogComponent,
  type CustomRegistryImportResult,
} from '../../components/dialogs/provider/custom-registry-import';
import { formatErrorMessage } from '../../utils/event-payload';
import { loadCatalog } from '#/utils/catalog-cache';
import { applyCustomEndpointProvider, lookupModelCapability, probeModelsEndpoint } from '#/utils/custom-provider';
import type { SlashCommandHost } from '../dispatch';

/** Connects a custom OpenAI-compatible endpoint. Returns `false` on cancel. */
export async function connectCustomEndpoint(host: SlashCommandHost): Promise<boolean> {
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
      providerType: value.providerType,
      maxContextSize: value.maxContextSize,
      thinking: value.thinking,
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

/** Connects a custom api.json registry. Returns `false` on cancel. */
export async function connectCustomRegistry(host: SlashCommandHost): Promise<boolean> {
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
    applyCustomRegistryEntries(config as unknown as ManagedKimiConfigShape, entries, source);
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
): Promise<CustomEndpointImportValue | undefined> {
  return new Promise((resolve) => {
    const dialog = new CustomEndpointImportDialogComponent(
      (result: CustomEndpointImportResult) => {
        host.restoreEditor();
        resolve(result.kind === 'ok' ? result.value : undefined);
      },
    );

    // Auto-detect thinking support: load the models.dev catalog in the
    // background and wire up a hint request handler on the dialog.
    const catalogPromise = loadCatalog().catch(() => undefined);
    dialog.onModelHintRequest = (info) => {
      void (async () => {
        // 1. Try the models.dev catalog first (fast, cached).
        const catalog = await catalogPromise;
        if (catalog !== undefined) {
          const hint = lookupModelCapability(catalog, info.providerId, info.modelId);
          if (hint !== undefined) {
            dialog.setThinkingDefault(hint.thinking);
            return;
          }
        }
        // 2. Fallback: probe the endpoint's /models API (best-effort, 3s timeout).
        if (info.baseUrl.length > 0) {
          const probed = await probeModelsEndpoint(info.baseUrl, undefined, info.modelId);
          if (probed !== undefined) {
            dialog.setThinkingDefault(probed.thinking);
          }
        }
      })();
    };

    host.mountEditorReplacement(dialog);
  });
}
