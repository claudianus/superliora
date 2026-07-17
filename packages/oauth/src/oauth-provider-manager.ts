/**
 * OAuth provider manager — a multi-provider layer that sits on top of
 * {@link OAuthManager}. Each OAuth-capable provider gets its own manager
 * instance whose refresh/login impls are wired to the provider's flow
 * (Kimi device-code, OpenAI device-code, xAI PKCE browser). Tokens are stored
 * per-provider via {@link FileTokenStorage}.
 *
 * This intentionally does **not** touch `KimiOAuthToolkit`: the Kimi path keeps
 * its managed-config provisioning and device headers, while non-Kimi OAuth
 * providers route through here with the simpler token-only lifecycle.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

import { OAuthError } from './errors';
import {
  refreshPkceToken,
  runPkceBrowserFlow,
  type GenericPkceFlowConfig,
} from './oauth-flow-http';
import {
  refreshOpenAiToken,
  runOpenAiBrowserFlow,
  runOpenAiDeviceFlow,
  toTokenInfo as toOpenAiTokenInfo,
  type OpenAIDeviceCode,
} from './oauth-flow-openai';
import {
  refreshXaiToken,
  resolveXaiEndpoints,
  runXaiBrowserFlow,
  toTokenInfo as toXaiTokenInfo,
} from './oauth-flow-xai';
import { OAuthManager, type LoginOptions, type OAuthRefreshOutcome } from './oauth-manager';
import { requestDeviceAuthorization, pollDeviceToken, refreshAccessToken } from './oauth';
import { FileTokenStorage, type TokenStorage } from './storage';
import type { DeviceAuthorization, TokenInfo } from './types';
import {
  getProviderProfile,
  type ProviderFlowConfig,
  type ProviderProfile,
} from './profiles';

export interface OAuthProviderManagerOptions {
  readonly homeDir?: string;
  readonly storage?: TokenStorage;
  readonly onRefresh?: (outcome: OAuthRefreshOutcome) => void;
}

export interface ProviderLoginOptions extends LoginOptions {
  /**
   * Hint to use the browser flow when a provider supports both device-code and
   * PKCE. Defaults to `false` (device-code where available).
   */
  readonly preferBrowser?: boolean;
  /**
   * Explicit credential storage key. Used by multi-account login so each
   * account gets its own `~/.superliora/credentials/<key>.json` file instead
   * of overwriting the provider default.
   */
  readonly storageKey?: string;
}

export interface ProviderLoginCallbacks {
  /** Called with the device code / verification URL for device flows. */
  readonly onDeviceCode?: (auth: DeviceAuthorization) => Promise<void> | void;
  /** Called with the authorize URL for browser flows; the caller opens it. */
  readonly onAuthorizeUrl?: (url: string) => Promise<void> | void;
  /**
   * Optional fallback for PKCE browser flows when the loopback callback cannot
   * reach this process. Prompt the user to paste the callback URL/code.
   */
  readonly onManualCallbackPrompt?: (context: {
    readonly signal: AbortSignal;
    readonly lastError?: string;
  }) => Promise<string | undefined>;
}

export class OAuthProviderManager {
  private readonly homeDir: string;
  private readonly storage: TokenStorage;
  private readonly onRefresh: ((outcome: OAuthRefreshOutcome) => void) | undefined;
  private readonly managers = new Map<string, OAuthManager>();

  constructor(options: OAuthProviderManagerOptions = {}) {
    const override = process.env['SUPERLIORA_HOME'];
    this.homeDir =
      options.homeDir ??
      (override !== undefined && override.length > 0 ? override : join(homedir(), '.superliora'));
    this.storage = options.storage ?? new FileTokenStorage(join(this.homeDir, 'credentials'));
    this.onRefresh = options.onRefresh;
  }

  /** The default credential storage name for a provider (also the filename). */
  storageName(providerId: string): string {
    return providerId.replace(/^managed:/, '').replaceAll(/[^a-zA-Z0-9._-]/g, '-');
  }

