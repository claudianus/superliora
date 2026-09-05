import type { ProviderConfig as KosongProviderConfig } from '@superliora/kosong';
import {
  githubCopilotRequestHeaders,
  isGitHubCopilotBaseUrl,
  isOpenCodeZenBaseUrl,
  isXaiGrokBuildBaseUrl,
  opencodeSessionHeaders,
  xaiGrokBuildRequestHeaders,
} from '@superliora/oauth';

import type { ModelAlias, ProviderConfig } from '../../config';
import { ErrorCodes, LioraError } from '../../errors';

import {
  firstCredentialBaseUrlWhenPrimary,
  providerApiKey,
} from './provider-manager-api-key';
import {
  envValue,
  locationFromVertexAIBaseUrl,
  providerValue,
} from './provider-manager-config-values';

export function toKosongProviderConfig(
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
  const normalizedProtocol = modelProtocol?.trim().toLowerCase();
  const effectiveType = normalizedProtocol === 'anthropic' || normalizedProtocol === 'openai' || normalizedProtocol === 'openai_responses'
    ? (normalizedProtocol as typeof provider.type)
    : provider.type;
  switch (effectiveType) {
    case 'anthropic': {
      const baseUrl = providerValue(
        provider.baseUrl,
        provider.env,
        provider.type === 'kimi' ? 'KIMI_BASE_URL' : 'ANTHROPIC_BASE_URL',
        'provider base_url',
      );
      const resolvedBaseUrl = firstCredentialBaseUrlWhenPrimary(provider) ?? baseUrl;
      const baseHeaders =
        provider.type === 'kimi' && normalizedProtocol === 'anthropic'
          ? { ...kimiRequestHeaders, ...provider.customHeaders }
          : provider.customHeaders;
      return {
        type: 'anthropic',
        model,
        baseUrl:
          normalizedProtocol === 'anthropic' && resolvedBaseUrl !== undefined
            ? resolvedBaseUrl.replace(/\/v1\/?$/, '')
            : resolvedBaseUrl,
        apiKey: providerApiKey(provider),
        ...(maxOutputSize !== undefined ? { defaultMaxTokens: maxOutputSize } : {}),
        ...(adaptiveThinking !== undefined ? { adaptiveThinking } : {}),
        ...(betaApi !== undefined ? { betaApi } : {}),
        ...(promptCacheKey !== undefined ? { metadata: { user_id: promptCacheKey } } : {}),
        ...defaultHeadersField(
          withOpenCodeSessionHeaders([resolvedBaseUrl, provider.baseUrl], promptCacheKey, baseHeaders),
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
        // Sticky prompt-cache routing for OpenAI-compatible endpoints (xAI Grok).
        generationKwargs: { prompt_cache_key: promptCacheKey },
        ...defaultHeadersField(openaiProviderHeaders(provider, model, promptCacheKey)),
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
        baseUrl: providerValue(provider.baseUrl, provider.env, 'GEMINI_BASE_URL', 'provider base_url'),
        ...defaultHeadersField(provider.customHeaders),
      };
    case 'openai_responses': {
      const baseUrl =
        firstCredentialBaseUrlWhenPrimary(provider) ??
        providerValue(provider.baseUrl, provider.env, 'OPENAI_BASE_URL', 'provider base_url');
      return {
        type: 'openai_responses',
        model,
        baseUrl,
        apiKey: providerApiKey(provider),
        generationKwargs: { prompt_cache_key: promptCacheKey },
        ...defaultHeadersField(
          withOpenCodeSessionHeaders([baseUrl, provider.baseUrl], promptCacheKey, provider.customHeaders),
        ),
      };
    }
    case 'vertexai': {
      const useServiceAccount = hasVertexAIServiceEnv(provider);
      return {
        type: 'vertexai',
        model,
        vertexai: useServiceAccount,
        apiKey: useServiceAccount ? undefined : providerApiKey(provider),
        project: vertexAIProject(provider),
        location: vertexAILocation(provider),
        // A configured base URL selects the regional endpoint (location is
        // derived from it above); credentials still resolve via ADC, never
        // from request-scoped auth.
        ...(provider.baseUrl === undefined ? {} : { baseUrl: provider.baseUrl }),
      };
    }
    case 'bedrock':
      return {
        type: 'bedrock',
        model,
        // No apiKey — the Bedrock SDK resolves AWS credentials from its chain.
        apiKey: '',
        ...(maxOutputSize !== undefined ? { defaultMaxTokens: maxOutputSize } : {}),
        ...(adaptiveThinking !== undefined ? { adaptiveThinking } : {}),
        ...(betaApi !== undefined ? { betaApi } : {}),
        // Bedrock reuses the Anthropic pipeline: keep the per-session cache
        // routing marker so worker prefixes stay isolated like direct Anthropic.
        ...(promptCacheKey !== undefined ? { metadata: { user_id: promptCacheKey } } : {}),
        ...defaultHeadersField(provider.customHeaders),
      };
    case 'vertex_claude':
      return {
        type: 'vertex_claude',
        model,
        // No apiKey — the Vertex SDK resolves GCP ADC from its chain.
        apiKey: '',
        ...(maxOutputSize !== undefined ? { defaultMaxTokens: maxOutputSize } : {}),
        ...(adaptiveThinking !== undefined ? { adaptiveThinking } : {}),
        ...(betaApi !== undefined ? { betaApi } : {}),
        // Vertex Claude reuses the Anthropic pipeline: same cache routing marker.
        ...(promptCacheKey !== undefined ? { metadata: { user_id: promptCacheKey } } : {}),
        ...defaultHeadersField(provider.customHeaders),
      };
    case 'cursor':
      return {
        type: 'cursor',
        model,
        baseUrl:
          firstCredentialBaseUrlWhenPrimary(provider) ??
          providerValue(provider.baseUrl, provider.env, 'CURSOR_AGENT_BASE_URL', 'provider base_url'),
        apiKey: providerApiKey(provider),
        ...defaultHeadersField(provider.customHeaders),
      };
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

/**
 * OpenAI-compatible providers that use the Grok Build chat proxy need the
 * CLI session auth marker and a model-override header so traffic bills to
 * Grok Build instead of the public API. OpenCode Zen/Go endpoints need the
 * per-conversation session identity header. Public-API and other providers
 * keep only the configured custom headers.
 */
function openaiProviderHeaders(
  provider: ProviderConfig,
  model: string,
  promptCacheKey: string | undefined,
): Record<string, string> | undefined {
  const baseUrl =
    firstCredentialBaseUrlWhenPrimary(provider) ??
    providerValue(provider.baseUrl, provider.env, 'OPENAI_BASE_URL', 'provider base_url');
  if (isGitHubCopilotBaseUrl(baseUrl) || isGitHubCopilotBaseUrl(provider.baseUrl)) {
    return {
      ...githubCopilotRequestHeaders(),
      ...provider.customHeaders,
    };
  }
  if (isOpenCodeZenBaseUrl(baseUrl) || isOpenCodeZenBaseUrl(provider.baseUrl)) {
    return { ...opencodeSessionHeaders(promptCacheKey), ...provider.customHeaders };
  }
  if (!isXaiGrokBuildBaseUrl(baseUrl) && !isXaiGrokBuildBaseUrl(provider.baseUrl)) {
    return provider.customHeaders;
  }
  return {
    ...xaiGrokBuildRequestHeaders(model),
    ...provider.customHeaders,
  };
}

/**
 * Merges the `x-opencode-session` header OpenCode Zen/Go endpoints expect
 * ahead of user-configured headers whenever any candidate base URL points at
 * opencode.ai. Returns `customHeaders` untouched otherwise (the no-session
 * merge is a no-op, so headerless configs still omit `defaultHeaders`).
 */
function withOpenCodeSessionHeaders(
  baseUrlCandidates: ReadonlyArray<string | undefined>,
  promptCacheKey: string | undefined,
  customHeaders: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!baseUrlCandidates.some((baseUrl) => isOpenCodeZenBaseUrl(baseUrl))) {
    return customHeaders;
  }
  return { ...opencodeSessionHeaders(promptCacheKey), ...customHeaders };
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
