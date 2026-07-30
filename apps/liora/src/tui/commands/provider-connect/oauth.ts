import {
  catalogModelToAlias,
  catalogProviderModels,
  log,
  type CatalogModel,
  type ModelAlias,
} from '@superliora/sdk';
import {
  allocateManagedKimiOAuthAccountKey,
  allocateProviderOAuthAccountKey,
  getProviderProfile,
  listProviderOAuthRefs,
  mergeProviderOAuthLogin,
  OAuthProviderManager,
  SUPERLIORA_PROVIDER_NAME,
  type ProviderModelPreset,
} from '@superliora/oauth';

import { ChoicePickerComponent } from '../../components/dialogs/picker/choice-picker';
import { DEFAULT_OAUTH_PROVIDER_NAME } from '../../constant/liora-tui';
import { formatErrorMessage } from '../../utils/event-payload';
import type { LoginProgressSpinnerHandle } from '../types';
import { loadCatalog } from '#/utils/catalog-cache';
import { openUrl } from '#/utils/open-url';
import { ttui } from '#/tui/utils/tui-i18n';
import { oauthProviderCatalogId } from '#/tui/utils/oauth-catalog-id';
import { promptOAuthCallback } from '../prompts';
import type { SlashCommandHost } from '../dispatch';
import { openModelPickerForProvider } from './model-picker';

