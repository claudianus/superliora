import {
  ErrorCodes,
  LioraError,
  resolveLioraHome,
  type Logger,
  type ModelProvider,
  type ResolvedRuntimeProvider,
} from '@superliora/agent-core';
import {
  createKimiDefaultHeaders,
  SUPERLIORA_FLOW_CONFIG,
  SUPERLIORA_PROVIDER_NAME,
  KimiOAuthToolkit,
  kimiCodeBaseUrl,
  resolveKimiCodeOAuthRef,
  type KimiHostIdentity,
  type ManagedKimiOAuthRef,
} from '@superliora/oauth';
import type {
  ProviderConfig as KosongProviderConfig,
  ProviderRequestAuth,
} from '@superliora/kosong';
import { APIStatusError, UNKNOWN_CAPABILITY } from '@superliora/kosong';

import { mapOAuthTokenError } from '#/oauth-error';

export interface KimiForCodingProviderOptions extends KimiHostIdentity {
  readonly homeDir?: string;
  readonly model?: string;
  readonly baseUrl?: string;
  readonly promptCacheKey?: string;
  readonly defaultHeaders?: Record<string, string>;
}

export class KimiForCodingProvider implements ModelProvider {
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly promptCacheKey: string | undefined;
  private readonly defaultHeaders: Record<string, string> | undefined;
  private readonly toolkit: KimiOAuthToolkit;
  private readonly homeDir: string;
  private readonly identity: KimiHostIdentity;
  private readonly oauthRef: ManagedKimiOAuthRef;

  constructor(options: KimiForCodingProviderOptions) {
    this.model = options.model ?? 'kimi-for-coding';
    this.baseUrl = options.baseUrl ?? kimiCodeBaseUrl();
    this.promptCacheKey = options.promptCacheKey;
    this.defaultHeaders = options.defaultHeaders;
    this.homeDir = resolveLioraHome(options.homeDir);
    this.identity = {
      userAgentProduct: options.userAgentProduct,
      version: options.version,
      userAgentSuffix: options.userAgentSuffix,
    };
    this.oauthRef = resolveKimiCodeOAuthRef({
      oauthHost: SUPERLIORA_FLOW_CONFIG.oauthHost,
      baseUrl: this.baseUrl,
    });
    this.toolkit = new KimiOAuthToolkit({
      homeDir: this.homeDir,
      identity: this.identity,
    });
  }

  get defaultModel(): string {
    return this.model;
  }

  resolveProviderConfig(model: string): ResolvedRuntimeProvider {
    if (model !== this.model) {
      throw new LioraError(
        ErrorCodes.CONFIG_INVALID,
        `Model "${model}" is not supported by KimiForCodingProvider.`,
      );
    }

    const provider: KosongProviderConfig = {
      type: 'kimi',
      model: this.model,
      baseUrl: this.baseUrl,
      generationKwargs: this.promptCacheKey
        ? { prompt_cache_key: this.promptCacheKey }
        : undefined,
      defaultHeaders: {
        ...createKimiDefaultHeaders({
          homeDir: this.homeDir,
          ...this.identity,
        }),
        ...this.defaultHeaders,
      },
    };

    return {
      modelAlias: model,
      providerName: 'kimi-for-coding',
      provider,
      modelCapabilities: UNKNOWN_CAPABILITY,
    };
  }

  resolveAuth(_model: string, _options?: { readonly log?: Logger }) {
    return async <T>(request: (auth: ProviderRequestAuth) => Promise<T>): Promise<T> => {
      let auth = await this.buildAuth(false);
      for (let refreshed = false; ; refreshed = true) {
        try {
          return await request(auth);
        } catch (error) {
          const is401 = error instanceof APIStatusError && error.statusCode === 401;
          if (!is401) throw error;
          if (refreshed) {
            throw new LioraError(
              ErrorCodes.AUTH_LOGIN_REQUIRED,
              'OAuth token was rejected after refresh. Run /login to re-authenticate.',
              { cause: error },
            );
          }
          auth = await this.buildAuth(true);
        }
      }
    };
  }

  private async buildAuth(force: boolean): Promise<ProviderRequestAuth> {
    try {
      const apiKey = await this.toolkit.ensureFresh(SUPERLIORA_PROVIDER_NAME, {
        force,
        oauthRef: this.oauthRef,
      });
      return { apiKey };
    } catch (error) {
      // Classify OAuth token failures into the public LioraError protocol so the
      // turn surfaces `auth.login_required` / `provider.connection_error`
      // instead of collapsing everything to `internal`. Unrecognized errors are
      // rethrown raw (see mapOAuthTokenError).
      throw mapOAuthTokenError(error, SUPERLIORA_PROVIDER_NAME) ?? error;
    }
  }
}
