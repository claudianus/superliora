import { createHash } from 'node:crypto';
import type { Logger } from '#/logging/types';
import type { ProviderConfig as KosongProviderConfig, ModelCapability, ProviderRequestAuth } from '@superliora/kosong';
import { APIStatusError, getModelCapability, UNKNOWN_CAPABILITY } from '@superliora/kosong';
import type {
  LioraConfig,
  ModelAlias,
  ModelRoutingStrategy,
  OAuthRef,
  ProviderConfig,
} from '../config';
import { ErrorCodes, isKimiError, LioraError } from '../errors';

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

interface ProviderManagerOptions {
  readonly config: LioraConfig | (() => LioraConfig);
  readonly kimiRequestHeaders?: Record<string, string>;
  readonly resolveOAuthTokenProvider?: OAuthTokenProviderResolver;
  readonly promptCacheKey?: string;
}

type AuthorizedRequest = <T>(
  request: (auth: ProviderRequestAuth) => Promise<T>,
) => Promise<T>;

interface ResolveAuthOptions {
  readonly log?: Logger;
  readonly credentialLabel?: string;
}

interface ApiKeyCredential {
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

export class SingleModelProvider implements ModelProvider {
  constructor(
    private readonly providerConfig: KosongProviderConfig,
    private readonly modelCapabilities: ModelCapability = UNKNOWN_CAPABILITY,
  ) {}

  get defaultModel(): string {
    return this.providerConfig.model;
  }

  resolveProviderConfig(model: string): ResolvedRuntimeProvider {
    if (model !== this.providerConfig.model) {
      throw new LioraError(
        ErrorCodes.CONFIG_INVALID,
        `Model "${model}" is not supported by SingleModelProvider.`,
      );
    }
    return {
      modelAlias: model,
      modelCapabilities: this.modelCapabilities,
      providerName: 'single-model-provider',
      provider: this.providerConfig,
    };
  }
}

export class ProviderManager implements ModelProvider {
  constructor(private readonly options: ProviderManagerOptions) {}

  private get config(): LioraConfig {
    const { config } = this.options;
    return typeof config === 'function' ? config() : config;
  }

