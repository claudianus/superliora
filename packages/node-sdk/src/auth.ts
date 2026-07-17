import {
  loadRuntimeConfigSafe,
  readConfigFile,
  readConfigFileForUpdate,
  writeConfigFile,
  type LioraConfig,
  type OAuthRef,
} from '@superliora/agent-core';
import {
  applyManagedKimiCodeConfig,
  applyManagedKimiCodeLogoutConfig,
  SUPERLIORA_PROVIDER_NAME,
  isOAuthProviderId,
  KimiOAuthToolkit,
  OAuthProviderManager,
  resolveKimiCodeLoginAuth,
  resolveKimiCodeRuntimeAuth,
  type AuthManagedUsageResult,
  type AuthStatus,
  type BearerTokenProvider,
  type FetchCompleteFeedbackUploadResult,
  type FetchFeedbackUploadError,
  type FetchSubmitFeedbackResult,
  type KimiHostIdentity,
  type KimiOAuthLoginOptions,
  type ManagedKimiConfigShape,
  type OAuthRefreshOutcome,
} from '@superliora/oauth';

import { mapOAuthTokenError } from '#/oauth-error';

export interface LioraAuthSubmitFeedbackInput {
  readonly content: string;
  readonly sessionId: string;
  readonly version: string;
  readonly os: string;
  readonly model: string | null;
  readonly contact?: string;
  readonly info?: Record<string, unknown>;
}

export interface LioraAuthCreateFeedbackUploadUrlInput {
  readonly feedbackId: number;
  readonly filename: string;
  readonly size: number;
  readonly sha256: string;
}

export interface LioraAuthCompleteFeedbackUploadPart {
  readonly partNumber: number;
  readonly etag: string;
}

export interface LioraAuthCompleteFeedbackUploadInput {
  readonly uploadId: number;
  readonly parts: readonly LioraAuthCompleteFeedbackUploadPart[];
}

export interface LioraAuthFeedbackUploadPart {
  readonly partNumber: number;
  readonly url: string;
  readonly method: string;
  readonly size: number;
}

export interface LioraAuthCreateFeedbackUploadUrlOk {
  readonly kind: 'ok';
  readonly uploadId: number;
  readonly parts: readonly LioraAuthFeedbackUploadPart[];
}

export type LioraAuthCreateFeedbackUploadUrlResult =
  | LioraAuthCreateFeedbackUploadUrlOk
  | FetchFeedbackUploadError;

export type LioraAuthLoginOptions = Omit<KimiOAuthLoginOptions, 'provisionConfig'>;

export interface LioraAuthLoginResult {
  readonly providerName: string;
  readonly ok: true;
  readonly defaultModel: string;
  readonly defaultThinking: boolean;
  readonly configPath?: string | undefined;
}

export interface LioraAuthLogoutResult {
  readonly providerName: string;
  readonly ok: true;
}

export interface LioraAuthFacadeOptions {
  readonly homeDir: string;
  readonly configPath: string;
  readonly identity?: KimiHostIdentity | undefined;
  readonly onConfigUpdated?: ((config: LioraConfig) => void) | undefined;
  readonly onRefresh?: ((outcome: OAuthRefreshOutcome) => void) | undefined;
}

type SDKManagedConfig = LioraConfig & ManagedKimiConfigShape;

export class LioraAuthFacade {
  private readonly toolkit: KimiOAuthToolkit<SDKManagedConfig>;
  private readonly providerManager: OAuthProviderManager;

