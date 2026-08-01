import type { ProviderConfig as KosongProviderConfig } from '@superliora/kosong';
import {
  isXaiGrokBuildBaseUrl,
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
        // Sticky prompt-cache routing for OpenAI-compatible endpoints (xAI Grok).
        generationKwargs: { prompt_cache_key: promptCacheKey },
        ...defaultHeadersField(openaiProviderHeaders(provider, model)),
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
        generationKwargs: { prompt_cache_key: promptCacheKey },
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
    case 'bedrock':
      return {
        type: 'bedrock',
        model,
        // No apiKey — the Bedrock SDK resolves AWS credentials from its chain.
        apiKey: '',
        ...(maxOutputSize !== undefined ? { defaultMaxTokens: maxOutputSize } : {}),
        ...(adaptiveThinking !== undefined ? { adaptiveThinking } : {}),
        ...(betaApi !== undefined ? { betaApi } : {}),
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
 * Grok Build instead of the public API. Public-API and non-xAI providers
 * keep only the configured custom headers.
 */
function openaiProviderHeaders(
  provider: ProviderConfig,
  model: string,
): Record<string, string> | undefined {
  const baseUrl =
    firstCredentialBaseUrlWhenPrimary(provider) ??
    providerValue(provider.baseUrl, provider.env, 'OPENAI_BASE_URL', 'provider base_url');
  if (!isXaiGrokBuildBaseUrl(baseUrl) && !isXaiGrokBuildBaseUrl(provider.baseUrl)) {
    return provider.customHeaders;
  }
  return {
    ...xaiGrokBuildRequestHeaders(model),
    ...provider.customHeaders,
  };
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
