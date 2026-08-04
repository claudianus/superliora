/**
 * Credential management utilities for provider CLI handlers.
 * Covers API key slots, OAuth refs, and credential source resolution.
 */

import {
  fingerprintProviderOAuthRef,
  isValidProviderOAuthCredentialLabel,
  listProviderOAuthRefs,
  promoteProviderOAuthSlot,
  rewriteProviderOAuthRefs as rewriteProviderOAuthRefsShared,
  type ProviderOAuthRef,
} from '@superliora/oauth';
import type { LioraConfig } from '@superliora/sdk';

import {
  nonEmptyString,
  optionalList,
  parseEnvReference,
  parseEnvVarName,
  parsePositiveInt,
  splitCommaList,
  uniqueStrings,
  writeProviderErr,
} from './shared';
import type {
  CatalogAddOptions,
  ConfigOAuthRef,
  ConfigProviderCredential,
  KeyAddOptions,
  OAuthCredentialPreview,
  ProviderApiKeySlot,
  ProviderCredentialPreview,
  ProviderDeps,
} from './types';

/* ------------------------------------------------------------------ */
/*  API key resolution                                                 */
/* ------------------------------------------------------------------ */

export function resolveApiKey(flag: string | undefined, env: NodeJS.ProcessEnv): string | undefined {
  if (typeof flag === 'string' && flag.length > 0) return flag;
  const fromEnv = env['KIMI_REGISTRY_API_KEY'];
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv;
  return undefined;
}

function resolveProviderApiKey(
  flag: string | undefined,
  env: NodeJS.ProcessEnv,
): string | undefined {
  if (typeof flag === 'string' && flag.length > 0) return flag;
  const fromEnv = env['KIMI_PROVIDER_API_KEY'];
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv;
  return undefined;
}

export function resolveProviderApiKeySource(
  input: { readonly apiKey?: string; readonly apiKeyEnv?: string },
  deps: ProviderDeps,
): string | undefined {
  const apiKey = nonEmptyString(input.apiKey);
  const apiKeyEnv = nonEmptyString(input.apiKeyEnv);
  if (apiKey !== undefined && apiKeyEnv !== undefined) {
    writeProviderErr(deps, 'cli.runtime.provider.passApiKeyOrEnv');
    deps.exit(1);
  }
  if (apiKeyEnv !== undefined) return `{env:${parseEnvVarName(apiKeyEnv, deps)}}`;
  return resolveProviderApiKey(apiKey, deps.env);
}

export function resolveCatalogProviderApiKeySource(
  input: CatalogAddOptions,
  deps: ProviderDeps,
): string | undefined {
  const apiKey = nonEmptyString(input.apiKey);
  const apiKeyEnv = nonEmptyString(input.apiKeyEnv);
  if (apiKey !== undefined && apiKeyEnv !== undefined) {
    writeProviderErr(deps, 'cli.runtime.provider.passApiKeyOrEnv');
    deps.exit(1);
  }
  if (apiKeyEnv !== undefined) return `{env:${parseEnvVarName(apiKeyEnv, deps)}}`;
  return resolveApiKey(apiKey, deps.env);
}

export function resolveProviderApiKeySources(input: KeyAddOptions, deps: ProviderDeps): string[] {
  const rawKeys = uniqueStrings([
    ...optionalList(nonEmptyString(input.apiKey)),
    ...splitCommaList(input.apiKeys),
  ]);
  const envNames = uniqueStrings([
    ...optionalList(nonEmptyString(input.apiKeyEnv)),
    ...splitCommaList(input.apiKeyEnvs),
  ]);
  if (rawKeys.length > 0 && envNames.length > 0) {
    writeProviderErr(deps, 'cli.runtime.provider.passRawOrEnvKeys');
    deps.exit(1);
  }
  if (envNames.length > 0) {
    return envNames.map((name) => `{env:${parseEnvVarName(name, deps)}}`);
  }
  if (rawKeys.length > 0) return rawKeys;
  return optionalList(resolveProviderApiKey(undefined, deps.env));
}

