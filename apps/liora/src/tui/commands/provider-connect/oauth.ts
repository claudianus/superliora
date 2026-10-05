import {
  catalogModelToAlias,
  catalogProviderModels,
  type DevinDiscoveredModel,
  factoryDroidModels,
  fetchDevinModels,
  log,
  type CatalogModel,
  type ModelAlias,
} from '@superliora/sdk';
import {
  allocateManagedKimiOAuthAccountKey,
  allocateProviderOAuthAccountKey,
  applyCursorOAuthModelAliases,
  CURSOR_OAUTH_PROVIDER_ID,
  cursorModelsToPresets,
  DEVIN_PROVIDER_ID,
  ensureGitHubCopilotSession,
  FACTORY_DROID_PROVIDER_ID,
  fetchCursorAvailableModels,
  GOOGLE_ANTIGRAVITY_PROVIDER_ID,
  GITHUB_COPILOT_PROVIDER_ID,
  GITHUB_COPILOT_TOKEN_ENVS,
  getProviderProfile,
  githubCopilotRequestHeaders,
  listProviderOAuthRefs,
  mergeProviderOAuthLogin,
  OAuthProviderManager,
  SUPERLIORA_PROVIDER_NAME,
  fetchGitHubCopilotModels,
  readGitHubCopilotEnvToken,
  readGitHubCopilotGhCliToken,
  qwenResourceUrlToBaseUrl,
  xaiGrokProviderRouteFields,
  type ProviderModelPreset,
} from '@superliora/oauth';

