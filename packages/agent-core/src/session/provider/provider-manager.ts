import type { ProviderRequestAuth } from '@superliora/kosong';
import { APIStatusError } from '@superliora/kosong';
import { sharedCredentialHealthStore } from '@superliora/oauth';
import { effectiveModelAlias, type LioraConfig } from '../../config';
import { ErrorCodes, isKimiError, LioraError } from '../../errors';

import {
  apiKeyCredentialLabel,
  apiKeyCredentialLocalLimits,
  applyApiKeyCredential,
  hasConfiguredApiKeySource,
  providerApiKeyCredentials,
  shouldExpandApiKeyCredentials,
} from './provider-manager-api-key';
import {
  providerHasAnyCredential,
  resolveModelCapabilities,
  sameCapability,
} from './provider-manager-capability';
import { toKosongProviderConfig } from './provider-manager-kosong-config';
import {
  fingerprintOAuthRef,
  oauthCredentialLabel,
  providerOAuthRef,
  providerOAuthRefs,
} from './provider-manager-oauth';
import type {
  AuthorizedRequest,
  ModelProvider,
  ProviderManagerOptions,
  ResolvedRuntimeProvider,
  ResolvedRuntimeProviderRoute,
  ResolveAuthOptions,
} from './provider-manager-types';

export type {
  BearerTokenProvider,
  ModelProvider,
  OAuthTokenProviderResolver,
  ProviderCredentialLocalLimits,
  ResolvedRuntimeProvider,
  ResolvedRuntimeProviderRoute,
} from './provider-manager-types';
export { providerHasAnyCredential } from './provider-manager-capability';

export class ProviderManager implements ModelProvider {
  constructor(private readonly options: ProviderManagerOptions) {}

  private get config(): LioraConfig {
    const { config } = this.options;
    return typeof config === 'function' ? config() : config;
  }

  resolveProviderConfig(model: string): ResolvedRuntimeProvider {
    return this.resolveModelAlias(model);
  }

  /** Live view of the runtime config (may be reloaded mid-session). */
  currentConfig(): LioraConfig {
    return this.config;
  }

  resolveProviderRoute(model: string): ResolvedRuntimeProviderRoute | undefined {
    const alias = this.config.models?.[model];
    if (alias === undefined) {
      throw new LioraError(
        ErrorCodes.CONFIG_INVALID,
        `Model "${model}" is not configured in config.toml. Add a [models."${model}"] entry with max_context_size.`,
      );
    }

    const fallbackModels = alias.fallbackModels ?? [];

    const candidateAliases = uniqueModelAliases([model, ...fallbackModels]);
    const routingWeights = alias.routing?.weights;
    let candidates = candidateAliases.flatMap((candidateAlias) =>
      this.resolveModelAliasCandidates(
        candidateAlias,
        routeWeightForAlias(candidateAlias, routingWeights),
      ),
    );

    // Same-capability cross-provider expansion (Upgrade+).
    candidates = this.expandSameCapabilityCandidates(model, candidates);
    candidates = this.filterHealthyCandidates(candidates);

    if (candidates.length === 0) {
      return undefined;
    }
    if (
      fallbackModels.length === 0 &&
      alias.routing === undefined &&
      candidates.length <= 1 &&
      !candidates.some((candidate) => candidate.localLimits !== undefined) &&
      // Still expose a single expanded candidate when health filtering applied
      // so kosong-llm can record failures consistently — only skip when truly
      // a plain single-provider non-routed alias with no expansion.
      this.expandSameCapabilityCandidates(model, [
        this.resolveModelAlias(model),
      ]).length <= 1
    ) {
      // Keep legacy: no multi-candidate routing → undefined (use resolveProviderConfig)
      // unless we actually expanded or filtered multi-cred.
      const baseline = candidateAliases.flatMap((candidateAlias) =>
        this.resolveModelAliasCandidates(
          candidateAlias,
          routeWeightForAlias(candidateAlias, routingWeights),
        ),
      );
      if (baseline.length <= 1 && !baseline.some((c) => c.localLimits !== undefined)) {
        // Prefer multi-candidate route when expansion found alternatives
        if (candidates.length <= 1) return undefined;
      }
    }
    return {
      modelAlias: model,
      strategy: alias.routing?.strategy ?? 'auto',
      cooldownMs: alias.routing?.cooldownMs ?? 5 * 60_000,
      sessionAffinity: alias.routing?.sessionAffinity,
      preferredCredential: alias.routing?.preferredCredential,
      candidates,
    };
  }

  /**
   * Drop candidates whose OAuth/API credential is marked unhealthy.
   */
  private filterHealthyCandidates(
    candidates: readonly ResolvedRuntimeProvider[],
  ): ResolvedRuntimeProvider[] {
    return candidates.filter((candidate) =>
      sharedCredentialHealthStore.isAvailable(
        candidate.providerName,
        candidate.credentialLabel,
      ),
    );
  }

