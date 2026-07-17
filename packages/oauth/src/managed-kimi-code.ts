import { createHash, randomBytes as nodeRandomBytes } from 'node:crypto';

import { readApiErrorMessage } from './api-error';
import { DEFAULT_SUPERLIORA_OAUTH_HOST } from './constants';
import { OAuthUnauthorizedError } from './errors';
import { DEFAULT_SUPERLIORA_BASE_URL, kimiCodeBaseUrl } from './managed-usage';
import { isRecord } from './utils';

/** Wire platform id sent to Kimi API hosts; do not rename without upstream coordination. */
export const SUPERLIORA_PLATFORM_ID = 'kimi-code';
/** Canonical managed Kimi API provider key in user config. */
export const MANAGED_KIMI_API_PROVIDER = 'managed:kimi-api';
export const SUPERLIORA_PROVIDER_NAME = MANAGED_KIMI_API_PROVIDER;
export const SUPERLIORA_OAUTH_KEY = 'oauth/kimi-code';
const SUPERLIORA_SCOPED_OAUTH_KEY_PREFIX = 'oauth/kimi-code-env-';

export type ManagedKimiCodeProtocol = 'anthropic';

export function parseModelProtocol(value: unknown): ManagedKimiCodeProtocol | undefined {
  return value === 'anthropic' ? value : undefined;
}

/**
 * Server-declared thinking toggle support from `/models`:
 *  - 'only' — thinking cannot be turned off (always-thinking)
 *  - 'no'   — thinking is not supported at all
 *  - 'both' — thinking can be toggled on and off
 * Absent on older servers — callers fall back to `supportsReasoning`.
 */
export type SupportsThinkingType = 'only' | 'no' | 'both';

export interface ManagedKimiCodeModelInfo {
  readonly id: string;
  readonly contextLength: number;
  readonly supportsReasoning: boolean;
  readonly supportsImageIn: boolean;
  readonly supportsVideoIn: boolean;
  readonly supportsToolUse?: boolean;
  readonly supportsThinkingType?: SupportsThinkingType;
  readonly supportEfforts?: readonly string[];
  readonly defaultEffort?: string;
  readonly displayName?: string | undefined;
  readonly protocol?: ManagedKimiCodeProtocol | undefined;
}

export interface ManagedKimiCodeProvisionResult {
  readonly providerName: typeof SUPERLIORA_PROVIDER_NAME;
  readonly defaultModel: string;
  readonly defaultThinking: boolean;
  readonly models: readonly ManagedKimiCodeModelInfo[];
  readonly configPath?: string | undefined;
}

export interface FetchManagedKimiCodeModelsOptions {
  readonly accessToken: string;
  readonly baseUrl?: string | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
}

export interface ManagedKimiCodeApplyResult {
  readonly defaultModel: string;
  readonly defaultThinking: boolean;
}

export interface ManagedKimiCodeCleanupResult {
  readonly providerName: typeof SUPERLIORA_PROVIDER_NAME;
  readonly removedProvider: boolean;
  readonly removedModels: readonly string[];
  readonly defaultModelCleared: boolean;
  readonly removedServices: readonly string[];
}

export interface ManagedKimiOAuthRef {
  readonly storage: 'file' | 'keyring';
  readonly key: string;
  readonly oauthHost?: string | undefined;
}

export interface ManagedKimiOAuthRefInput {
  readonly storage?: 'file' | 'keyring' | undefined;
  readonly key?: string | undefined;
  readonly oauthHost?: string | undefined;
}

export interface ManagedKimiRuntimeAuth {
  readonly baseUrl?: string | undefined;
  readonly oauthRef: ManagedKimiOAuthRef;
}

export interface ManagedKimiLoginAuth {
  readonly baseUrl?: string | undefined;
  readonly oauthHost?: string | undefined;
  readonly oauthRef?: ManagedKimiOAuthRef | undefined;
}

export interface ManagedKimiEnv {
  readonly SUPERLIORA_BASE_URL?: string | undefined;
  readonly SUPERLIORA_OAUTH_HOST?: string | undefined;
  readonly KIMI_OAUTH_HOST?: string | undefined;
}