import { ChoicePickerComponent } from '../../components/dialogs/picker/choice-picker';
import { DEFAULT_OAUTH_PROVIDER_NAME } from '../../constant/liora-tui';
import { formatErrorMessage } from '../../utils/event-payload';
import { refreshProviderQuotaOnHost } from '#/tui/utils/usage/quota-glance';
import type { LoginProgressSpinnerHandle } from '../../types';
import { loadCatalog } from '#/utils/catalog-cache';
import { openUrl } from '#/utils/open-url';
import { ttui } from '#/tui/utils/tui-i18n';
import { oauthProviderCatalogId } from '#/tui/utils/oauth-catalog-id';
import { promptApiKeyForCatalogProvider, promptOAuthCallback } from '../auth/prompts';
import type { SlashCommandHost } from '../hub/dispatch';
import { openModelPickerForProvider } from './model-picker';
import { oauthLoginFollowUp } from './oauth-login-hint';
import {
  promptXaiGrokRoute,
  readXaiGrokRouteFromProvider,
  xaiGrokRouteStatusLabel,
} from './xai-grok-route';

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
    spinner?.stop({ ok: true, label: ttui('tui.auth.loggedIn') });
    spinner = undefined;
    try {
      await host.authFlow.refreshConfigAfterLogin();
    } catch (refreshError) {
      const message = formatErrorMessage(refreshError);
      host.showError(ttui('tui.provider.refreshFailed', { message }));
      return;
    }
    void refreshProviderQuotaOnHost(host);
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
    host.showNotice(ttui('tui.provider.kimiConsole'));
    await openModelPickerForProvider(host, SUPERLIORA_PROVIDER_NAME);
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
    host.showError(ttui('tui.provider.noOAuth', { id: providerId }));
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
    let pastedToken: string | undefined;
    if (profile.flow.kind === 'paste_token') {
      const envToken = readGitHubCopilotEnvToken();
      pastedToken = await promptApiKeyForCatalogProvider(
        host,
        {
          value: `oauth:${providerId}`,
          label: profile.displayName,
          authKind: 'api-key',
          modelCount: 0,
          envVars: [...GITHUB_COPILOT_TOKEN_ENVS],
          docUrl: profile.docUrl,
          catalogId: providerId,
        },
        {
          pasteSecret: true,
          prefill: envToken === undefined ? await readGitHubCopilotGhCliToken() : undefined,
        },
      );
      if (pastedToken === undefined) return;
    }

    spinner = host.showProgressSpinner(`Authorizing with ${profile.displayName}`);
    const loginToken = await manager.login(
      providerId,
      {
        onDeviceCode: (auth) => {
          spinner?.stop({ ok: false, label: '' });
          spinner = host.showLoginAuthorizationPrompt(auth);
        },
        onAuthorizeUrl: (url, context) => {
          spinner?.stop({ ok: false, label: '' });
          // A restart replaces a dead single-use code mid-flow: the user
          // already has the flow open in their browser, so show the fresh
          // URL for manual copy instead of popping another tab on them.
          if (context?.isRestart === true) {
            spinner = host.showProgressSpinner(ttui('tui.provider.restartedUrl', { url }));
            return;
          }
          // Open the browser automatically; fall back to showing the URL.
          openUrl(url);
          spinner = host.showProgressSpinner(
            ttui('tui.provider.openingBrowser', { url }),
          );
        },
        onManualCallbackPrompt: async ({ signal, lastError }) => {
          // Give the loopback redirect a short head start so local browser
          // logins that complete automatically never flash the paste dialog.
          // `code_paste` flows have no loopback server — the paste dialog is
          // the primary input — so show it immediately.
          const hasLoopback = profile.flow.kind !== 'code_paste';
          if (hasLoopback && lastError === undefined) {
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
          // GLM ZCode uses a custom-protocol redirect the ZCode desktop app
          // may grab; tell the user up front to cancel the app-open prompt,
          // otherwise the app consumes the one-time code before the paste.
          const pasteHints =
            profile.id === 'glm-zcode'
              ? [
                  ttui('tui.provider.pasteCallbackGlmZcode1'),
                  ttui('tui.provider.pasteCallbackGlmZcode2'),
                ]
              : [
                  ttui('tui.provider.pasteCallbackHint1'),
                  ttui('tui.provider.pasteCallbackHint2'),
                ];
          const pasted = await promptOAuthCallback(host, {
            signal,
            errorHint: lastError,
            title: ttui('tui.provider.pasteCallbackTitle'),
            subtitleLines: pasteHints,
          });
          if (pasted === undefined && !signal.aborted) {
            // User cancelled the paste dialog; keep waiting for loopback.
            spinner = host.showProgressSpinner(ttui('tui.provider.waitingAuthorization'));
          }
          return pasted;
        },
      },
      {
        signal: controller.signal,
        storageKey,
        ...(pastedToken === undefined ? {} : { pastedToken }),
      },
    );
    spinner?.stop({ ok: true, label: ttui('tui.auth.loggedIn') });
    spinner = undefined;

    // Persist a provider config that references the OAuth token via an
    // OAuthRef. Multi-account logins push previous accounts into `oauths` so
    // the runtime route pool can fail over on quota/rate-limit errors.
    const freshConfig = await host.harness.getConfig();
    const loginRef = {
      storage: 'file' as const,
      key: storageKey,
    };
    let routeBaseUrl = profile.apiBaseUrl;
    let routeCustomHeaders =
      profile.customHeaders !== undefined ? { ...profile.customHeaders } : undefined;
    let xaiRouteLabel: string | undefined;
    if (providerId === 'xai-grok') {
      const previous = readXaiGrokRouteFromProvider(
        freshConfig.providers[providerId] as Record<string, unknown> | undefined,
      );
      // Cancel keeps the previous route (Build on first login) so a completed
      // OAuth is not abandoned with no provider mount.
      const route = (await promptXaiGrokRoute(host, previous)) ?? previous;
      const fields = xaiGrokProviderRouteFields(route);
      routeBaseUrl = fields.baseUrl;
      routeCustomHeaders = fields.customHeaders;
      xaiRouteLabel = xaiGrokRouteStatusLabel(route);
    }
    let accessToken: string | undefined;
    let copilotSessionToken: string | undefined;
    let copilotApiBaseUrl: string | undefined;
    if (providerId === DEVIN_PROVIDER_ID) {
      // The just-minted session token skips a storage round-trip; Devin's
      // session JWT is non-refreshable so ensureFresh would throw on expiry
      // anyway.
      accessToken = loginToken.accessToken;
    } else if (providerId === CURSOR_OAUTH_PROVIDER_ID || profile.liveModels === true) {
      try {
        accessToken = await manager.ensureFresh(providerId, { storageKey });
      } catch {
        // Discovery falls back to presets when the token cannot be read.
      }
    }
    if (providerId === GITHUB_COPILOT_PROVIDER_ID) {
      routeCustomHeaders = githubCopilotRequestHeaders();
      try {
        const userToken = await manager.getCachedAccessToken(providerId, storageKey);
        if (userToken !== undefined && userToken.length > 0) {
          const session = await ensureGitHubCopilotSession(userToken);
          routeBaseUrl = session.apiBaseUrl;
          copilotSessionToken = session.token;
          copilotApiBaseUrl = session.apiBaseUrl;
        }
      } catch {
        // Keep the individual-host default when the cached session cannot be read.
      }
    }
    // Device flows may return a per-account inference endpoint
    // (`resource_url` — Qwen assigns the subscription's portal host). Adopt it
    // as the provider baseUrl so requests follow the assigned endpoint.
    if (loginToken.resourceUrl !== undefined) {
      routeBaseUrl = qwenResourceUrlToBaseUrl(loginToken.resourceUrl) ?? routeBaseUrl;
    }
    // Code Assist logins (Gemini CLI, Antigravity) store the discovered Cloud
    // project id with the token; the runtime needs it in every request envelope.
    let codeAssistProject = loginToken.projectId;
    if (codeAssistProject === undefined && profile.wire === 'code-assist') {
      try {
        codeAssistProject = (await manager.loadToken(providerId, storageKey))?.projectId;
      } catch {
        // Catalog fallback still works; project can be re-discovered on the next login.
      }
    }
    const mergedProvider = mergeProviderOAuthLogin(
      freshConfig.providers[providerId] as Record<string, unknown> | undefined,
      loginRef,
      {
        addAccount,
        type: profile.wire,
        baseUrl: routeBaseUrl,
        ...(routeCustomHeaders !== undefined ? { customHeaders: routeCustomHeaders } : {}),
        ...(codeAssistProject === undefined ? {} : { project: codeAssistProject }),
        ...(providerId === GOOGLE_ANTIGRAVITY_PROVIDER_ID ? { clientIdentity: 'antigravity' } : {}),
        // Factory Droid's whoami exchange resolves the org scope + residency
        // region onto the token; the runtime sends them on every request.
        ...(loginToken.orgId === undefined ? {} : { orgId: loginToken.orgId }),
        ...(loginToken.region === undefined ? {} : { region: loginToken.region }),
      },
    );
    freshConfig.providers[providerId] = mergedProvider as (typeof freshConfig.providers)[string];

    // Resolve the model list from a live catalog when possible (models.dev for
    // most OAuth providers; Cursor AvailableModels for cursor-oauth; Copilot
    // /models after session exchange), falling back to the profile preset.
    let liveDiscoveryError: unknown;
    const resolvedModels = await resolveOAuthProviderModels(providerId, profile.models, {
      accessToken,
      storageKey,
      liveModelsBaseUrl: profile.liveModels === true ? profile.apiBaseUrl : undefined,
      copilotSession:
        copilotSessionToken === undefined || copilotApiBaseUrl === undefined
          ? undefined
          : { token: copilotSessionToken, apiBaseUrl: copilotApiBaseUrl },
      onLiveDiscoveryFailed: (error) => {
        liveDiscoveryError = error;
      },
    });
    if (resolvedModels !== undefined && resolvedModels.length > 0) {
      if (providerId === CURSOR_OAUTH_PROVIDER_ID) {
        applyCursorOAuthModelAliases(
          freshConfig,
          resolvedModels.map((alias) => ({
            id: alias.model,
            displayName: alias.displayName ?? alias.model,
            maxContextSize: alias.maxContextSize,
            capabilities: alias.capabilities ?? [],
          })),
        );
      } else {
        const models = freshConfig.models ?? {};
        for (const alias of resolvedModels) {
          models[`${providerId}/${alias.model}`] = alias;
        }
        freshConfig.models = models;
      }
    }

    await host.harness.setConfig({
      providers: freshConfig.providers,
      models: freshConfig.models,
    });

    await host.authFlow.refreshConfigAfterLogin();
    void refreshProviderQuotaOnHost(host);
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
    if (xaiRouteLabel !== undefined) {
      host.showStatus(ttui('tui.provider.xaiRouteSelected', { route: xaiRouteLabel }));
    }
    host.showNotice(ttui('tui.provider.mediaHint'));

    // Live discovery misses must be visible — otherwise the picker opens on a
    // small preset list and looks broken rather than degraded.
    if (liveDiscoveryError !== undefined) {
      host.showNotice(
        ttui('tui.provider.liveModelsFallback', {
          name: profile.displayName,
          message: formatErrorMessage(liveDiscoveryError),
        }),
      );
    }

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
    const followUp = oauthLoginFollowUp(providerId, error);
    if (followUp !== undefined) host.showNotice(followUp);
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
    ...(preset.supportEfforts !== undefined
      ? { supportEfforts: [...preset.supportEfforts] }
      : {}),
    ...(preset.defaultEffort !== undefined ? { defaultEffort: preset.defaultEffort } : {}),
    displayName: preset.displayName,
  };
}