  /**
   * Append logged-in providers' default models that match capability footprint.
   * Same provider first (already in list); other providers after.
   */
  private expandSameCapabilityCandidates(
    primaryModel: string,
    candidates: readonly ResolvedRuntimeProvider[],
  ): ResolvedRuntimeProvider[] {
    const primary = candidates[0] ?? this.resolveModelAlias(primaryModel);
    const primaryCaps = primary.modelCapabilities;
    const seen = new Set(
      candidates.map(
        (c) =>
          `${c.providerName}::${c.modelAlias}::${c.credentialLabel ?? ''}::${c.oauthRef?.key ?? ''}`,
      ),
    );
    const expanded: ResolvedRuntimeProvider[] = [...candidates];

    for (const [providerName, providerConfig] of Object.entries(this.config.providers)) {
      if (providerConfig === undefined) continue;
      if (!providerHasAnyCredential(providerConfig)) continue;
      if (!sharedCredentialHealthStore.isAvailable(providerName)) continue;

      for (const aliasName of Object.keys(this.config.models ?? {})) {
        let resolved: ResolvedRuntimeProvider;
        try {
          resolved = this.resolveModelAlias(aliasName);
        } catch {
          continue;
        }
        if (resolved.providerName !== providerName) continue;
        if (resolved.providerName === primary.providerName) continue;
        if (!sameCapability(primaryCaps, resolved.modelCapabilities)) continue;
        const key = `${resolved.providerName}::${resolved.modelAlias}::${resolved.credentialLabel ?? ''}::${resolved.oauthRef?.key ?? ''}`;
        if (seen.has(key)) continue;
        if (
          !sharedCredentialHealthStore.isAvailable(
            resolved.providerName,
            resolved.credentialLabel,
          )
        ) {
          continue;
        }
        seen.add(key);
        expanded.push(resolved);
      }
    }
    return expanded;
  }

  private resolveModelAliasCandidates(
    model: string,
    weight: number | undefined = undefined,
  ): ResolvedRuntimeProvider[] {
    const resolved = addRouteWeight(this.resolveModelAlias(model), weight);
    const providerConfig = this.config.providers[resolved.providerName];
    if (providerConfig === undefined) return [resolved];

    const apiKeyCredentials = providerApiKeyCredentials(providerConfig);
    if (shouldExpandApiKeyCredentials(apiKeyCredentials)) {
      return apiKeyCredentials.map((credential, index) => ({
        ...resolved,
        credentialLabel: apiKeyCredentialLabel(credential, index),
        localLimits: apiKeyCredentialLocalLimits(credential),
        provider: applyApiKeyCredential(resolved.provider, credential),
      }));
    }

    if (hasConfiguredApiKeySource(providerConfig)) return [resolved];

    const oauthRefs = providerOAuthRefs(providerConfig);
    if (oauthRefs.length <= 1) return [resolved];

    return oauthRefs.map((oauthRef, index) => ({
      ...resolved,
      credentialLabel: oauthCredentialLabel(oauthRef, index),
      oauthRef,
    }));
  }

  private resolvePromptCacheKey(): string | undefined {
    const key = this.options.promptCacheKey;
    if (key === undefined) return undefined;
    return typeof key === 'function' ? key() : key;
  }

  private resolveModelAlias(model: string): ResolvedRuntimeProvider {
    const rawAlias = this.config.models?.[model];
    if (rawAlias === undefined) {
      throw new LioraError(
        ErrorCodes.CONFIG_INVALID,
        `Model "${model}" is not configured in config.toml. Add a [models."${model}"] entry with max_context_size.`,
      );
    }
    const alias = effectiveModelAlias(rawAlias);

    const providerName = alias.provider ?? this.config.defaultProvider;
    if (providerName === undefined) {
      throw new LioraError(
        ErrorCodes.CONFIG_INVALID,
        `Model "${model}" must define a provider in config.toml.`,
      );
    }

    const providerConfig = this.config.providers[providerName];
    if (providerConfig === undefined) {
      throw new LioraError(
        ErrorCodes.CONFIG_INVALID,
        `Provider "${providerName}" for model "${model}" is not configured.`,
      );
    }

    if (!Number.isInteger(alias.maxContextSize) || alias.maxContextSize <= 0) {
      throw new LioraError(
        ErrorCodes.CONFIG_INVALID,
        `Model "${model}" must define a positive max_context_size in config.toml.`,
      );
    }

    const provider = toKosongProviderConfig(
      providerConfig,
      alias.model,
      alias.protocol,
      this.options.kimiRequestHeaders,
      alias.maxOutputSize,
      alias.reasoningKey,
      this.resolvePromptCacheKey(),
      alias.adaptiveThinking,
      alias.betaApi,
    );

    return {
      modelAlias: model,
      providerName,
      provider,
      modelCapabilities: resolveModelCapabilities(alias, provider),
      alwaysThinking: (alias.capabilities ?? []).some(
        (c) => c.trim().toLowerCase() === 'always_thinking',
      ),
      supportEfforts: alias.supportEfforts,
      defaultEffort: alias.defaultEffort,
      maxOutputSize: alias.maxOutputSize,
    };
  }