export class ManagedKimiCodeModelsAuthError extends OAuthUnauthorizedError {
  readonly status: number;
  readonly baseUrl: string;

  constructor(options: {
    readonly status: number;
    readonly baseUrl: string;
    readonly message: string;
  }) {
    super(
      `SuperLiora models endpoint ${options.baseUrl} rejected OAuth credentials: ${options.message}`,
    );
    this.name = 'ManagedKimiCodeModelsAuthError';
    this.status = options.status;
    this.baseUrl = options.baseUrl;
  }
}

export interface ManagedKimiProviderConfig {
  type: 'kimi';
  baseUrl?: string | undefined;
  apiKey?: string | undefined;
  oauth?: ManagedKimiOAuthRef | undefined;
  oauths?: ManagedKimiOAuthRef[] | undefined;
  readonly [key: string]: unknown;
}

export interface ManagedKimiModelAlias {
  provider: string;
  model: string;
  maxContextSize: number;
  capabilities?: string[] | undefined;
  supportEfforts?: string[] | undefined;
  defaultEffort?: string | undefined;
  displayName?: string | undefined;
  protocol?: ManagedKimiCodeProtocol | undefined;
  betaApi?: boolean | undefined;
  adaptiveThinking?: boolean | undefined;
  readonly [key: string]: unknown;
}

export interface ManagedKimiServiceConfig {
  baseUrl?: string | undefined;
  apiKey?: string | undefined;
  oauth?: ManagedKimiOAuthRef | undefined;
}

export interface ManagedKimiServicesConfig {
  moonshotSearch?: ManagedKimiServiceConfig | undefined;
  moonshotFetch?: ManagedKimiServiceConfig | undefined;
  readonly [key: string]: unknown;
}

export interface ManagedKimiConfigShape {
  providers: Record<string, ManagedKimiProviderConfig | Record<string, unknown>>;
  models?: Record<string, ManagedKimiModelAlias | Record<string, unknown>> | undefined;
  defaultModel?: string | undefined;
  defaultThinking?: boolean | undefined;
  services?: ManagedKimiServicesConfig | undefined;
  [key: string]: unknown;
}

export interface ManagedKimiConfigAdapter<TConfig> {
  read(): Promise<TConfig> | TConfig;
  write(config: TConfig): Promise<void> | void;
  apply(
    config: TConfig,
    input: {
      readonly models: readonly ManagedKimiCodeModelInfo[];
      readonly baseUrl?: string | undefined;
      readonly oauthKey?: string | undefined;
      readonly oauthHost?: string | undefined;
      readonly preserveDefaultModel?: boolean | undefined;
    },
  ): ManagedKimiCodeApplyResult;
  remove?(config: TConfig): void;
  readonly configPath?: string | undefined;
}

export interface ProvisionManagedKimiCodeConfigOptions<TConfig> {
  readonly adapter: ManagedKimiConfigAdapter<TConfig>;
  readonly accessToken: string;
  readonly baseUrl?: string | undefined;
  readonly oauthKey?: string | undefined;
  readonly oauthHost?: string | undefined;
  readonly preserveDefaultModel?: boolean | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
}

function managedModelKey(modelId: string): string {
  return `${SUPERLIORA_PLATFORM_ID}/${modelId}`;
}

interface SelectedDefaultModel {
  readonly modelKey: string;
  readonly thinking: boolean;
}

function capabilitiesForModel(model: ManagedKimiCodeModelInfo): string[] | undefined {
  const caps = new Set<string>();
  // supports_thinking_type is the full three-state declaration and wins over
  // the legacy supports_reasoning boolean; absent (older servers) falls back.
  switch (model.supportsThinkingType) {
    case 'only':
      caps.add('thinking');
      caps.add('always_thinking');
      break;
    case 'both':
      caps.add('thinking');
      break;
    case 'no':
      break;
    case undefined:
      if (model.supportsReasoning) caps.add('thinking');
      break;
  }
  if (model.supportsImageIn) caps.add('image_in');
  if (model.supportsVideoIn) caps.add('video_in');
  if (model.supportsToolUse ?? true) caps.add('tool_use');
  return caps.size > 0 ? [...caps] : undefined;
}

