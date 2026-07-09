import { readConfigFile, writeConfigFile } from '../../config';
import type { LioraConfig, OAuthRef } from '../../config';
import type { OAuthTokenProviderResolver } from '../../session/provider-manager';
import {
  applyManagedKimiCodeConfig,
  applyManagedKimiCodeLogoutConfig,
  SUPERLIORA_PROVIDER_NAME,
  KimiOAuthToolkit,
  OAuthProviderManager,
  isOAuthProviderId,
  resolveKimiCodeLoginAuth,
  resolveKimiCodeRuntimeAuth,
  type BearerTokenProvider,
  type KimiOAuthLoginOptions,
  type ManagedKimiConfigShape,
} from '@superliora/oauth';

import type { IEnvironmentService } from '../environment/environment';

type ServicesManagedConfig = LioraConfig & ManagedKimiConfigShape;

type ServicesAuthLoginOptions = Omit<KimiOAuthLoginOptions, 'provisionConfig'>;

interface ServicesAuthLoginResult {
  readonly providerName: string;
  readonly ok: true;
  readonly defaultModel: string;
  readonly defaultThinking: boolean;
  readonly configPath?: string | undefined;
}

interface ServicesAuthLogoutResult {
  readonly providerName: string;
  readonly ok: true;
}

export interface ServicesAuthFacade {
  login(
    providerName?: string | undefined,
    options?: ServicesAuthLoginOptions,
  ): Promise<ServicesAuthLoginResult>;
  logout(providerName?: string | undefined): Promise<ServicesAuthLogoutResult>;
  getCachedAccessToken(
    providerName?: string,
    oauthRef?: OAuthRef | undefined,
  ): Promise<string | undefined>;
  readonly resolveOAuthTokenProvider: OAuthTokenProviderResolver;
}

class ServicesManagedAuthFacade implements ServicesAuthFacade {
  private readonly toolkit: KimiOAuthToolkit<ServicesManagedConfig>;
  private readonly providerManager: OAuthProviderManager;

  constructor(
    private readonly options: Pick<IEnvironmentService, 'homeDir' | 'configPath'>,
  ) {
    this.toolkit = new KimiOAuthToolkit<ServicesManagedConfig>({
      homeDir: options.homeDir,
      configAdapter: {
        configPath: options.configPath,
        read: () => readConfigFile(options.configPath) as ServicesManagedConfig,
        write: async (config) => {
          await writeConfigFile(options.configPath, config);
        },
        apply: applyManagedKimiCodeConfig,
        remove: applyManagedKimiCodeLogoutConfig,
      },
    });
    // Non-Kimi OAuth providers (xAI Grok, OpenAI Codex, …) logged in via
    // `/connect` store their tokens through OAuthProviderManager. Reusing the
    // same homeDir keeps request-time resolution pointed at the credential
    // file login wrote (`~/.superliora/credentials/<provider>.json`).
    this.providerManager = new OAuthProviderManager({ homeDir: options.homeDir });
  }

  async login(
    providerName: string | undefined = SUPERLIORA_PROVIDER_NAME,
    options: ServicesAuthLoginOptions = {},
  ): Promise<ServicesAuthLoginResult> {
    const auth = this.resolveManagedAuth(providerName);
    const loginAuth = resolveKimiCodeLoginAuth({
      configuredBaseUrl: auth.baseUrl,
      configuredOAuthRef: auth.oauthRef,
      requestedBaseUrl: options.baseUrl,
      requestedOAuthHost: options.oauthHost,
    });
    const result = await this.toolkit.login(providerName, {
      ...options,
      baseUrl: loginAuth.baseUrl,
      oauthHost: loginAuth.oauthHost,
      oauthRef: options.oauthRef ?? loginAuth.oauthRef,
      provisionConfig: true,
    });
    if (result.provision === undefined) {
      throw new Error('Kimi auth login did not provision model config.');
    }
    return {
      providerName: result.providerName,
      ok: true,
      defaultModel: result.provision.defaultModel,
      defaultThinking: result.provision.defaultThinking,
      configPath: result.provision.configPath,
    };
  }

  async logout(
    providerName?: string | undefined,
  ): Promise<ServicesAuthLogoutResult> {
    const name = providerName ?? SUPERLIORA_PROVIDER_NAME;
    if (this.isNonKimiOAuthProvider(name)) {
      await this.providerManager.logout(name);
      return { providerName: name, ok: true };
    }
    const result = await this.toolkit.logout(
      providerName,
      this.resolveRuntimeManagedAuth(providerName).oauthRef,
    );
    return {
      providerName: result.providerName,
      ok: result.ok,
    };
  }

  async getCachedAccessToken(
    providerName?: string,
    oauthRef?: OAuthRef | undefined,
  ): Promise<string | undefined> {
    const name = providerName ?? SUPERLIORA_PROVIDER_NAME;
    if (this.isNonKimiOAuthProvider(name)) {
      return this.providerManager.getCachedAccessToken(name);
    }
    return this.toolkit.getCachedAccessToken(
      providerName,
      this.runtimeOAuthRef(providerName, oauthRef),
    );
  }

  readonly resolveOAuthTokenProvider = (
    providerName: string,
    oauthRef?: OAuthRef | undefined,
  ): BearerTokenProvider => {
    if (this.isNonKimiOAuthProvider(providerName)) {
      return {
        getAccessToken: (options) =>
          this.providerManager.ensureFresh(providerName, options ?? {}),
      };
    }
    return this.toolkit.tokenProvider(
      providerName,
      this.runtimeOAuthRef(providerName, oauthRef),
    );
  };

  private resolveManagedAuth(providerName?: string | undefined): {
    readonly oauthRef?: OAuthRef | undefined;
    readonly baseUrl?: string | undefined;
  } {
    const name = providerName ?? SUPERLIORA_PROVIDER_NAME;
    const config = readConfigFile(this.options.configPath);
    const provider = config.providers[name];
    return {
      oauthRef: provider?.oauth,
      baseUrl: provider?.baseUrl,
    };
  }

  private resolveRuntimeManagedAuth(providerName?: string | undefined): {
    readonly oauthRef: OAuthRef;
    readonly baseUrl?: string | undefined;
  } {
    const auth = this.resolveManagedAuth(providerName);
    return resolveKimiCodeRuntimeAuth({
      configuredBaseUrl: auth.baseUrl,
      configuredOAuthRef: auth.oauthRef,
    });
  }

  private runtimeOAuthRef(
    providerName: string | undefined,
    oauthRef?: OAuthRef | undefined,
  ): OAuthRef | undefined {
    if ((providerName ?? SUPERLIORA_PROVIDER_NAME) !== SUPERLIORA_PROVIDER_NAME) {
      return oauthRef;
    }
    const auth = this.resolveManagedAuth(providerName);
    return resolveKimiCodeRuntimeAuth({
      configuredBaseUrl: auth.baseUrl,
      configuredOAuthRef: oauthRef ?? auth.oauthRef,
    }).oauthRef;
  }

  /**
   * Whether `providerName` is a non-Kimi OAuth provider (xAI Grok, OpenAI
   * Codex, …). These route through {@link OAuthProviderManager} at request
   * time instead of the Kimi toolkit, which only accepts the managed Kimi
   * provider name.
   */
  private isNonKimiOAuthProvider(providerName: string): boolean {
    return (
      providerName !== SUPERLIORA_PROVIDER_NAME && isOAuthProviderId(providerName)
    );
  }
}

export function createManagedAuthFacade(
  env: Pick<IEnvironmentService, 'homeDir' | 'configPath'>,
): ServicesAuthFacade {
  return new ServicesManagedAuthFacade(env);
}