  /** Returns whether a token is persisted for the provider/storage key. */
  async hasToken(providerId: string, storageKey?: string): Promise<boolean> {
    return this.managerFor(providerId, storageKey).hasToken();
  }

  /** Returns a cached access token without forcing a refresh. */
  async getCachedAccessToken(
    providerId: string,
    storageKey?: string,
  ): Promise<string | undefined> {
    return this.managerFor(providerId, storageKey).getCachedAccessToken();
  }

  /** Returns a valid access token, refreshing when necessary. */
  async ensureFresh(
    providerId: string,
    options: { readonly force?: boolean; readonly storageKey?: string } = {},
  ): Promise<string> {
    return this.managerFor(providerId, options.storageKey).ensureFresh(options);
  }

  /** Removes the persisted token for the provider/storage key. */
  async logout(providerId: string, storageKey?: string): Promise<void> {
    await this.managerFor(providerId, storageKey).logout();
  }

  /**
   * Runs the provider's OAuth login flow. Device-code providers call
   * `callbacks.onDeviceCode`; PKCE-browser providers call
   * `callbacks.onAuthorizeUrl`. Returns the token bundle and persists it.
   */
  async login(
    providerId: string,
    callbacks: ProviderLoginCallbacks = {},
    options: ProviderLoginOptions = {},
  ): Promise<TokenInfo> {
    const profile = getProviderProfile(providerId);
    if (profile === undefined) {
      throw new OAuthError(`No OAuth profile for provider "${providerId}".`);
    }
    switch (profile.flow.kind) {
      case 'device_code_kimi':
        return this.loginDeviceCodeKimi(profile, callbacks, options);
      case 'device_code_openai':
        return this.loginDeviceCodeOpenai(profile, callbacks, options);
      case 'pkce_browser':
        return this.loginPkceBrowser(profile, callbacks, options);
    }
  }

  /**
   * Builds (and caches) the {@link OAuthManager} for a provider + storage key.
   * Multi-account pools use one manager per storage key so each account has
   * its own token file and refresh lock.
   */
  managerFor(providerId: string, storageKey?: string): OAuthManager {
    const profile = getProviderProfile(providerId);
    if (profile === undefined) {
      throw new OAuthError(`No OAuth profile for provider "${providerId}".`);
    }
    const resolvedKey = storageKey ?? this.storageName(providerId);
    const cacheKey = `${providerId}\0${resolvedKey}`;
    let manager = this.managers.get(cacheKey);
    if (manager !== undefined) return manager;

    manager = this.createManager(profile, resolvedKey);
    this.managers.set(cacheKey, manager);
    return manager;
  }

  private createManager(profile: ProviderProfile, storageName: string): OAuthManager {
    const flow = profile.flow;
    return new OAuthManager({
      config: { ...flow, name: storageName },
      storage: this.storage,
      configDir: this.homeDir,
      onRefresh: this.onRefresh,
      refreshTokenImpl: (config, refreshToken) =>
        refreshForFlow(flow, config.name, refreshToken),
    });
  }

  private async loginDeviceCodeKimi(
    profile: ProviderProfile,
    callbacks: ProviderLoginCallbacks,
    options: ProviderLoginOptions,
  ): Promise<TokenInfo> {
    const manager = this.managerFor(profile.id);
    // The Kimi manager's default requestDevice/poll/refresh impls already hit
    // the Kimi endpoints via the shared `oauth.ts` wrappers.
    return manager.login({
      signal: options.signal,
      onDeviceCode: callbacks.onDeviceCode,
    });
  }