export interface ResolveOAuthProviderModelsOptions {
  /** Fresh access token; used for Cursor AvailableModels discovery. */
  readonly accessToken?: string;
  /**
   * When set (and `accessToken` is present), fetch `{baseUrl}/models` and
   * prefer the live OpenAI-style list over catalog/presets. Used by
   * aggregators whose catalog churns daily (Nous Portal).
   */
  readonly liveModelsBaseUrl?: string;
  /** Copilot session token + API host after `ensureGitHubCopilotSession`. */
  readonly copilotSession?: { readonly token: string; readonly apiBaseUrl: string };
  /**
   * Credential storage key for the Cursor fallback lookup. Multi-account
   * logins resolve the access token with this key up front; the fallback must
   * use the same key instead of the provider default.
   */
  readonly storageKey?: string;
  /**
   * Invoked when a provider's preferred live discovery fails and resolution
   * falls back to catalog/preset models, so the caller can warn instead of
   * silently opening a stub picker.
   */
  readonly onLiveDiscoveryFailed?: (error: unknown) => void;
}

/**
 * Live Devin discovery gets a longer budget plus one retry — the 5s default
 * loses races on a cold connection right after the browser round-trip.
 */
const DEVIN_DISCOVERY_TIMEOUT_MS = 15_000;