  resolveProviderConfig(model: string): ResolvedRuntimeProvider {
    return this.resolveModelAlias(model);
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
    const candidates = candidateAliases.flatMap((candidateAlias) =>
      this.resolveModelAliasCandidates(
        candidateAlias,
        routeWeightForAlias(candidateAlias, routingWeights),
      ),
    );
    if (
      fallbackModels.length === 0 &&
      alias.routing === undefined &&
      candidates.length <= 1 &&
      !candidates.some((candidate) => candidate.localLimits !== undefined)
    ) {
      return undefined;
    }
    return {
      modelAlias: model,
      strategy: alias.routing?.strategy ?? 'auto',
      cooldownMs: alias.routing?.cooldownMs,
      sessionAffinity: alias.routing?.sessionAffinity,
      preferredCredential: alias.routing?.preferredCredential,
      candidates,
    };
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

  private resolveModelAlias(model: string): ResolvedRuntimeProvider {
    const alias = this.config.models?.[model];
    if (alias === undefined) {
      throw new LioraError(
        ErrorCodes.CONFIG_INVALID,
        `Model "${model}" is not configured in config.toml. Add a [models."${model}"] entry with max_context_size.`,
      );
    }

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
      this.options.promptCacheKey,
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
          return await request(auth);
        } catch (error) {
          if (!(error instanceof APIStatusError) || error.statusCode !== 401) throw error;
          if (refreshed) {
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

function providerOAuthRef(
  provider: ProviderConfig,
  credentialLabel: string | undefined,
): OAuthRef | undefined {
  const oauthRefs = providerOAuthRefs(provider);
  if (credentialLabel === undefined) return oauthRefs[0];
  const index = oauthCredentialIndex(credentialLabel, oauthRefs);
  return index === undefined ? oauthRefs[0] : oauthRefs[index];
}

function providerOAuthRefs(provider: ProviderConfig): OAuthRef[] {
  return uniqueOAuthRefs([
    ...(provider.oauth === undefined ? [] : [provider.oauth]),
    ...(provider.oauths ?? []),
  ]);
}

function uniqueOAuthRefs(values: readonly OAuthRef[]): OAuthRef[] {
  const seen = new Set<string>();
  const unique: OAuthRef[] = [];
  for (const value of values) {
    const key = JSON.stringify([value.storage, value.key, value.oauthHost ?? '']);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(value);
  }
  return unique;
}

function oauthCredentialLabel(ref: OAuthRef, index: number): string {
  const label = nonEmptyString(ref.label);
  return label === undefined ? `oauth:${String(index + 1)}` : `oauth:${label}`;
}

function oauthCredentialIndex(
  credentialLabel: string,
  refs: readonly OAuthRef[],
): number | undefined {
  const labelMatch = refs.findIndex(
    (ref, index) => oauthCredentialLabel(ref, index) === credentialLabel,
  );
  if (labelMatch >= 0) return labelMatch;
  const match = /^oauth:(\d+)$/.exec(credentialLabel);
  if (match?.[1] === undefined) return undefined;
  const index = Number(match[1]);
  return Number.isInteger(index) && index > 0 ? index - 1 : undefined;
}

function fingerprintOAuthRef(ref: OAuthRef): string {
  return createHash('sha256')
    .update(JSON.stringify([ref.storage, ref.key, ref.oauthHost ?? '']))
    .digest('hex')
    .slice(0, 12);
}

function resolveModelCapabilities(
  alias: ModelAlias,
  provider: KosongProviderConfig,
): ModelCapability {
  const declared = new Set((alias.capabilities ?? []).map((c) => c.trim().toLowerCase()));
  const detected = getModelCapability(provider.type, provider.model);

  return {
    image_in: declared.has('image_in') || detected.image_in,
    video_in: declared.has('video_in') || detected.video_in,
    audio_in: declared.has('audio_in') || detected.audio_in,
    thinking: declared.has('thinking') || declared.has('always_thinking') || detected.thinking,
    tool_use: declared.has('tool_use') || detected.tool_use,
    max_context_tokens: alias.maxContextSize,
  };
}

function toKosongProviderConfig(
  provider: ProviderConfig,
  model: string,
  modelProtocol: ModelAlias['protocol'],
  kimiRequestHeaders: Record<string, string> | undefined,
  maxOutputSize: number | undefined,
  reasoningKey: string | undefined,
  promptCacheKey: string | undefined,
  adaptiveThinking: boolean | undefined,
  betaApi: boolean | undefined,
): KosongProviderConfig {
  const effectiveType = modelProtocol === 'anthropic' ? 'anthropic' : provider.type;
  switch (effectiveType) {
    case 'anthropic': {
      const baseUrl = providerValue(
        provider.baseUrl,
        provider.env,
        provider.type === 'kimi' ? 'KIMI_BASE_URL' : 'ANTHROPIC_BASE_URL',
        'provider base_url',
      );
      const resolvedBaseUrl = firstCredentialBaseUrlWhenPrimary(provider) ?? baseUrl;
      return {
        type: 'anthropic',
        model,
        baseUrl:
          modelProtocol === 'anthropic' && resolvedBaseUrl !== undefined
            ? resolvedBaseUrl.replace(/\/v1\/?$/, '')
            : resolvedBaseUrl,
        apiKey: providerApiKey(provider),
        ...(maxOutputSize !== undefined ? { defaultMaxTokens: maxOutputSize } : {}),
        ...(adaptiveThinking !== undefined ? { adaptiveThinking } : {}),
        ...(betaApi !== undefined ? { betaApi } : {}),
        ...(promptCacheKey !== undefined ? { metadata: { user_id: promptCacheKey } } : {}),
        ...defaultHeadersField(
          provider.type === 'kimi' && modelProtocol === 'anthropic'
            ? { ...kimiRequestHeaders, ...provider.customHeaders }
            : provider.customHeaders,
        ),
      };
    }
    case 'openai':
      return {
        type: 'openai',
        model,
        baseUrl:
          firstCredentialBaseUrlWhenPrimary(provider) ??
          providerValue(provider.baseUrl, provider.env, 'OPENAI_BASE_URL', 'provider base_url'),
        apiKey: providerApiKey(provider),
        reasoningKey,
        ...defaultHeadersField(provider.customHeaders),
      };
    case 'kimi':
      return {
        type: 'kimi',
        model,
        baseUrl:
          firstCredentialBaseUrlWhenPrimary(provider) ??
          providerValue(provider.baseUrl, provider.env, 'KIMI_BASE_URL', 'provider base_url'),
        apiKey: providerApiKey(provider),
        generationKwargs: { prompt_cache_key: promptCacheKey },
        ...defaultHeadersField({ ...kimiRequestHeaders, ...provider.customHeaders }),
      };
    case 'google-genai':
      return {
        type: 'google-genai',
        model,
        apiKey: providerApiKey(provider),
      };
    case 'openai_responses':
      return {
        type: 'openai_responses',
        model,
        baseUrl:
          firstCredentialBaseUrlWhenPrimary(provider) ??
          providerValue(provider.baseUrl, provider.env, 'OPENAI_BASE_URL', 'provider base_url'),
        apiKey: providerApiKey(provider),
        ...defaultHeadersField(provider.customHeaders),
      };
    case 'vertexai': {
      const useServiceAccount = hasVertexAIServiceEnv(provider);
      return {
        type: 'vertexai',
        model,
        vertexai: useServiceAccount,
        apiKey: useServiceAccount ? undefined : providerApiKey(provider),
        project: vertexAIProject(provider),
        location: vertexAILocation(provider),
      };
    }
    default: {
      const exhaustive: never = effectiveType;
      throw new LioraError(
        ErrorCodes.MODEL_CONFIG_INVALID,
        `Unsupported provider type: ${String(exhaustive)}`,
      );
    }
  }
}

// Returns a fresh `defaultHeaders` field for a kosong provider config so
// resolved instances never share a header object. Omits the key entirely when
// there are no headers — callers and tests rely on `'defaultHeaders' in provider`.
function defaultHeadersField(
  headers: Record<string, string> | undefined,
): { defaultHeaders?: Record<string, string> } {
  if (headers === undefined || Object.keys(headers).length === 0) return {};
  return { defaultHeaders: { ...headers } };
}

function providerApiKey(provider: ProviderConfig): string | undefined {
  return providerApiKeyCredentials(provider)[0]?.apiKey;
}

function providerApiKeyCredentials(provider: ProviderConfig): ApiKeyCredential[] {
  const credentials = providerConfiguredApiKeyCredentials(provider);
  switch (provider.type) {
    case 'anthropic':
      return uniqueApiKeyCredentials([
        fallbackProviderApiKeyCredential(
          provider,
          'ANTHROPIC_API_KEY',
          'provider api_key',
        ),
        ...credentials,
      ]);
    case 'openai':
    case 'openai_responses':
      return uniqueApiKeyCredentials([
        fallbackProviderApiKeyCredential(provider, 'OPENAI_API_KEY', 'provider api_key'),
        ...credentials,
      ]);
    case 'kimi':
      return uniqueApiKeyCredentials([
        fallbackProviderApiKeyCredential(provider, 'KIMI_API_KEY', 'provider api_key'),
        ...credentials,
      ]);
    case 'google-genai':
      return uniqueApiKeyCredentials([
        fallbackProviderApiKeyCredential(provider, 'GOOGLE_API_KEY', 'provider api_key'),
        ...credentials,
      ]);
    case 'vertexai':
      return uniqueApiKeyCredentials([
        fallbackProviderApiKeyCredential(
          provider,
          'VERTEXAI_API_KEY',
          'provider env VERTEXAI_API_KEY',
          'GOOGLE_API_KEY',
          'provider env GOOGLE_API_KEY',
        ),
        ...credentials,
      ]);
    default: {
      const exhaustive: never = provider.type;
      throw new LioraError(
        ErrorCodes.MODEL_CONFIG_INVALID,
        `Unsupported provider type: ${String(exhaustive)}`,
      );
    }
  }
}

function providerConfiguredApiKeyCredentials(provider: ProviderConfig): ApiKeyCredential[] {
  const credentials: ApiKeyCredential[] = [];
  for (let index = 0; index < (provider.apiKeys ?? []).length; index += 1) {
    const apiKey = providerConfiguredValue(
      provider.apiKeys?.[index],
      `provider api_keys[${String(index)}]`,
    );
    if (apiKey !== undefined) credentials.push({ apiKey });
  }
  for (let index = 0; index < (provider.credentials ?? []).length; index += 1) {
    const credential = provider.credentials?.[index];
    if (credential === undefined) continue;
    const apiKey = providerConfiguredValue(
      credential.apiKey,
      `provider credentials[${String(index)}].api_key`,
    );
    if (apiKey === undefined) continue;
    credentials.push({
      apiKey,
      baseUrl: providerConfiguredValue(
        credential.baseUrl,
        `provider credentials[${String(index)}].base_url`,
      ),
      label: providerConfiguredValue(
        credential.label,
        `provider credentials[${String(index)}].label`,
      ),
      rpm: credential.rpm,
      tpm: credential.tpm,
    });
  }
  return credentials;
}

function fallbackProviderApiKeyCredential(
  provider: ProviderConfig,
  envName: string,
  envDescription: string,
  fallbackEnvName?: string,
  fallbackEnvDescription?: string,
): ApiKeyCredential | undefined {
  const apiKey =
    providerValue(provider.apiKey, provider.env, envName, 'provider api_key') ??
    (fallbackEnvName === undefined || fallbackEnvDescription === undefined
      ? undefined
      : envValue(provider.env, fallbackEnvName, fallbackEnvDescription));
  if (apiKey === undefined) return undefined;
  return { apiKey };
}

function firstCredentialBaseUrlWhenPrimary(provider: ProviderConfig): string | undefined {
  if (hasLegacyApiKeySource(provider)) return undefined;
  const firstCredential = provider.credentials?.[0];
  if (firstCredential === undefined) return undefined;
  return providerConfiguredValue(firstCredential.baseUrl, 'provider credentials[0].base_url');
}

function hasLegacyApiKeySource(provider: ProviderConfig): boolean {
  if (nonEmptyString(provider.apiKey) !== undefined) return true;
  if ((provider.apiKeys ?? []).some((apiKey) => nonEmptyString(apiKey) !== undefined)) return true;
  switch (provider.type) {
    case 'anthropic':
      return nonEmptyString(provider.env?.['ANTHROPIC_API_KEY']) !== undefined;
    case 'openai':
    case 'openai_responses':
      return nonEmptyString(provider.env?.['OPENAI_API_KEY']) !== undefined;
    case 'kimi':
      return nonEmptyString(provider.env?.['KIMI_API_KEY']) !== undefined;
    case 'google-genai':
      return nonEmptyString(provider.env?.['GOOGLE_API_KEY']) !== undefined;
    case 'vertexai':
      return (
        nonEmptyString(provider.env?.['VERTEXAI_API_KEY']) !== undefined ||
        nonEmptyString(provider.env?.['GOOGLE_API_KEY']) !== undefined
      );
    default: {
      const exhaustive: never = provider.type;
      return exhaustive;
    }
  }
}

function uniqueApiKeyCredentials(
  values: readonly (ApiKeyCredential | undefined)[],
): ApiKeyCredential[] {
  const seen = new Set<string>();
  const out: ApiKeyCredential[] = [];
  for (const value of values) {
    if (value === undefined) continue;
    const key = apiKeyCredentialKey(value);
    if (key === undefined || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function apiKeyCredentialKey(credential: ApiKeyCredential): string | undefined {
  const apiKey = nonEmptyString(credential.apiKey);
  if (apiKey === undefined) return undefined;
  return [apiKey, nonEmptyString(credential.baseUrl) ?? ''].join('\n');
}

function apiKeyCredentialLabel(credential: ApiKeyCredential, index: number): string {
  const label = nonEmptyString(credential.label);
  return label === undefined ? `api_key:${String(index + 1)}` : `api_key:${label}`;
}

function shouldExpandApiKeyCredentials(credentials: readonly ApiKeyCredential[]): boolean {
  return (
    credentials.length > 1 ||
    credentials.some(
      (credential) =>
        nonEmptyString(credential.label) !== undefined ||
        nonEmptyString(credential.baseUrl) !== undefined ||
        credential.rpm !== undefined ||
        credential.tpm !== undefined,
    )
  );
}

function apiKeyCredentialLocalLimits(
  credential: ApiKeyCredential,
): ProviderCredentialLocalLimits | undefined {
  if (credential.rpm === undefined && credential.tpm === undefined) return undefined;
  return {
    rpm: credential.rpm,
    tpm: credential.tpm,
  };
}

function applyApiKeyCredential(
  provider: KosongProviderConfig,
  credential: ApiKeyCredential,
): KosongProviderConfig {
  const baseUrl = nonEmptyString(credential.baseUrl);
  return {
    ...provider,
    apiKey: credential.apiKey,
    ...(baseUrl === undefined ? {} : { baseUrl }),
  };
}

function hasConfiguredApiKeySource(provider: ProviderConfig): boolean {
  if (nonEmptyString(provider.apiKey) !== undefined) return true;
  if ((provider.apiKeys ?? []).some((apiKey) => nonEmptyString(apiKey) !== undefined)) return true;
  if (
    (provider.credentials ?? []).some(
      (credential) => nonEmptyString(credential.apiKey) !== undefined,
    )
  ) {
    return true;
  }
  switch (provider.type) {
    case 'anthropic':
      return nonEmptyString(provider.env?.['ANTHROPIC_API_KEY']) !== undefined;
    case 'openai':
    case 'openai_responses':
      return nonEmptyString(provider.env?.['OPENAI_API_KEY']) !== undefined;
    case 'kimi':
      return nonEmptyString(provider.env?.['KIMI_API_KEY']) !== undefined;
    case 'google-genai':
      return nonEmptyString(provider.env?.['GOOGLE_API_KEY']) !== undefined;
    case 'vertexai':
      return (
        nonEmptyString(provider.env?.['VERTEXAI_API_KEY']) !== undefined ||
        nonEmptyString(provider.env?.['GOOGLE_API_KEY']) !== undefined
      );
    default: {
      const exhaustive: never = provider.type;
      throw new LioraError(
        ErrorCodes.MODEL_CONFIG_INVALID,
        `Unsupported provider type: ${String(exhaustive)}`,
      );
    }
  }
}

function hasVertexAIServiceEnv(provider: ProviderConfig): boolean {
  return vertexAIProject(provider) !== undefined && vertexAILocation(provider) !== undefined;
}

function vertexAIProject(provider: ProviderConfig): string | undefined {
  return envValue(provider.env, 'GOOGLE_CLOUD_PROJECT', 'provider env GOOGLE_CLOUD_PROJECT');
}

function vertexAILocation(provider: ProviderConfig): string | undefined {
  return (
    envValue(provider.env, 'GOOGLE_CLOUD_LOCATION', 'provider env GOOGLE_CLOUD_LOCATION') ??
    locationFromVertexAIBaseUrl(provider.baseUrl)
  );
}

function providerValue(
  configured: string | undefined,
  env: Record<string, string> | undefined,
  envKey: string,
  label: string,
): string | undefined {
  return providerConfiguredValue(configured, label) ?? envValue(env, envKey, `provider env ${envKey}`);
}

function envValue(
  env: Record<string, string> | undefined,
  key: string,
  label: string,
): string | undefined {
  return providerConfiguredValue(env?.[key], label);
}

function providerConfiguredValue(value: string | undefined, label: string): string | undefined {
  const trimmed = nonEmptyString(value);
  if (trimmed === undefined) return undefined;
  const envKey = parseEnvReference(trimmed);
  if (envKey === undefined) return trimmed;
  const resolved = nonEmptyString(process.env[envKey]);
  if (resolved !== undefined) return resolved;
  throw new LioraError(
    ErrorCodes.CONFIG_INVALID,
    `${label} references environment variable "${envKey}", but it is not set.`,
  );
}

function parseEnvReference(value: string): string | undefined {
  const patterns = [
    /^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/,
    /^env:([A-Za-z_][A-Za-z0-9_]*)$/,
    /^env\/([A-Za-z_][A-Za-z0-9_]*)$/,
    /^os\.environ\/([A-Za-z_][A-Za-z0-9_]*)$/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(value);
    if (match?.[1] !== undefined) return match[1];
  }
  return undefined;
}

function nonEmptyString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

function locationFromVertexAIBaseUrl(baseUrl: string | undefined): string | undefined {
  const url = nonEmptyString(baseUrl);
  if (url === undefined) return undefined;
  try {
    const host = new URL(url).hostname;
    const suffix = '-aiplatform.googleapis.com';
    return host.endsWith(suffix) ? nonEmptyString(host.slice(0, -suffix.length)) : undefined;
  } catch {
    return undefined;
  }
}
