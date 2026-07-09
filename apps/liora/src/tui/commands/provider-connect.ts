/**
 * Shared provider-connection logic used by both `/login` and `/provider`.
 *
 * The unified provider picker resolves to a {@link ProviderCatalogSelection};
 * this module owns the side effects for each branch (Kimi OAuth, catalog
 * API-key, custom endpoint, custom registry), so the two entry points stay
 * thin. Catalog loading goes through the disk-cached {@link loadCatalog}.
 */

import {
  applyCatalogProvider,
  catalogBaseUrl,
  catalogModelToAlias,
  catalogProviderModels,
  DEFAULT_CATALOG_URL,
  fetchCatalog,
  inferWireType,
  log,
  type Catalog,
  type CatalogModel,
  type ModelAlias,
} from '@superliora/sdk';
import {
  applyCustomRegistryEntries,
  fetchCustomRegistry,
  getProviderProfile,
  OAuthProviderManager,
  type CustomRegistrySource,
  type ManagedKimiConfigShape,
  type ProviderModelPreset,
} from '@superliora/oauth';

import {
  CustomEndpointImportDialogComponent,
  type CustomEndpointImportResult,
} from '../components/dialogs/custom-endpoint-import';
import {
  CustomRegistryImportDialogComponent,
  type CustomRegistryImportResult,
} from '../components/dialogs/custom-registry-import';
import { TabbedModelSelectorComponent } from '../components/dialogs/tabbed-model-selector';
import { DEFAULT_OAUTH_PROVIDER_NAME, PRODUCT_NAME } from '../constant/liora-tui';
import { formatErrorMessage } from '../utils/event-payload';
import type { LoginProgressSpinnerHandle } from '../types';
import { loadCatalog } from '#/utils/catalog-cache';
import { openUrl } from '#/utils/open-url';
import { ttui } from '#/tui/utils/tui-i18n';
import {
  type ProviderCatalogOption,
  type ProviderCatalogSelection,
} from '#/tui/utils/provider-catalog-options';
import { oauthProviderCatalogId } from '#/tui/utils/oauth-catalog-id';
import { applyCustomEndpointProvider } from '#/utils/custom-provider';
import {
  promptApiKeyForCatalogProvider,
  promptProviderCatalog,
} from './prompts';
import type { SlashCommandHost } from './dispatch';

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

  await openModelPickerForProvider(host, providerId);
  return true;
}

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

/**
 * Opens the unified provider picker and dispatches the matching connect flow
 * for the selection. Used by both `/login` and `/provider`'s add action.
 * Returns the resolved selection so callers can decide whether to reopen
 * their management view.
 */
export async function runUnifiedProviderConnect(
  host: SlashCommandHost,
  catalog: Catalog,
): Promise<ProviderCatalogSelection | undefined> {
  const selection = await promptProviderCatalog(host, catalog);
  if (selection === undefined) return undefined;

  switch (selection.kind) {
    case 'oauth':
      if (selection.providerId === DEFAULT_OAUTH_PROVIDER_NAME) {
        await connectKimiManaged(host);
      } else {
        await connectOAuthProvider(host, selection.providerId);
      }
      break;
    case 'cloud':
      await connectCloudProvider(host, selection.providerId);
      break;
    case 'catalog':
      await connectCatalogProvider(host, catalog, selection.providerId);
      break;
    case 'custom-endpoint':
      await connectCustomEndpoint(host);
      break;
    case 'custom-registry':
      await connectCustomRegistry(host);
      break;
  }
  return selection;
}