async function fetchDevinModelsWithRetry(
  liveToken: string,
): Promise<readonly DevinDiscoveredModel[] | null> {
  const attempt = (): Promise<readonly DevinDiscoveredModel[] | null> =>
    fetchDevinModels({ apiKey: liveToken, timeoutMs: DEVIN_DISCOVERY_TIMEOUT_MS });
  const first = await attempt();
  return first === null ? attempt() : first;
}

/**
 * Resolves the model list for an OAuth provider. Prefers a live catalog
 * (Cursor AvailableModels for `cursor-oauth`, models.dev otherwise) and falls
 * back to the profile preset when discovery fails. Returns `undefined` when
 * neither source yields models.
 */
export async function resolveOAuthProviderModels(
  providerId: string,
  presets: readonly ProviderModelPreset[] | undefined,
  options: ResolveOAuthProviderModelsOptions = {},
): Promise<readonly ModelAlias[] | undefined> {
  const liveToken = options.accessToken?.trim();
  if (providerId === DEVIN_PROVIDER_ID && liveToken !== undefined && liveToken.length > 0) {
    try {
      const live = await fetchDevinModelsWithRetry(liveToken);
      if (live !== null && live.length > 0) {
        return live.map((model) =>
          presetModelToAlias(providerId, {
            id: model.id,
            displayName: model.name,
            maxContextSize: model.contextWindow,
            capabilities: [
              ...(model.supportsTools ? ['tool_use'] : []),
              ...(model.supportsImages ? ['image_in'] : []),
              ...(model.reasoning ? ['thinking'] : []),
            ],
          }),
        );
      }
      options.onLiveDiscoveryFailed?.(new Error('GetCliModelConfigs returned no usable models'));
    } catch (error) {
      log.warn(
        `Failed to load Devin model configs for "${providerId}", using preset.`,
        formatErrorMessage(error),
      );
      options.onLiveDiscoveryFailed?.(error);
    }
  }

  // Factory has no model-listing endpoint; first-party clients ship the
  // roster — the kosong registry doubles as the model catalog here.
  if (providerId === FACTORY_DROID_PROVIDER_ID) {
    const roster = factoryDroidModels();
    return Object.entries(roster).map(([id, route]) =>
      presetModelToAlias(providerId, {
        id,
        displayName: route.displayName,
        maxContextSize: route.contextWindow,
        capabilities: [
          'tool_use',
          ...(route.supportsImages ? ['image_in'] : []),
          ...(route.reasoning ? ['thinking'] : []),
        ],
      }),
    );
  }

  const liveBaseUrl = options.liveModelsBaseUrl?.replace(/\/+$/, '');
  if (liveBaseUrl !== undefined && liveToken !== undefined && liveToken.length > 0) {
    try {
      const live = await fetchOpenAiModelPresets(liveBaseUrl, liveToken);
      if (live.length > 0) {
        return live.map((preset) => presetModelToAlias(providerId, preset));
      }
    } catch (error) {
      log.warn(
        `Failed to load live /models list for "${providerId}", using preset.`,
        formatErrorMessage(error),
      );
    }
  }

  if (providerId === GITHUB_COPILOT_PROVIDER_ID && options.copilotSession !== undefined) {
    try {
      const live = await fetchGitHubCopilotModels({
        token: options.copilotSession.token,
        expiresAtSec: 0,
        apiBaseUrl: options.copilotSession.apiBaseUrl,
      });
      if (live !== undefined && live.length > 0) {
        return live.map((preset) => presetModelToAlias(providerId, preset));
      }
    } catch (error) {
      log.warn(
        `Failed to load GitHub Copilot models for "${providerId}", using preset.`,
        formatErrorMessage(error),
      );
    }
  }

  if (providerId === CURSOR_OAUTH_PROVIDER_ID) {
    let token = options.accessToken?.trim();
    if (token === undefined || token.length === 0) {
      try {
        token = await new OAuthProviderManager().ensureFresh(providerId, {
          storageKey: options.storageKey,
        });
      } catch {
        token = undefined;
      }
    }
    if (token !== undefined && token.length > 0) {
      try {
        const live = await fetchCursorAvailableModels({ accessToken: token });
        if (live !== undefined && live.length > 0) {
          return live.map((model) => {
            const preset = cursorModelsToPresets([model])[0];
            return preset === undefined
              ? presetModelToAlias(providerId, {
                  id: model.id,
                  displayName: model.displayName,
                  maxContextSize: model.maxContextSize,
                  capabilities: model.capabilities,
                })
              : presetModelToAlias(providerId, preset);
          });
        }
      } catch (error) {
        log.warn(
          `Failed to load Cursor AvailableModels for "${providerId}", using preset.`,
          formatErrorMessage(error),
        );
      }
    }
    if (presets !== undefined && presets.length > 0) {
      return presets.map((preset) => presetModelToAlias(providerId, preset));
    }
    return undefined;
  }

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
    options.onLiveDiscoveryFailed?.(error);
  }
  if (presets !== undefined && presets.length > 0) {
    return presets.map((preset) => presetModelToAlias(providerId, preset));
  }
  return undefined;
}

