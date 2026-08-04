import type { ProviderConfig as KosongProviderConfig } from '@superliora/kosong';

import type { ProviderConfig } from '../../config';
import { ErrorCodes, LioraError } from '../../errors';

import {
  envValue,
  nonEmptyString,
  providerConfiguredValue,
  providerValue,
} from './provider-manager-config-values';
import type { ApiKeyCredential, ProviderCredentialLocalLimits } from './provider-manager-types';

export function providerApiKey(provider: ProviderConfig): string | undefined {
  return providerApiKeyCredentials(provider)[0]?.apiKey;
}

export function providerApiKeyCredentials(provider: ProviderConfig): ApiKeyCredential[] {
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
    case 'bedrock':
    case 'vertex_claude':
      // Cloud-hosted Claude authenticates via the platform credential chain
      // (AWS IAM / GCP ADC), not API keys. No credential pool to build.
      return [];
    case 'cursor':
      return uniqueApiKeyCredentials([
        fallbackProviderApiKeyCredential(provider, 'CURSOR_ACCESS_TOKEN', 'provider api_key'),
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

export function firstCredentialBaseUrlWhenPrimary(provider: ProviderConfig): string | undefined {
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
    case 'bedrock':
    case 'vertex_claude':
      return false;
    case 'cursor':
      return nonEmptyString(provider.env?.['CURSOR_ACCESS_TOKEN']) !== undefined;
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

export function apiKeyCredentialLabel(credential: ApiKeyCredential, index: number): string {
  const label = nonEmptyString(credential.label);
  return label === undefined ? `api_key:${String(index + 1)}` : `api_key:${label}`;
}

export function shouldExpandApiKeyCredentials(credentials: readonly ApiKeyCredential[]): boolean {
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

export function apiKeyCredentialLocalLimits(
  credential: ApiKeyCredential,
): ProviderCredentialLocalLimits | undefined {
  if (credential.rpm === undefined && credential.tpm === undefined) return undefined;
  return {
    rpm: credential.rpm,
    tpm: credential.tpm,
  };
}

export function applyApiKeyCredential(
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

export function hasConfiguredApiKeySource(provider: ProviderConfig): boolean {
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
    case 'bedrock':
    case 'vertex_claude':
      // Cloud-hosted Claude is always considered "configured" — the credential
      // chain (AWS IAM / GCP ADC) is resolved at request time, not in config.
      return true;
    case 'cursor':
      return nonEmptyString(provider.env?.['CURSOR_ACCESS_TOKEN']) !== undefined;
    default: {
      const exhaustive: never = provider.type;
      throw new LioraError(
        ErrorCodes.MODEL_CONFIG_INVALID,
        `Unsupported provider type: ${String(exhaustive)}`,
      );
    }
  }
}