function defaultBaseUrl(baseUrl: string | undefined): string {
  return (baseUrl ?? kimiCodeBaseUrl()).replace(/\/+$/, '');
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

function normalizeEndpoint(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function persistedOAuthHost(options: {
  readonly key: string;
  readonly oauthHost?: string | undefined;
}): string | undefined {
  const oauthHost = options.oauthHost;
  const normalized = normalizeEndpoint(oauthHost ?? DEFAULT_SUPERLIORA_OAUTH_HOST);
  if (
    options.key === SUPERLIORA_OAUTH_KEY &&
    normalized === normalizeEndpoint(DEFAULT_SUPERLIORA_OAUTH_HOST)
  ) {
    return undefined;
  }
  return normalized;
}

function managedOAuthRef(options: {
  readonly key: string;
  readonly oauthHost?: string | undefined;
  readonly storage?: 'file' | 'keyring' | undefined;
}): ManagedKimiOAuthRef {
  const oauthHost = persistedOAuthHost(options);
  return {
    storage: options.storage ?? 'file',
    key: options.key,
    oauthHost,
  };
}

function configuredOAuthRef(
  oauthRef: ManagedKimiOAuthRefInput | undefined,
): ManagedKimiOAuthRef | undefined {
  if (oauthRef === undefined) return undefined;
  const key = oauthRef.key;
  if (key === undefined) return undefined;
  return managedOAuthRef({
    storage: oauthRef.storage,
    key,
    oauthHost: oauthRef.oauthHost,
  });
}

function managedOAuthPool(
  primary: ManagedKimiOAuthRef,
  existingProvider: ManagedKimiProviderConfig | Record<string, unknown> | undefined,
): ManagedKimiOAuthRef[] {
  const refs: ManagedKimiOAuthRef[] = [primary];
  if (isRecord(existingProvider)) {
    const existingPrimary = configuredOAuthRef(
      existingProvider['oauth'] as ManagedKimiOAuthRefInput,
    );
    if (existingPrimary !== undefined) refs.push(existingPrimary);
    const existingFallbacks = existingProvider['oauths'];
    if (Array.isArray(existingFallbacks)) {
      for (const ref of existingFallbacks) {
        const configured = configuredOAuthRef(ref as ManagedKimiOAuthRefInput);
        if (configured !== undefined) refs.push(configured);
      }
    }
  }
  return uniqueManagedOAuthRefs(refs);
}

function uniqueManagedOAuthRefs(refs: readonly ManagedKimiOAuthRef[]): ManagedKimiOAuthRef[] {
  const unique: ManagedKimiOAuthRef[] = [];
  for (const ref of refs) {
    if (unique.some((existing) => sameManagedOAuthRef(existing, ref))) continue;
    unique.push(ref);
  }
  return unique;
}

function sameManagedOAuthRef(left: ManagedKimiOAuthRef, right: ManagedKimiOAuthRef): boolean {
  return (
    left.storage === right.storage &&
    left.key === right.key &&
    (left.oauthHost ?? '') === (right.oauthHost ?? '')
  );
}
export function listManagedKimiOAuthRefs(
  provider: ManagedKimiProviderConfig | Record<string, unknown> | undefined,
): ManagedKimiOAuthRef[] {
  if (!isRecord(provider)) return [];
  const refs: ManagedKimiOAuthRef[] = [];
  const primary = configuredOAuthRef(provider['oauth'] as ManagedKimiOAuthRefInput);
  if (primary !== undefined) refs.push(primary);
  if (Array.isArray(provider['oauths'])) {
    for (const entry of provider['oauths']) {
      const ref = configuredOAuthRef(entry as ManagedKimiOAuthRefInput);
      if (ref !== undefined) refs.push(ref);
    }
  }
  return uniqueManagedOAuthRefs(refs);
}

/**
 * Allocate a fresh OAuth storage key for an additional login account so the
 * existing primary/fallback refs stay intact. When no provider accounts exist
 * yet, returns the canonical default key so the first login stays stable.
 */
export function allocateManagedKimiOAuthAccountKey(
  provider: ManagedKimiProviderConfig | Record<string, unknown> | undefined,
  options: {
    readonly oauthHost?: string | undefined;
    readonly baseUrl?: string | undefined;
    readonly label?: string | undefined;
    readonly now?: (() => number) | undefined;
    readonly randomBytes?: ((size: number) => Uint8Array) | undefined;
  } = {},
): ManagedKimiOAuthRef {
  const existing = listManagedKimiOAuthRefs(provider);
  const oauthHost = options.oauthHost;
  const baseUrl = options.baseUrl;
  if (existing.length === 0) {
    return managedOAuthRef({
      key: resolveKimiCodeOAuthKey({ oauthHost, baseUrl }),
      oauthHost,
    });
  }

  const used = new Set(existing.map((ref) => ref.key));
  const labelSlug = sanitizeOAuthAccountLabel(options.label);
  if (labelSlug !== undefined) {
    const labeledKey = `oauth/kimi-code-${labelSlug}`;
    if (!used.has(labeledKey)) {
      return managedOAuthRef({ key: labeledKey, oauthHost });
    }
  }

  const now = options.now ?? Date.now;
  const randomBytes = options.randomBytes ?? ((size: number) => nodeRandomBytes(size));

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const stamp = now().toString(36);
    const entropy = Buffer.from(randomBytes(4)).toString('hex');
    const key = `oauth/kimi-code-account-${stamp}${attempt === 0 ? '' : `-${String(attempt)}`}-${entropy}`;
    if (!used.has(key)) {
      return managedOAuthRef({ key, oauthHost });
    }
  }

  // Extremely unlikely collision path: fall back to a full sha digest.
  const digest = createHash('sha256')
    .update(JSON.stringify({ used: [...used], at: now() }))
    .digest('hex')
    .slice(0, 16);
  return managedOAuthRef({ key: `oauth/kimi-code-account-${digest}`, oauthHost });
}

function sanitizeOAuthAccountLabel(label: string | undefined): string | undefined {
  const trimmed = label?.trim().toLowerCase();
  if (trimmed === undefined || trimmed.length === 0) return undefined;
  const slug = trimmed
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug.length === 0 ? undefined : slug;
}

export function kimiCodeEnvBaseUrl(env: ManagedKimiEnv = process.env): string | undefined {
  return env.SUPERLIORA_BASE_URL;
}

export function kimiCodeEnvOAuthHost(env: ManagedKimiEnv = process.env): string | undefined {
  return env.SUPERLIORA_OAUTH_HOST ?? env.KIMI_OAUTH_HOST;
}

export function resolveKimiCodeOAuthKey(options: {
  readonly oauthHost?: string | undefined;
  readonly baseUrl?: string | undefined;
}): string {
  const oauthHost = normalizeEndpoint(options.oauthHost ?? DEFAULT_SUPERLIORA_OAUTH_HOST);
  const baseUrl = defaultBaseUrl(options.baseUrl);
  const defaultOauthHost = normalizeEndpoint(DEFAULT_SUPERLIORA_OAUTH_HOST);
  const defaultApiBaseUrl = normalizeEndpoint(DEFAULT_SUPERLIORA_BASE_URL);

  if (oauthHost === defaultOauthHost && baseUrl === defaultApiBaseUrl) {
    return SUPERLIORA_OAUTH_KEY;
  }

  const digest = createHash('sha256')
    .update(JSON.stringify({ oauthHost, baseUrl }))
    .digest('hex')
    .slice(0, 16);
  return `${SUPERLIORA_SCOPED_OAUTH_KEY_PREFIX}${digest}`;
}

/**
 * Resolve the full managed-Kimi-Code OAuth ref (credential storage key +
 * persisted host) for an (oauthHost, baseUrl) environment.
 *
 * Single source of truth for "which credential slot does this environment map
 * to". Login, provisioning, and the runtime provider all derive their ref
 * through here, so the slot a token is written to always matches the slot it
 * is later read from — preventing the env-mismatch credential mix-ups this
 * scoping is meant to fix.
 */
export function resolveKimiCodeOAuthRef(options: {
  readonly oauthHost?: string | undefined;
  readonly baseUrl?: string | undefined;
}): ManagedKimiOAuthRef {
  return managedOAuthRef({
    key: resolveKimiCodeOAuthKey(options),
    oauthHost: options.oauthHost,
  });
}

export function resolveKimiCodeRuntimeAuth(options: {
  readonly configuredBaseUrl?: string | undefined;
  readonly configuredOAuthRef?: ManagedKimiOAuthRefInput | undefined;
  readonly env?: ManagedKimiEnv | undefined;
}): ManagedKimiRuntimeAuth {
  const env = options.env ?? process.env;
  const envBaseUrl = kimiCodeEnvBaseUrl(env);
  const envOAuthHost = kimiCodeEnvOAuthHost(env);
  const hasEnvOverride = envBaseUrl !== undefined || envOAuthHost !== undefined;
  const baseUrl =
    envBaseUrl !== undefined ? normalizeBaseUrl(envBaseUrl) : options.configuredBaseUrl;
  const expected = resolveKimiCodeOAuthRef({
    oauthHost: hasEnvOverride ? envOAuthHost : options.configuredOAuthRef?.oauthHost,
    baseUrl,
  });
  const configured = configuredOAuthRef(options.configuredOAuthRef);
  if (configured === undefined) return { baseUrl, oauthRef: expected };
  if (hasEnvOverride) return { baseUrl, oauthRef: expected };
  if (configured.key !== expected.key) return { baseUrl, oauthRef: expected };
  return { baseUrl, oauthRef: configured };
}

export function resolveKimiCodeLoginAuth(options: {
  readonly configuredBaseUrl?: string | undefined;
  readonly configuredOAuthRef?: ManagedKimiOAuthRefInput | undefined;
  readonly requestedBaseUrl?: string | undefined;
  readonly requestedOAuthHost?: string | undefined;
  readonly env?: ManagedKimiEnv | undefined;
}): ManagedKimiLoginAuth {
  const env = options.env ?? process.env;
  const envBaseUrl = kimiCodeEnvBaseUrl(env);
  const envOAuthHost = kimiCodeEnvOAuthHost(env);
  const hasOverride =
    options.requestedBaseUrl !== undefined ||
    options.requestedOAuthHost !== undefined ||
    envBaseUrl !== undefined ||
    envOAuthHost !== undefined;
  const baseUrl =
    options.requestedBaseUrl !== undefined
      ? normalizeBaseUrl(options.requestedBaseUrl)
      : envBaseUrl !== undefined
        ? normalizeBaseUrl(envBaseUrl)
        : options.configuredBaseUrl;
  const oauthHost = options.requestedOAuthHost ?? envOAuthHost;
  if (hasOverride) return { baseUrl, oauthHost };

  const configured = configuredOAuthRef(options.configuredOAuthRef);
  if (configured === undefined) return { baseUrl, oauthHost };
  const expectedKey = resolveKimiCodeOAuthKey({
    oauthHost: configured.oauthHost,
    baseUrl,
  });
  return configured.key === expectedKey
    ? { baseUrl, oauthHost, oauthRef: configured }
    : { baseUrl, oauthHost };
}

function toModelInfo(item: unknown): ManagedKimiCodeModelInfo | undefined {
  if (!isRecord(item) || typeof item['id'] !== 'string' || item['id'].length === 0) {
    return undefined;
  }
  const contextLength = Number(item['context_length']);
  if (!Number.isInteger(contextLength) || contextLength <= 0) {
    throw new Error(`SuperLiora model "${item['id']}" must include a positive context_length.`);
  }
  const displayName = item['display_name'];
  const normalizedDisplayName =
    typeof displayName === 'string' && displayName.length > 0 ? displayName : undefined;
  const supportsToolUse = Object.hasOwn(item, 'supports_tool_use')
    ? Boolean(item['supports_tool_use'])
    : true;
  const thinkEfforts = parseThinkEfforts(item['think_efforts']);
  return {
    id: item['id'],
    contextLength,
    supportsReasoning: Boolean(item['supports_reasoning']),
    supportsImageIn: Boolean(item['supports_image_in']),
    supportsVideoIn: Boolean(item['supports_video_in']),
    supportsToolUse,
    supportsThinkingType: parseSupportsThinkingType(item['supports_thinking_type']),
    supportEfforts: thinkEfforts.supportEfforts ?? parseStringArray(item['support_efforts']),
    defaultEffort:
      thinkEfforts.defaultEffort ?? parseNonEmptyString(item['default_effort']),
    displayName: normalizedDisplayName,
    protocol: parseModelProtocol(item['protocol']),
  };
}

export function parseStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter(
    (entry): entry is string => typeof entry === 'string' && entry.length > 0,
  );
  return out.length > 0 ? out : undefined;
}

function parseNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

// Unknown or missing values resolve to undefined so callers fall back to the
// legacy supports_reasoning boolean instead of guessing.
export function parseSupportsThinkingType(value: unknown): SupportsThinkingType | undefined {
  return value === 'only' || value === 'no' || value === 'both' ? value : undefined;
}

export function parseThinkEfforts(value: unknown): {
  supportEfforts: readonly string[] | undefined;
  defaultEffort: string | undefined;
} {
  if (!isRecord(value) || value['support'] !== true) {
    return { supportEfforts: undefined, defaultEffort: undefined };
  }
  return {
    supportEfforts: parseStringArray(value['valid_efforts']),
    defaultEffort: parseNonEmptyString(value['default_effort']),
  };
}

export async function fetchManagedKimiCodeModels(
  options: FetchManagedKimiCodeModelsOptions,
): Promise<ManagedKimiCodeModelInfo[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = defaultBaseUrl(options.baseUrl);
  const response = await fetchImpl(`${baseUrl}/models`, {
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    const message = await readApiErrorMessage(
      response,
      `Failed to list SuperLiora models (HTTP ${response.status}).`,
    );
    if (response.status === 401 || response.status === 402 || response.status === 403) {
      throw new ManagedKimiCodeModelsAuthError({
        status: response.status,
        baseUrl,
        message,
      });
    }
    throw new Error(message);
  }
  const payload: unknown = await response.json();
  if (!isRecord(payload) || !Array.isArray(payload['data'])) {
    throw new Error(`Unexpected models response for ${baseUrl}.`);
  }
  return payload['data']
    .map((item) => toModelInfo(item))
    .filter((item): item is ManagedKimiCodeModelInfo => item !== undefined);
}

export function applyManagedKimiCodeConfig(
  config: ManagedKimiConfigShape,
  options: {
    readonly models: readonly ManagedKimiCodeModelInfo[];
    readonly baseUrl?: string | undefined;
    readonly oauthKey?: string | undefined;
    readonly oauthHost?: string | undefined;
    readonly preserveDefaultModel?: boolean | undefined;
  },
): ManagedKimiCodeApplyResult {
  if (options.models.length === 0) {
    throw new Error('No models available for SuperLiora.');
  }
  for (const model of options.models) {
    assertPositiveContextLength(model);
  }

  const baseUrl = defaultBaseUrl(options.baseUrl);
  const oauth =
    options.oauthKey !== undefined
      ? managedOAuthRef({ key: options.oauthKey, oauthHost: options.oauthHost })
      : resolveKimiCodeOAuthRef({ baseUrl, oauthHost: options.oauthHost });
  const oauthPool = managedOAuthPool(oauth, config.providers[SUPERLIORA_PROVIDER_NAME]);
  const existingModels = config.models ?? {};
  const selectedDefault = selectDefaultModel(config, options.models, {
    preserveExisting: options.preserveDefaultModel === true,
  });

  config.providers[SUPERLIORA_PROVIDER_NAME] = {
    type: 'kimi',
    baseUrl,
    apiKey: '',
    oauth: oauthPool[0],
    ...(oauthPool.length > 1 ? { oauths: oauthPool.slice(1) } : {}),
  };

  const upstreamKeys = new Set(options.models.map((model) => managedModelKey(model.id)));
  for (const [key, model] of Object.entries(existingModels)) {
    if (
      isRecord(model) &&
      model['provider'] === SUPERLIORA_PROVIDER_NAME &&
      !upstreamKeys.has(key)
    ) {
      delete existingModels[key];
    }
  }
  for (const model of options.models) {
    const capabilities = capabilitiesForModel(model);
    const supportsAdaptiveThinking =
      model.protocol === 'anthropic' &&
      (capabilities?.includes('thinking') === true ||
        capabilities?.includes('always_thinking') === true);
    const key = managedModelKey(model.id);
    const existing = isRecord(existingModels[key]) ? existingModels[key] : {};
    existingModels[key] = {
      ...existing,
      provider: SUPERLIORA_PROVIDER_NAME,
      model: model.id,
      maxContextSize: model.contextLength,
      capabilities,
      ...(model.supportEfforts !== undefined ? { supportEfforts: [...model.supportEfforts] } : {}),
      ...(model.defaultEffort !== undefined ? { defaultEffort: model.defaultEffort } : {}),
      ...(model.displayName !== undefined ? { displayName: model.displayName } : {}),
      protocol: model.protocol,
      betaApi: model.protocol === 'anthropic' ? true : undefined,
      adaptiveThinking: supportsAdaptiveThinking ? true : undefined,
    };
  }

  config.models = existingModels;
  config.defaultModel = selectedDefault.modelKey;
  config.defaultThinking = selectedDefault.thinking;
  config.services = {
    moonshotSearch: {
      baseUrl: `${baseUrl}/search`,
      apiKey: '',
      oauth,
    },
    moonshotFetch: {
      baseUrl: `${baseUrl}/fetch`,
      apiKey: '',
      oauth,
    },
  };

  return {
    defaultModel: selectedDefault.modelKey,
    defaultThinking: selectedDefault.thinking,
  };
}

export function applyManagedKimiCodeLogoutConfig(config: ManagedKimiConfigShape): void {
  delete config.providers[SUPERLIORA_PROVIDER_NAME];

  let removedDefaultModel = false;
  const existingModels = config.models ?? {};
  for (const [key, model] of Object.entries(existingModels)) {
    if (!isRecord(model) || model['provider'] !== SUPERLIORA_PROVIDER_NAME) continue;
    delete existingModels[key];
    if (config.defaultModel === key) removedDefaultModel = true;
  }
  config.models = existingModels;

  if (removedDefaultModel) {
    config.defaultModel = undefined;
  }

  if (config['defaultProvider'] === SUPERLIORA_PROVIDER_NAME) {
    config['defaultProvider'] = undefined;
  }

  if (config.services !== undefined) {
    delete config.services.moonshotSearch;
    delete config.services.moonshotFetch;
    if (Object.keys(config.services).length === 0) {
      config.services = undefined;
    }
  }
}

// The server's three-state declaration overrides any stale defaultThinking
// being preserved from an earlier config: an always-thinking model ('only')
// must never end up with thinking off, and a non-thinking model ('no') must
// never end up with thinking on.
function forcedThinking(
  model: ManagedKimiCodeModelInfo | undefined,
  fallback: boolean,
): boolean {
  if (model?.supportsThinkingType === 'only') return true;
  if (model?.supportsThinkingType === 'no') return false;
  return fallback;
}

function selectDefaultModel(
  config: ManagedKimiConfigShape,
  models: readonly ManagedKimiCodeModelInfo[],
  options: { readonly preserveExisting: boolean },
): SelectedDefaultModel {
  const firstModel = models[0];
  if (firstModel === undefined) {
    throw new Error('No models available for SuperLiora.');
  }

  const managedModels = new Map(models.map((model) => [managedModelKey(model.id), model]));
  const existingModels = config.models ?? {};
  const currentDefault =
    typeof config.defaultModel === 'string' && config.defaultModel.length > 0
      ? config.defaultModel
      : undefined;

  if (
    options.preserveExisting &&
    currentDefault !== undefined &&
    canPreserveDefaultModel(existingModels, currentDefault, managedModels)
  ) {
    const preservedModel = managedModels.get(currentDefault);
    return {
      modelKey: currentDefault,
      thinking: forcedThinking(
        preservedModel,
        config.defaultThinking ?? preservedModel?.supportsReasoning ?? false,
      ),
    };
  }

  return {
    modelKey: managedModelKey(firstModel.id),
    thinking: forcedThinking(firstModel, config.defaultThinking ?? firstModel.supportsReasoning),
  };
}

function canPreserveDefaultModel(
  existingModels: Record<string, ManagedKimiModelAlias | Record<string, unknown>>,
  defaultModel: string,
  managedModels: ReadonlyMap<string, ManagedKimiCodeModelInfo>,
): boolean {
  if (managedModels.has(defaultModel)) return true;
  const existing = existingModels[defaultModel];
  return isRecord(existing) && existing['provider'] !== SUPERLIORA_PROVIDER_NAME;
}

export function clearManagedKimiCodeConfig(
  config: ManagedKimiConfigShape,
): ManagedKimiCodeCleanupResult {
  const removedProvider = Object.hasOwn(config.providers, SUPERLIORA_PROVIDER_NAME);
  delete config.providers[SUPERLIORA_PROVIDER_NAME];

  const removedModels: string[] = [];
  const models = config.models;
  if (models !== undefined) {
    for (const [key, model] of Object.entries(models)) {
      if (!isRecord(model) || model['provider'] !== SUPERLIORA_PROVIDER_NAME) continue;
      delete models[key];
      removedModels.push(key);
    }
  }

  let defaultModelCleared = false;
  if (typeof config.defaultModel === 'string' && removedModels.includes(config.defaultModel)) {
    config.defaultModel = undefined;
    defaultModelCleared = true;
  }

  const removedServices: string[] = [];
  if (config.services?.moonshotSearch !== undefined) {
    delete config.services.moonshotSearch;
    removedServices.push('moonshotSearch');
  }
  if (config.services?.moonshotFetch !== undefined) {
    delete config.services.moonshotFetch;
    removedServices.push('moonshotFetch');
  }
  if (config.services !== undefined && Object.keys(config.services).length === 0) {
    config.services = undefined;
  }

  return {
    providerName: SUPERLIORA_PROVIDER_NAME,
    removedProvider,
    removedModels,
    defaultModelCleared,
    removedServices,
  };
}

function assertPositiveContextLength(model: ManagedKimiCodeModelInfo): void {
  if (!Number.isInteger(model.contextLength) || model.contextLength <= 0) {
    throw new Error(`SuperLiora model "${model.id}" must include a positive context_length.`);
  }
}

export async function provisionManagedKimiCodeConfigAfterLogin(
  options: ProvisionManagedKimiCodeConfigOptions<ManagedKimiConfigShape>,
): Promise<ManagedKimiCodeProvisionResult> {
  return provisionManagedKimiCodeConfig(options);
}

export async function provisionManagedKimiCodeConfig<TConfig>(
  options: ProvisionManagedKimiCodeConfigOptions<TConfig>,
): Promise<ManagedKimiCodeProvisionResult> {
  const models = await fetchManagedKimiCodeModels(options);
  const config = await options.adapter.read();
  const applied = options.adapter.apply(config, {
    models,
    baseUrl: options.baseUrl,
    oauthKey: options.oauthKey,
    oauthHost: options.oauthHost,
    preserveDefaultModel: options.preserveDefaultModel,
  });
  await options.adapter.write(config);
  return {
    providerName: SUPERLIORA_PROVIDER_NAME,
    defaultModel: applied.defaultModel,
    defaultThinking: applied.defaultThinking,
    models,
    configPath: options.adapter.configPath,
  };
}