export async function connectKimiManaged(host: SlashCommandHost): Promise<void> {
  // Inline the managed Kimi OAuth login flow so this module owns every connect
  // branch without a circular dependency back into auth.ts. The flow mirrors
  // the original handleKimiCodeOAuthLogin: device-code authorization, config
  // refresh, and telemetry. When already logged in, offer adding another
  // account so quota/rate-limit failures can auto-switch across the pool.
  const status = await host.harness.auth.status(DEFAULT_OAUTH_PROVIDER_NAME);
  const alreadyLoggedIn = status.providers.some(
    (provider) => provider.providerName === DEFAULT_OAUTH_PROVIDER_NAME && provider.hasToken,
  );

  let addAccount = false;
  if (alreadyLoggedIn) {
    const choice = await promptManagedAccountAction(host);
    if (choice === undefined) return;
    addAccount = choice === 'add';
  }

  let spinner: LoginProgressSpinnerHandle | undefined;
  const controller = new AbortController();
  const cancelLogin = (): void => {
    controller.abort();
  };
  host.cancelInFlight = cancelLogin;
  try {
    let oauthRef:
      | {
          key: string;
          oauthHost?: string;
        }
      | undefined;
    if (addAccount) {
      const config = await host.harness.getConfig({ reload: true });
      const provider = config.providers?.[SUPERLIORA_PROVIDER_NAME];
      const allocated = allocateManagedKimiOAuthAccountKey(provider, {
        baseUrl: typeof provider?.baseUrl === 'string' ? provider.baseUrl : undefined,
      });
      oauthRef = {
        key: allocated.key,
        ...(allocated.oauthHost === undefined ? {} : { oauthHost: allocated.oauthHost }),
      };
    }

    await host.harness.auth.login(DEFAULT_OAUTH_PROVIDER_NAME, {
      signal: controller.signal,
      ...(oauthRef === undefined ? {} : { oauthRef }),
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
      add_account: addAccount,
    });
    if (addAccount && oauthRef !== undefined) {
      host.showStatus(
        ttui('tui.provider.accountAdded', {
          fingerprint: fingerprintOAuthKey(oauthRef.key),
        }),
      );
    } else if (alreadyLoggedIn) {
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
      addAccount,
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

/**
 * Connects a non-Kimi OAuth provider (OpenAI Codex, xAI Grok). Runs the
 * provider's login flow via {@link OAuthProviderManager}, then persists a
 * provider config that references the stored OAuth token so the runtime auth
 * layer can resolve a Bearer token per request.
 */
export async function connectOAuthProvider(host: SlashCommandHost, providerId: string): Promise<void> {
  const profile = getProviderProfile(providerId);
  if (profile === undefined) {
    host.showError(`No OAuth profile for provider "${providerId}".`);
    return;
  }

  const manager = new OAuthProviderManager();
  const defaultStorageKey = manager.storageName(providerId);
  const existingConfig = await host.harness.getConfig({ reload: true });
  const existingProvider = existingConfig.providers[providerId] as
    | Record<string, unknown>
    | undefined;
  const existingRefs = listProviderOAuthRefs(existingProvider);
  const alreadyLoggedIn =
    existingRefs.length > 0 || (await manager.hasToken(providerId, existingRefs[0]?.key ?? defaultStorageKey));

  let addAccount = false;
  if (alreadyLoggedIn) {
    const choice = await promptManagedAccountAction(
      host,
      ttui('tui.provider.addAccountProviderTitle', { name: profile.displayName }),
    );
    if (choice === undefined) return;
    addAccount = choice === 'add';
  }

  const allocated = allocateProviderOAuthAccountKey(providerId, existingProvider, {
    defaultKey: defaultStorageKey,
  });
  // Refresh reuses the primary storage key; add-account allocates a fresh key
  // only when accounts already exist.
  const storageKey =
    addAccount || existingRefs.length === 0
      ? allocated.key
      : (existingRefs[0]?.key ?? defaultStorageKey);

  const controller = new AbortController();
  const cancelLogin = (): void => {
    controller.abort();
  };
  host.cancelInFlight = cancelLogin;

  let spinner: LoginProgressSpinnerHandle | undefined;
  try {
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
          spinner = host.showProgressSpinner(
            ttui('tui.provider.openingBrowser', { url }),
          );
        },
        onManualCallbackPrompt: async ({ signal, lastError }) => {
          // Give the loopback redirect a short head start so local browser
          // logins that complete automatically never flash the paste dialog.
          if (lastError === undefined) {
            const delayMs = 8_000;
            await new Promise<void>((resolve) => {
              if (signal.aborted) {
                resolve();
                return;
              }
              const timer = setTimeout(() => {
                signal.removeEventListener('abort', onAbort);
                resolve();
              }, delayMs);
              const onAbort = (): void => {
                clearTimeout(timer);
                resolve();
              };
              signal.addEventListener('abort', onAbort, { once: true });
            });
            if (signal.aborted) return undefined;
          }

          spinner?.stop({ ok: false, label: '' });
          spinner = undefined;
          const pasted = await promptOAuthCallback(host, {
            signal,
            errorHint: lastError,
            title: ttui('tui.provider.pasteCallbackTitle'),
            subtitleLines: [
              ttui('tui.provider.pasteCallbackHint1'),
              ttui('tui.provider.pasteCallbackHint2'),
            ],
          });
          if (pasted === undefined && !signal.aborted) {
            // User cancelled the paste dialog; keep waiting for loopback.
            spinner = host.showProgressSpinner(ttui('tui.provider.waitingAuthorization'));
          }
          return pasted;
        },
      },
      { signal: controller.signal, storageKey },
    );
    spinner?.stop({ ok: true, label: 'Logged in.' });
    spinner = undefined;

    // Persist a provider config that references the OAuth token via an
    // OAuthRef. Multi-account logins push previous accounts into `oauths` so
    // the runtime route pool can fail over on quota/rate-limit errors.
    const freshConfig = await host.harness.getConfig();
    const loginRef = {
      storage: 'file' as const,
      key: storageKey,
    };
    const mergedProvider = mergeProviderOAuthLogin(
      freshConfig.providers[providerId] as Record<string, unknown> | undefined,
      loginRef,
      {
        addAccount,
        type: profile.wire,
        baseUrl: profile.apiBaseUrl,
        ...(profile.customHeaders !== undefined
          ? { customHeaders: { ...profile.customHeaders } }
          : {}),
      },
    );
    freshConfig.providers[providerId] = mergedProvider as (typeof freshConfig.providers)[string];

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
    host.track('login', {
      provider: providerId,
      method: 'oauth',
      already_logged_in: alreadyLoggedIn,
      add_account: addAccount,
    });
    if (addAccount) {
      host.showStatus(
        ttui('tui.provider.accountAdded', {
          fingerprint: fingerprintOAuthKey(storageKey),
        }),
      );
    } else if (alreadyLoggedIn) {
      host.showStatus(ttui('tui.provider.alreadyLoggedIn'));
    } else {
      host.showStatus(ttui('tui.provider.connected', { name: profile.displayName }));
    }
    host.showNotice(ttui('tui.provider.mediaHint'));

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

function promptManagedAccountAction(
  host: SlashCommandHost,
  title: string = ttui('tui.provider.addAccountTitle'),
): Promise<'refresh' | 'add' | undefined> {
  return new Promise((resolve) => {
    const picker = new ChoicePickerComponent({
      title,
      options: [
        {
          value: 'refresh',
          label: ttui('tui.provider.addAccountRefresh'),
          description: ttui('tui.provider.addAccountRefreshDesc'),
        },
        {
          value: 'add',
          label: ttui('tui.provider.addAccountAdd'),
          description: ttui('tui.provider.addAccountAddDesc'),
        },
      ],
      currentValue: 'add',
      onSelect: (value) => {
        host.restoreEditor();
        resolve(value === 'add' ? 'add' : 'refresh');
      },
      onCancel: () => {
        host.restoreEditor();
        resolve(undefined);
      },
    });
    host.mountEditorReplacement(picker);
  });
}

function fingerprintOAuthKey(key: string): string {
  if (key.length <= 18) return key;
  return `${key.slice(0, 12)}…${key.slice(-4)}`;
}
