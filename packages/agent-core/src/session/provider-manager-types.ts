import type { Logger } from '#/logging/types';
import type {
  ModelCapability,
  ProviderConfig as KosongProviderConfig,
  ProviderRequestAuth,
} from '@superliora/kosong';

import type { LioraConfig, ModelRoutingStrategy, OAuthRef } from '../config';

export interface BearerTokenProvider {
  getAccessToken(options?: { readonly force?: boolean }): Promise<string>;
}

export type OAuthTokenProviderResolver = (
  providerName: string,
  oauthRef?: OAuthRef,
) => BearerTokenProvider | undefined;

export interface ResolvedRuntimeProvider {
  readonly modelAlias: string;
  readonly providerName: string;
  readonly credentialLabel?: string;
  readonly weight?: number;
  readonly localLimits?: ProviderCredentialLocalLimits;
  readonly oauthRef?: OAuthRef;
  readonly provider: KosongProviderConfig;
  readonly modelCapabilities: ModelCapability;
  /** Declared 'always_thinking' capability — the model cannot disable thinking. */
  readonly alwaysThinking?: boolean;
  readonly supportEfforts?: readonly string[];
  readonly defaultEffort?: string;
  readonly maxOutputSize?: number;
}

export interface ResolvedRuntimeProviderRoute {
  readonly modelAlias: string;
  readonly strategy: ModelRoutingStrategy;
  readonly cooldownMs?: number;
  readonly sessionAffinity?: boolean;
  readonly preferredCredential?: string;
  readonly candidates: readonly ResolvedRuntimeProvider[];
}

export interface ProviderManagerOptions {
  readonly config: LioraConfig | (() => LioraConfig);
  readonly kimiRequestHeaders?: Record<string, string>;
  readonly resolveOAuthTokenProvider?: OAuthTokenProviderResolver;
  readonly promptCacheKey?: string;
}

export type AuthorizedRequest = <T>(
  request: (auth: ProviderRequestAuth) => Promise<T>,
) => Promise<T>;

export interface ResolveAuthOptions {
  readonly log?: Logger;
  readonly credentialLabel?: string;
}

export interface ApiKeyCredential {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly label?: string;
  readonly rpm?: number;
  readonly tpm?: number;
}

export interface ProviderCredentialLocalLimits {
  readonly rpm?: number;
  readonly tpm?: number;
}

export interface ModelProvider {
  readonly defaultModel?: string;
  resolveProviderConfig(model: string): ResolvedRuntimeProvider;
  resolveProviderRoute?(model: string): ResolvedRuntimeProviderRoute | undefined;
  resolveAuth?(model: string, options?: ResolveAuthOptions): AuthorizedRequest | undefined;
}