export function resolveProviderCredentialLabels(
  input: KeyAddOptions,
  keyCount: number,
  deps: ProviderDeps,
): (string | undefined)[] {
  const label = nonEmptyString(input.label);
  const labelsText = nonEmptyString(input.labels);
  if (label !== undefined && labelsText !== undefined) {
    writeProviderErr(deps, 'cli.runtime.provider.passLabelOrLabels');
    deps.exit(1);
  }
  if (label !== undefined) {
    if (keyCount !== 1) {
      writeProviderErr(deps, 'cli.runtime.provider.labelOnlyForSingleKey');
      deps.exit(1);
    }
    return [parseCredentialLabel(label, deps)];
  }
  if (labelsText === undefined) return Array.from({ length: keyCount }, () => undefined);

  const labels = labelsText.split(',').map((entry) => parseCredentialLabel(entry, deps));
  if (labels.length !== keyCount) {
    writeProviderErr(deps, 'cli.runtime.provider.labelsCountMismatch');
    deps.exit(1);
  }
  const seen = new Set<string>();
  for (const value of labels) {
    const normalized = value.toLowerCase();
    if (seen.has(normalized)) {
      writeProviderErr(deps, 'cli.runtime.provider.duplicateCredentialLabel', { label: value });
      deps.exit(1);
    }
    seen.add(normalized);
  }
  return labels;
}

export function resolveProviderCredentialLocalLimits(
  input: KeyAddOptions,
  deps: ProviderDeps,
): { readonly rpm?: number; readonly tpm?: number } {
  return {
    rpm:
      input.rpm === undefined
        ? undefined
        : parsePositiveInt(input.rpm, 'Requests per minute', deps),
    tpm:
      input.tpm === undefined
        ? undefined
        : parsePositiveInt(input.tpm, 'Tokens per minute', deps),
  };
}

export function parseCredentialLabel(value: string, deps: ProviderDeps): string {
  const label = value.trim();
  if (!isValidCredentialLabel(label)) {
    writeProviderErr(deps, 'cli.runtime.provider.invalidCredentialLabel', { label: value });
    deps.exit(1);
  }
  return label;
}

/* ------------------------------------------------------------------ */
/*  API key slot management                                            */
/* ------------------------------------------------------------------ */

export function addApiKeySlotsToProvider(
  provider: LioraConfig['providers'][string],
  slots: readonly ProviderApiKeySlot[],
): LioraConfig['providers'][string] | undefined {
  const currentSlots = providerApiKeySlots(provider);
  const nextSlots = uniqueApiKeySlots([...currentSlots, ...slots]);
  if (nextSlots.length === currentSlots.length) return undefined;
  return rewriteProviderApiKeySlots(provider, nextSlots);
}

export function rewriteProviderApiKeySlots(
  provider: LioraConfig['providers'][string],
  slots: readonly ProviderApiKeySlot[],
): LioraConfig['providers'][string] {
  const unique = uniqueApiKeySlots(slots);
  const hasObjectCredential = unique.some(
    (slot) =>
      slot.baseUrl !== undefined ||
      slot.label !== undefined ||
      slot.rpm !== undefined ||
      slot.tpm !== undefined,
  );
  const { apiKey: _apiKey, apiKeys: _apiKeys, credentials: _credentials, ...rest } = provider;
  if (unique.length === 0) {
    return {
      ...rest,
      apiKey: '',
      apiKeys: [],
      credentials: [],
    };
  }
  if (hasObjectCredential) {
    return {
      ...rest,
      apiKey: '',
      apiKeys: [],
      credentials: unique.map(apiKeySlotToCredential),
    };
  }
  return {
    ...rest,
    apiKey: unique[0]?.apiKey ?? '',
    apiKeys: unique.slice(1).map((slot) => slot.apiKey),
    credentials: [],
  };
}

export function providerApiKeyCount(provider: LioraConfig['providers'][string]): number {
  return providerApiKeySlots(provider).length;
}