  resolveAuth(model: string, options?: ResolveAuthOptions): AuthorizedRequest | undefined {
    const { providerName } = this.resolveProviderConfig(model);
    const providerConfig = this.config.providers[providerName];
    if (providerConfig === undefined) return undefined;

    const oauthRef = providerOAuthRef(providerConfig, options?.credentialLabel);
    if (oauthRef === undefined) return undefined;

    // Explicit key sources must win over stored OAuth credentials. This avoids
    // a stale login silently hijacking a direct API-key/custom-endpoint setup.
    if (hasConfiguredApiKeySource(providerConfig)) return undefined;

    const authDetails = (): Record<string, unknown> => ({
      providerName,
      credentialLabel: options?.credentialLabel,
      oauthStorage: oauthRef.storage,
      oauthKeyFingerprint: fingerprintOAuthRef(oauthRef),
      oauthHost: oauthRef.oauthHost,
    });
    const loginRequired = (cause?: unknown): LioraError =>
      new LioraError(
        ErrorCodes.AUTH_LOGIN_REQUIRED,
        `OAuth provider "${providerName}" requires login before it can be used.`,
        { cause, details: authDetails() },
      );
    const enrichLoginRequired = (error: LioraError): LioraError =>
      new LioraError(ErrorCodes.AUTH_LOGIN_REQUIRED, error.message, {
        cause: error,
        details: { ...authDetails(), ...error.details },
      });

    const tokenProvider = this.options.resolveOAuthTokenProvider?.(providerName, oauthRef);
    if (tokenProvider === undefined) {
      return async () => {
        throw loginRequired();
      };
    }

    const log = options?.log;
    const fetchAuth = async (force: boolean): Promise<ProviderRequestAuth> => {
      let apiKey: string;
      try {
        apiKey = await tokenProvider.getAccessToken(force ? { force: true } : undefined);
      } catch (error) {
        if (isKimiError(error) && error.code === ErrorCodes.AUTH_LOGIN_REQUIRED) {
          throw enrichLoginRequired(error);
        }
        // login-required is an expected state (the user must /login); don't
        // warn. Other failures (connection errors, etc.) are logged once for
        // diagnosis and then propagated — chatWithRetry does not retry them.
        if (!isKimiError(error) || error.code !== ErrorCodes.AUTH_LOGIN_REQUIRED) {
          log?.warn('oauth token fetch failed', {
            providerName,
            credentialLabel: options?.credentialLabel,
            error,
          });
        }
        throw error;
      }
      if (apiKey.trim().length === 0) throw loginRequired();
      return { apiKey };
    };

    return async (request) => {
      let auth = await fetchAuth(false);
      for (let refreshed = false; ; refreshed = true) {
        try {
          const result = await request(auth);
          sharedCredentialHealthStore.markHealthy(providerName, options?.credentialLabel);
          return result;
        } catch (error) {
          if (!(error instanceof APIStatusError) || error.statusCode !== 401) throw error;
          if (refreshed) {
            sharedCredentialHealthStore.markAuthRejected(providerName, {
              credentialKey: options?.credentialLabel,
              failureReason:
                'OAuth provider credentials were rejected. Send /login to login.',
            });
            throw new LioraError(
              ErrorCodes.AUTH_LOGIN_REQUIRED,
              'OAuth provider credentials were rejected. Send /login to login.',
              {
                cause: error,
                details: {
                  ...authDetails(),
                  statusCode: error.statusCode,
                  requestId: error.requestId,
                },
              },
            );
          }
          auth = await fetchAuth(true);
        }
      }
    };
  }
}

function routeWeightForAlias(
  modelAlias: string,
  weights: Readonly<Record<string, number>> | undefined,
): number | undefined {
  return weights?.[modelAlias];
}

function addRouteWeight(
  provider: ResolvedRuntimeProvider,
  weight: number | undefined,
): ResolvedRuntimeProvider {
  if (weight === undefined) return provider;
  return { ...provider, weight };
}

function uniqueModelAliases(models: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const model of models) {
    if (seen.has(model)) continue;
    seen.add(model);
    unique.push(model);
  }
  return unique;
}