/**
 * Fetches an OpenAI-compatible `GET {baseUrl}/models` listing and maps it to
 * model presets. Models carry no context-size metadata on this endpoint, so
 * the alias inherits the profile's declared default (128k is the safe floor
 * for aggregator-hosted frontier models; users can bump it in config).
 */
async function fetchOpenAiModelPresets(
  baseUrl: string,
  accessToken: string,
): Promise<readonly ProviderModelPreset[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, 15_000);
  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`GET ${baseUrl}/models failed (HTTP ${String(response.status)})`);
    }
    const payload = (await response.json()) as { data?: unknown };
    const list = Array.isArray(payload.data) ? payload.data : [];
    const presets: ProviderModelPreset[] = [];
    for (const entry of list) {
      if (typeof entry !== 'object' || entry === null) continue;
      const id = (entry as { id?: unknown }).id;
      if (typeof id !== 'string' || id.length === 0) continue;
      const contextLength = (entry as { context_length?: unknown }).context_length;
      presets.push({
        id,
        displayName: id,
        maxContextSize:
          typeof contextLength === 'number' && Number.isFinite(contextLength) && contextLength > 0
            ? contextLength
            : 131072,
      });
    }
    return presets;
  } finally {
    clearTimeout(timer);
  }
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
      currentValue: 'refresh',
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