export function providerApiKeySlots(provider: LioraConfig['providers'][string]): ProviderApiKeySlot[] {
  const slots: ProviderApiKeySlot[] = [];
  const primary = nonEmptyString(provider.apiKey);
  if (primary !== undefined) {
    slots.push({
      apiKey: primary,
      credentialSource: credentialSourceLabel(primary, 'api_key'),
    });
  }
  for (let index = 0; index < (provider.apiKeys ?? []).length; index += 1) {
    const apiKey = nonEmptyString(provider.apiKeys?.[index]);
    if (apiKey === undefined) continue;
    slots.push({
      apiKey,
      credentialSource: credentialSourceLabel(apiKey, `api_keys[${String(index + 1)}]`),
    });
  }
  for (let index = 0; index < (provider.credentials ?? []).length; index += 1) {
    const credential = provider.credentials?.[index];
    if (credential === undefined) continue;
    const apiKey = nonEmptyString(credential.apiKey);
    if (apiKey === undefined) continue;
    slots.push({
      apiKey,
      credentialSource: credentialSourceLabel(
        apiKey,
        `credentials[${String(index + 1)}].api_key`,
      ),
      baseUrl: nonEmptyString(credential.baseUrl),
      label: nonEmptyString(credential.label),
      rpm: credential.rpm,
      tpm: credential.tpm,
    });
  }
  if (slots.length > 0) return uniqueApiKeySlots(slots);

  const keys: string[] = [];
  const defaultSource = providerPrimaryCredentialSource(provider);
  if (defaultSource !== undefined) {
    const envKey = providerDefaultApiKeyEnv(provider.type);
    const configured = envKey === undefined ? undefined : nonEmptyString(provider.env?.[envKey]);
    if (configured !== undefined) {
      keys.push(configured);
    }
  }
  return keys.map((apiKey) => ({ apiKey, credentialSource: defaultSource }));
}

function apiKeySlotToCredential(slot: ProviderApiKeySlot): ConfigProviderCredential {
  return {
    apiKey: slot.apiKey,
    baseUrl: slot.baseUrl,
    label: slot.label,
    rpm: slot.rpm,
    tpm: slot.tpm,
  };
}

export function apiKeySlotLabel(slot: ProviderApiKeySlot, index: number): string {
  return slot.label === undefined ? `api_key:${String(index + 1)}` : `api_key:${slot.label}`;
}