async function openModelPickerForProvider(host: SlashCommandHost, providerId: string): Promise<void> {
  const stateModels = await host.harness.getConfig().then((c) => c.models ?? {});

  const selector = new TabbedModelSelectorComponent({
    models: stateModels,
    currentValue: host.state.appState.model,
    selectedValue: Object.keys(stateModels).find((a) => a.startsWith(`${providerId}/`)),
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

async function connectKimiManaged(host: SlashCommandHost): Promise<void> {
  // Inline the managed Kimi OAuth login flow so this module owns every connect
  // branch without a circular dependency back into auth.ts. The flow mirrors
  // the original handleKimiCodeOAuthLogin: device-code authorization, config
  // refresh, and telemetry.
  const status = await host.harness.auth.status(DEFAULT_OAUTH_PROVIDER_NAME);
  const alreadyLoggedIn = status.providers.some(
    (provider) => provider.providerName === DEFAULT_OAUTH_PROVIDER_NAME && provider.hasToken,
  );

  let spinner: LoginProgressSpinnerHandle | undefined;
  const controller = new AbortController();
  const cancelLogin = (): void => {
    controller.abort();
  };
  host.cancelInFlight = cancelLogin;
  try {
    await host.harness.auth.login(DEFAULT_OAUTH_PROVIDER_NAME, {
      signal: controller.signal,
      onDeviceCode: (data) => {
        spinner = host.showLoginAuthorizationPrompt(data);
      },
    });
    spinner?.stop({ ok: true, label: 'Logged in.' });
    spinner = undefined;
    try {
      await host.authFlow.refreshConfigAfterLogin();
    } catch (refreshError) {
      const message = formatErrorMessage(refreshError);
      host.showError(ttui('tui.provider.refreshFailed', { message }));
      return;
    }
    host.track('login', {
      provider: DEFAULT_OAUTH_PROVIDER_NAME,
      method: 'oauth',
      already_logged_in: alreadyLoggedIn,
    });
    if (alreadyLoggedIn) {
      host.showStatus(ttui('tui.provider.alreadyLoggedIn'));
    }
  } catch (error) {
    const cancelled = controller.signal.aborted;
    spinner?.stop({
      ok: false,
      label: cancelled ? ttui('tui.provider.loginCancelled') : ttui('tui.provider.loginFailedLabel'),
    });
    spinner = undefined;
    if (cancelled) return;
    log.warn('login failed', {
      providerName: DEFAULT_OAUTH_PROVIDER_NAME,
      alreadyLoggedIn,
      sessionId: host.session?.id,
      error,
    });
    const message = formatErrorMessage(error);
    host.showError(ttui('tui.provider.loginFailed', { message }));
  } finally {
    if (host.cancelInFlight === cancelLogin) {
      host.cancelInFlight = undefined;
    }
  }
}

/** Builds a model alias from a hardcoded profile preset. */
function presetModelToAlias(providerId: string, preset: ProviderModelPreset): ModelAlias {
  return {
    provider: providerId,
    model: preset.id,
    maxContextSize: preset.maxContextSize,
    capabilities: preset.capabilities !== undefined ? [...preset.capabilities] : undefined,
    displayName: preset.displayName,
  };
}

/**
 * Resolves the model list for an OAuth provider. Prefers the live models.dev
 * catalog (so newly released models surface without a release), and falls back
 * to the profile preset when the catalog is unavailable or has no entry for
 * the provider. Returns `undefined` when neither source yields models.
 */
export async function resolveOAuthProviderModels(
  providerId: string,
  presets: readonly ProviderModelPreset[] | undefined,
): Promise<readonly ModelAlias[] | undefined> {
  const catalogId = oauthProviderCatalogId(providerId);
  try {
    const catalog = await loadCatalog();
    const entry = catalog[catalogId];
    if (entry !== undefined) {
      const models: CatalogModel[] = catalogProviderModels(entry);
      if (models.length > 0) {
        return models.map((model) => catalogModelToAlias(providerId, model));
      }
    }
  } catch (error) {
    // Catalog fetch is best-effort; the preset below keeps the provider usable.
    log.warn(`Failed to load models.dev catalog for "${providerId}", using preset.`, formatErrorMessage(error));
  }
  if (presets !== undefined && presets.length > 0) {
    return presets.map((preset) => presetModelToAlias(providerId, preset));
  }
  return undefined;
}

/**
 * Connects a non-Kimi OAuth provider (OpenAI Codex, xAI Grok). Runs the
 * provider's login flow via {@link OAuthProviderManager}, then persists a
 * provider config that references the stored OAuth token so the runtime auth
 * layer can resolve a Bearer token per request.
 */
async function connectOAuthProvider(host: SlashCommandHost, providerId: string): Promise<void> {
  const profile = getProviderProfile(providerId);
  if (profile === undefined) {
    host.showError(`No OAuth profile for provider "${providerId}".`);
    return;
  }

  const manager = new OAuthProviderManager();
  const controller = new AbortController();
  const cancelLogin = (): void => {
    controller.abort();
  };
  host.cancelInFlight = cancelLogin;

  let spinner: LoginProgressSpinnerHandle | undefined;
  try {
    const storageKey = manager.storageName(providerId);
    spinner = host.showProgressSpinner(`Authorizing with ${profile.displayName}`);
    await manager.login(
      providerId,
      {
        onDeviceCode: (auth) => {
          spinner?.stop({ ok: false, label: '' });
          spinner = host.showLoginAuthorizationPrompt(auth);
        },
        onAuthorizeUrl: (url) => {
          spinner?.stop({ ok: false, label: '' });
          // Open the browser automatically; fall back to showing the URL.
          openUrl(url);
          spinner = host.showProgressSpinner(`Opening browser to authorize…\nIf it did not open, visit:\n${url}`);
        },
      },
      { signal: controller.signal },
    );
    spinner?.stop({ ok: true, label: 'Logged in.' });
    spinner = undefined;

    // Persist a provider config that references the OAuth token via an
    // OAuthRef. The runtime auth layer resolves the Bearer token from storage
    // using the `key` (storage name).
    const config = await host.harness.getConfig();
    if (config.providers[providerId] !== undefined) {
      await host.harness.removeProvider(providerId);
    }
    const freshConfig = await host.harness.getConfig();
    freshConfig.providers[providerId] = {
      type: profile.wire,
      baseUrl: profile.apiBaseUrl,
      oauth: { storage: 'file', key: storageKey },
    };

    // Resolve the model list from the models.dev catalog when possible
    // (so new models like Grok 4.5 appear without a release), falling back
    // to the profile preset when the catalog is unavailable. This keeps the
    // provider usable immediately without a per-request /models fetch.
    const resolvedModels = await resolveOAuthProviderModels(providerId, profile.models);
    if (resolvedModels !== undefined && resolvedModels.length > 0) {
      const models = freshConfig.models ?? {};
      for (const alias of resolvedModels) {
        models[`${providerId}/${alias.model}`] = alias;
      }
      freshConfig.models = models;
    }

    await host.harness.setConfig({
      providers: freshConfig.providers,
      models: freshConfig.models,
    });

    await host.authFlow.refreshConfigAfterLogin();
    host.track('login', { provider: providerId, method: 'oauth' });
    host.showStatus(ttui('tui.provider.connected', { name: profile.displayName }));

    // Offer the model picker so the user can choose a default.
    if (resolvedModels !== undefined && resolvedModels.length > 0) {
      await openModelPickerForProvider(host, providerId);
    }
  } catch (error) {
    const cancelled = controller.signal.aborted;
    spinner?.stop({
      ok: false,
      label: cancelled ? ttui('tui.provider.loginCancelled') : ttui('tui.provider.loginFailedLabel'),
    });
    spinner = undefined;
    if (cancelled) return;
    host.showError(ttui('tui.provider.loginFailed', { message: formatErrorMessage(error) }));
  } finally {
    if (host.cancelInFlight === cancelLogin) {
      host.cancelInFlight = undefined;
    }
  }
}

/** Cloud-hosted Claude model presets for Bedrock and Vertex AI. */
const CLOUD_CLAUDE_MODELS = [
  {
    id: 'claude-sonnet-4-20250514',
    bedrockId: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
    vertexId: 'claude-sonnet-4@20250514',
    displayName: 'Claude Sonnet 4',
    maxContextSize: 200000,
    capabilities: ['thinking', 'tool_use', 'image_in'],
  },
  {
    id: 'claude-opus-4-20250514',
    bedrockId: 'us.anthropic.claude-opus-4-20250514-v1:0',
    vertexId: 'claude-opus-4@20250514',
    displayName: 'Claude Opus 4',
    maxContextSize: 200000,
    capabilities: ['thinking', 'tool_use', 'image_in'],
  },
] as const;

/**
 * Connects a cloud-hosted Claude provider (Amazon Bedrock or Google Vertex AI).
 * Unlike API-key or OAuth providers, these authenticate through the cloud
 * platform's standard credential chain (AWS IAM / GCP ADC), so no secret is
 * stored — only the provider config + model aliases.
 */
async function connectCloudProvider(
  host: SlashCommandHost,
  cloudKind: 'bedrock' | 'vertex_claude',
): Promise<void> {
  const isBedrock = cloudKind === 'bedrock';
  const providerId = isBedrock ? 'anthropic-bedrock' : 'anthropic-vertex';
  const credentialHint = isBedrock
    ? 'Requires AWS credentials (aws configure or AWS_ACCESS_KEY_ID env). Enable Anthropic models in the Bedrock console.'
    : 'Requires GCP credentials (gcloud auth application-default login). Enable Claude in the Vertex AI Model Garden.';

  host.showStatus(credentialHint);

  const config = await host.harness.getConfig();
  if (config.providers[providerId] !== undefined) {
    await host.harness.removeProvider(providerId);
  }
  const freshConfig = await host.harness.getConfig();
  // No apiKey — the SDK resolves credentials from the cloud credential chain.
  freshConfig.providers[providerId] = {
    type: cloudKind,
    apiKey: '',
  };

  // Write model aliases using the cloud-specific model id convention.
  const models = freshConfig.models ?? {};
  for (const preset of CLOUD_CLAUDE_MODELS) {
    const modelId = isBedrock ? preset.bedrockId : preset.vertexId;
    models[`${providerId}/${preset.id}`] = {
      provider: providerId,
      model: modelId,
      maxContextSize: preset.maxContextSize,
      capabilities: [...preset.capabilities],
      displayName: preset.displayName,
    };
  }
  freshConfig.models = models;

  await host.harness.setConfig({
    providers: freshConfig.providers,
    models: freshConfig.models,
  });

  await host.authFlow.refreshConfigAfterLogin();
  host.track('connect', { provider: providerId, method: 'cloud' });
  host.showStatus(
    `Connected: ${isBedrock ? 'Anthropic via Bedrock' : 'Anthropic via Vertex AI'}`,
    'success',
  );

  await openModelPickerForProvider(host, providerId);
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

// PRODUCT_NAME is re-exported so command modules can reference the managed
// account label without importing from the constant directly.
export { DEFAULT_OAUTH_PROVIDER_NAME, PRODUCT_NAME };