  private async loginDeviceCodeOpenai(
    profile: ProviderProfile,
    callbacks: ProviderLoginCallbacks,
    options: ProviderLoginOptions,
  ): Promise<TokenInfo> {
    // The OpenAI device flow returns its own code_verifier, so we run it
    // directly and store the resulting token.
    const token = await runOpenAiDeviceFlow(profile.flow, {
      onUserCode: (deviceCode: OpenAIDeviceCode) =>
        callbacks.onDeviceCode?.(openAiDeviceCodeToAuthorization(deviceCode)),
      signal: options.signal,
    });
    const tokenInfo = toOpenAiTokenInfo(token);
    const storageKey = options.storageKey ?? this.storageName(profile.id);
    await this.storage.save(storageKey, tokenInfo);
    return tokenInfo;
  }

  private async loginPkceBrowser(
    profile: ProviderProfile,
    callbacks: ProviderLoginCallbacks,
    options: ProviderLoginOptions,
  ): Promise<TokenInfo> {
    const token =
      profile.id === 'xai-grok'
        ? toXaiTokenInfo(
            await runXaiBrowserFlow(profile.flow, {
              onAuthorizeUrl: callbacks.onAuthorizeUrl,
              onManualCallbackPrompt: callbacks.onManualCallbackPrompt,
              signal: options.signal,
            }),
          )
        : profile.id === 'anthropic-oauth'
          ? toXaiTokenInfo(
              await runPkceBrowserFlow(toGenericPkceConfig(profile.flow), {
                onAuthorizeUrl: callbacks.onAuthorizeUrl,
                onManualCallbackPrompt: callbacks.onManualCallbackPrompt,
                signal: options.signal,
              }),
            )
          : toOpenAiTokenInfo(
              await runOpenAiBrowserFlow(profile.flow, {
                onAuthorizeUrl: callbacks.onAuthorizeUrl,
                onManualCallbackPrompt: callbacks.onManualCallbackPrompt,
                signal: options.signal,
              }),
            );
    const storageKey = options.storageKey ?? this.storageName(profile.id);
    await this.storage.save(storageKey, token);
    return token;
  }
}

/** Adapts a ProviderFlowConfig to the GenericPkceFlowConfig shape. */
function toGenericPkceConfig(flow: ProviderFlowConfig): GenericPkceFlowConfig {
  return {
    clientId: flow.clientId,
    scope: flow.scope,
    callbackPort: flow.callbackPort,
    authorizeUrl: flow.authorizeUrl ?? `${flow.oauthHost}/oauth/authorize`,
    tokenUrl: flow.tokenUrl ?? `${flow.oauthHost}/oauth2/token`,
  };
}

/** Resolves the refresh implementation for a flow kind. */
async function refreshForFlow(
  flow: ProviderFlowConfig,
  _storageName: string,
  refreshToken: string,
): Promise<TokenInfo> {
  switch (flow.kind) {
    case 'device_code_kimi':
      return refreshAccessToken({ ...flow, name: _storageName }, refreshToken, {});
    case 'device_code_openai': {
      const token = await refreshOpenAiToken(flow, refreshToken);
      return toOpenAiTokenInfo(token);
    }
    case 'pkce_browser': {
      if (flow.oauthHost.includes('x.ai')) {
        const { tokenUrl } = await resolveXaiEndpoints(flow);
        const token = await refreshXaiToken(flow, refreshToken, tokenUrl);
        return toXaiTokenInfo(token);
      }
      if (flow.oauthHost.includes('anthropic')) {
        const token = await refreshPkceToken(toGenericPkceConfig(flow), refreshToken);
        return toXaiTokenInfo(token);
      }
      const token = await refreshOpenAiToken(flow, refreshToken);
      return toOpenAiTokenInfo(token);
    }
  }
}

function openAiDeviceCodeToAuthorization(deviceCode: OpenAIDeviceCode): DeviceAuthorization {
  return {
    userCode: deviceCode.userCode,
    deviceCode: deviceCode.deviceAuthId,
    verificationUri: deviceCode.verificationUri,
    verificationUriComplete: `${deviceCode.verificationUri}?code=${deviceCode.userCode}`,
    expiresIn: null,
    interval: deviceCode.interval,
  };
}

// Re-export the Kimi device-code request/poll impls for completeness.
export { pollDeviceToken, requestDeviceAuthorization };