  constructor(private readonly options: LioraAuthFacadeOptions) {
    this.toolkit = new KimiOAuthToolkit<SDKManagedConfig>({
      homeDir: options.homeDir,
      identity: options.identity,
      onRefresh: options.onRefresh,
      configAdapter: {
        configPath: options.configPath,
        // Write-path base read: strict (a salvaged base would drop the user's
        // broken-but-fixable sections on rewrite) with an actionable message.
        read: () => readConfigFileForUpdate(options.configPath) as SDKManagedConfig,
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
    this.providerManager = new OAuthProviderManager({
      homeDir: options.homeDir,
      onRefresh: options.onRefresh,
    });
  }

  async status(providerName?: string | undefined): Promise<AuthStatus> {
    return this.toolkit.status(providerName, this.resolveRuntimeManagedAuth(providerName).oauthRef);
  }

  async login(
    providerName: string | undefined = SUPERLIORA_PROVIDER_NAME,
    options: LioraAuthLoginOptions = {},
  ): Promise<LioraAuthLoginResult> {
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
    const updated = readConfigFile(this.options.configPath);
    this.options.onConfigUpdated?.(updated);
    return {
      providerName: result.providerName,
      ok: true,
      defaultModel: result.provision.defaultModel,
      defaultThinking: result.provision.defaultThinking,
      configPath: result.provision.configPath,
    };
  }

  async logout(providerName?: string | undefined): Promise<LioraAuthLogoutResult> {
    const name = providerName ?? SUPERLIORA_PROVIDER_NAME;
    if (this.isNonKimiOAuthProvider(name)) {
      await this.providerManager.logout(name);
      return { providerName: name, ok: true };
    }
    const result = await this.toolkit.logout(
      providerName,
      this.resolveRuntimeManagedAuth(providerName).oauthRef,
    );
    const updated = readConfigFile(this.options.configPath);
    this.options.onConfigUpdated?.(updated);
    return {
      providerName: result.providerName,
      ok: result.ok,
    };
  }

  async getManagedUsage(providerName?: string | undefined): Promise<AuthManagedUsageResult> {
    const auth = this.resolveRuntimeManagedAuth(providerName);
    return this.toolkit.getManagedUsage(providerName, {
      oauthRef: auth.oauthRef,
      baseUrl: auth.baseUrl,
    });
  }

  async submitFeedback(
    input: LioraAuthSubmitFeedbackInput,
    providerName?: string | undefined,
  ): Promise<FetchSubmitFeedbackResult> {
    const auth = this.resolveRuntimeManagedAuth(providerName);
    return this.toolkit.submitFeedback(
      {
        session_id: input.sessionId,
        content: input.content,
        version: input.version,
        os: input.os,
        model: input.model,
        contact: input.contact,
        info: input.info,
      },
      providerName,
      {
        oauthRef: auth.oauthRef,
        baseUrl: auth.baseUrl,
      },
    );
  }

  async createFeedbackUploadUrl(
    input: LioraAuthCreateFeedbackUploadUrlInput,
    providerName?: string | undefined,
  ): Promise<LioraAuthCreateFeedbackUploadUrlResult> {
    const auth = this.resolveRuntimeManagedAuth(providerName);
    const result = await this.toolkit.createFeedbackUploadUrl(
      {
        file_hash: input.sha256,
        file_name: input.filename,
        file_size: input.size,
        feedback_id: input.feedbackId,
      },
      providerName,
      {
        oauthRef: auth.oauthRef,
        baseUrl: auth.baseUrl,
      },
    );
    if (result.kind !== 'ok') return result;
    return {
      kind: 'ok',
      uploadId: result.upload_id,
      parts: result.parts.map((part) => ({
        partNumber: part.part_number,
        url: part.url,
        method: part.method,
        size: part.size,
      })),
    };
  }

  async completeFeedbackUpload(
    input: LioraAuthCompleteFeedbackUploadInput,
    providerName?: string | undefined,
  ): Promise<FetchCompleteFeedbackUploadResult> {
    const auth = this.resolveRuntimeManagedAuth(providerName);
    return this.toolkit.completeFeedbackUpload(
      {
        upload_id: input.uploadId,
        parts: input.parts.map((part) => ({ part_number: part.partNumber, etag: part.etag })),
      },
      providerName,
      {
        oauthRef: auth.oauthRef,
        baseUrl: auth.baseUrl,
      },
    );
  }

  async getCachedAccessToken(
    providerName?: string,
    oauthRef?: OAuthRef | undefined,
  ): Promise<string | undefined> {
    const name = providerName ?? SUPERLIORA_PROVIDER_NAME;
    if (this.isNonKimiOAuthProvider(name)) {
      return this.providerManager.getCachedAccessToken(name, oauthRef?.key);
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
          this.providerManager.ensureFresh(providerName, {
            ...(options ?? {}),
            ...(oauthRef?.key === undefined ? {} : { storageKey: oauthRef.key }),
          }),
      };
    }
    const provider = this.toolkit.tokenProvider(
      providerName,
      this.runtimeOAuthRef(providerName, oauthRef),
    );
    return {
      getAccessToken: async (options) => {
        try {
          return await provider.getAccessToken(options);
        } catch (error) {
          // Classify OAuth token failures into the public LioraError protocol;
          // unrecognized errors are rethrown raw (see mapOAuthTokenError).
          throw mapOAuthTokenError(error, providerName) ?? error;
        }
      },
    };
  };

  private resolveManagedAuth(providerName?: string | undefined): {
    readonly oauthRef?: OAuthRef | undefined;
    readonly baseUrl?: string | undefined;
  } {
    const name = providerName ?? SUPERLIORA_PROVIDER_NAME;
    // Read path: token/status resolution must work off a degraded config
    // instead of failing the session when an unrelated section is broken.
    // Write paths (the toolkit's configAdapter.read) stay strict.
    const config = loadRuntimeConfigSafe(this.options.configPath).config;
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
    if ((providerName ?? SUPERLIORA_PROVIDER_NAME) !== SUPERLIORA_PROVIDER_NAME) return oauthRef;
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
    return providerName !== SUPERLIORA_PROVIDER_NAME && isOAuthProviderId(providerName);
  }
}