function uniqueApiKeySlots(slots: readonly ProviderApiKeySlot[]): ProviderApiKeySlot[] {
  const unique: ProviderApiKeySlot[] = [];
  const seen = new Set<string>();
  for (const slot of slots) {
    const apiKey = nonEmptyString(slot.apiKey);
    if (apiKey === undefined) continue;
    const baseUrl = nonEmptyString(slot.baseUrl);
    const key = `${apiKey}\n${baseUrl ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({
      apiKey,
      credentialSource: slot.credentialSource,
      baseUrl,
      label: nonEmptyString(slot.label),
      rpm: slot.rpm,
      tpm: slot.tpm,
    });
  }
  return unique;
}

/* ------------------------------------------------------------------ */
/*  OAuth ref management                                               */
/* ------------------------------------------------------------------ */

export function addOAuthRefToProvider(
  provider: LioraConfig['providers'][string],
  oauthRef: ConfigOAuthRef,
): LioraConfig['providers'][string] | undefined {
  const refs = providerOAuthRefs(provider);
  if (refs.some((ref) => sameOAuthRef(ref, oauthRef))) return undefined;
  return rewriteProviderOAuthRefs(provider, [...refs, oauthRef]);
}

export function rewriteProviderOAuthRefs(
  provider: LioraConfig['providers'][string],
  refs: readonly ConfigOAuthRef[],
): LioraConfig['providers'][string] {
  return rewriteProviderOAuthRefsShared(
    provider as Record<string, unknown>,
    refs as readonly ProviderOAuthRef[],
  ) as LioraConfig['providers'][string];
}

export function providerOAuthRefs(provider: LioraConfig['providers'][string]): ConfigOAuthRef[] {
  return listProviderOAuthRefs(provider as Record<string, unknown>) as ConfigOAuthRef[];
}

export function promoteSlot<T>(values: readonly T[], index: number): T[] {
  return promoteProviderOAuthSlot(values, index);
}

function sameOAuthRef(left: ConfigOAuthRef, right: ConfigOAuthRef): boolean {
  return (
    left.storage === right.storage &&
    left.key === right.key &&
    (left.oauthHost ?? '') === (right.oauthHost ?? '')
  );
}

export function parseKeyIndex(indexText: string, deps: ProviderDeps): number {
  const index = Number(indexText);
  if (!Number.isInteger(index) || index < 1) {
    writeProviderErr(deps, 'cli.runtime.provider.apiKeyIndexPositive');
    deps.exit(1);
  }
  return index;
}

export function parseOAuthIndex(indexText: string, deps: ProviderDeps): number {
  const index = Number(indexText);
  if (!Number.isInteger(index) || index < 1) {
    writeProviderErr(deps, 'cli.runtime.provider.oauthIndexPositive');
    deps.exit(1);
  }
  return index;
}

export function parseOAuthStorage(value: string, deps: ProviderDeps): ConfigOAuthRef['storage'] {
  if (value === 'file' || value === 'keyring') return value;
  writeProviderErr(deps, 'cli.runtime.provider.oauthStorageInvalid');
  deps.exit(1);
}

export function fingerprintOAuthRef(ref: ConfigOAuthRef): string {
  return fingerprintProviderOAuthRef(ref as ProviderOAuthRef);
}

/* ------------------------------------------------------------------ */
/*  Provider auth predicates                                           */
/* ------------------------------------------------------------------ */

export function providerHasOAuth(provider: LioraConfig['providers'][string]): boolean {
  return provider.oauth !== undefined || (provider.oauths ?? []).length > 0;
}

export function providerHasApiKeySource(provider: LioraConfig['providers'][string]): boolean {
  if (providerPrimaryCredentialSource(provider) !== undefined) return true;
  return providerApiKeySlots(provider).length > 0;
}

export function hasVertexAIServiceAccountSource(provider: LioraConfig['providers'][string]): boolean {
  return (
    provider.type === 'vertexai' &&
    nonEmptyString(provider.env?.['GOOGLE_CLOUD_PROJECT']) !== undefined &&
    nonEmptyString(provider.env?.['GOOGLE_CLOUD_LOCATION']) !== undefined
  );
}

/* ------------------------------------------------------------------ */
/*  Credential source resolution                                       */
/* ------------------------------------------------------------------ */

export function providerCredentialSources(
  provider: LioraConfig['providers'][string],
): ProviderCredentialPreview[] {
  const apiKeySlots = providerApiKeySlots(provider);
  if (apiKeySlots.length > 0) {
    return apiKeySlots.map((slot, index) => ({
      credentialLabel: apiKeySlotLabel(slot, index),
      credentialSource: slot.credentialSource ?? `api_key:${String(index + 1)}`,
      auth: slot.credentialSource === 'keyless' ? 'keyless' : 'api_key',
      baseUrl: slot.baseUrl,
      rpm: slot.rpm,
      tpm: slot.tpm,
    }));
  }

  const oauthSources = providerOAuthCredentialSources(provider);
  if (oauthSources.length <= 1) return [];
  return oauthSources.map((source, index) => ({
    credentialLabel: oauthSlotLabel(source.ref, index),
    credentialSource: source.source,
    auth: 'oauth',
  }));
}

export function providerPrimaryCredentialSource(
  provider: LioraConfig['providers'][string],
): string | undefined {
  const explicit = credentialSourceLabel(provider.apiKey, 'api_key');
  if (explicit !== undefined) return explicit;
  const envKey = providerDefaultApiKeyEnv(provider.type);
  if (envKey === undefined) return undefined;
  return credentialSourceLabel(provider.env?.[envKey], `provider.env.${envKey}`);
}

export function providerDefaultApiKeyEnv(
  type: LioraConfig['providers'][string]['type'],
): string | undefined {
  switch (type) {
    case 'anthropic':
      return 'ANTHROPIC_API_KEY';
    case 'openai':
    case 'openai_responses':
      return 'OPENAI_API_KEY';
    case 'kimi':
      return 'KIMI_API_KEY';
    case 'google-genai':
      return 'GOOGLE_API_KEY';
    case 'vertexai':
      return 'VERTEXAI_API_KEY';
    case 'bedrock':
    case 'vertex_claude':
      return undefined;
    case 'cursor':
      return 'CURSOR_ACCESS_TOKEN';
    default: {
      const exhaustive: never = type;
      return exhaustive;
    }
  }
}

export function credentialSourceLabel(value: string | undefined, fallback: string): string | undefined {
  const normalized = nonEmptyString(value);
  if (normalized === undefined) return undefined;
  if (normalized === 'no-key-required') return 'keyless';
  const envRef = parseEnvReference(normalized);
  return envRef === undefined ? fallback : `env:${envRef}`;
}

export function providerFallbackCredentialSource(provider: LioraConfig['providers'][string]): string {
  if (provider.type === 'vertexai' && hasVertexAIServiceAccountSource(provider)) {
    return 'google_cloud';
  }
  if (providerHasOAuth(provider)) return 'oauth';
  return 'none';
}

export function providerFallbackAuth(
  provider: LioraConfig['providers'][string],
): 'api_key' | 'oauth' | 'keyless' | 'none' | 'vertexai_service_account' {
  if (provider.type === 'vertexai' && hasVertexAIServiceAccountSource(provider)) {
    return 'vertexai_service_account';
  }
  if (providerHasOAuth(provider)) return 'oauth';
  return 'none';
}

export function providerOAuthCredentialSources(
  provider: LioraConfig['providers'][string],
): OAuthCredentialPreview[] {
  const seen = new Set<string>();
  const sources: OAuthCredentialPreview[] = [];
  const append = (
    oauth: LioraConfig['providers'][string]['oauth'] | undefined,
    source: string,
  ): void => {
    if (oauth === undefined) return;
    const key = JSON.stringify([oauth.storage, oauth.key, oauth.oauthHost ?? '']);
    if (seen.has(key)) return;
    seen.add(key);
    sources.push({ ref: oauth, source });
  };
  append(provider.oauth, 'oauth');
  for (let index = 0; index < (provider.oauths ?? []).length; index += 1) {
    append(provider.oauths?.[index], `oauths[${String(index + 1)}]`);
  }
  return sources;
}

function oauthSlotLabel(ref: ConfigOAuthRef, index: number): string {
  const label = nonEmptyString(ref.label);
  return label === undefined ? `oauth:${String(index + 1)}` : `oauth:${label}`;
}

export function isValidCredentialLabel(value: string): boolean {
  return isValidProviderOAuthCredentialLabel(value);
}

export function providerEnvReferences(
  provider: LioraConfig['providers'][string],
): { readonly source: string; readonly envVar: string }[] {
  const refs: { source: string; envVar: string }[] = [];
  const append = (source: string, value: string | undefined): void => {
    const normalized = nonEmptyString(value);
    if (normalized === undefined) return;
    const envVar = parseEnvReference(normalized);
    if (envVar !== undefined) refs.push({ source, envVar });
  };
  append('api_key', provider.apiKey);
  for (let index = 0; index < (provider.apiKeys ?? []).length; index += 1) {
    append(`api_keys[${String(index + 1)}]`, provider.apiKeys?.[index]);
  }
  for (let index = 0; index < (provider.credentials ?? []).length; index += 1) {
    const credential = provider.credentials?.[index];
    append(`credentials[${String(index + 1)}].api_key`, credential?.apiKey);
    append(`credentials[${String(index + 1)}].base_url`, credential?.baseUrl);
  }
  for (const [key, value] of Object.entries(provider.env ?? {})) {
    append(`env.${key}`, value);
  }
  return refs;
}
