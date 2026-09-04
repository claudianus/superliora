import { applyXaiPricingSafeContextTokens } from '@superliora/oauth';
import { catalogThinkingMetadata, type Catalog, type LioraConfig } from '@superliora/sdk';

type ProviderType = LioraConfig['providers'][string]['type'];
type ProviderConfig = LioraConfig['providers'][string];
type ModelConfig = NonNullable<LioraConfig['models']>[string];

export const DEFAULT_CUSTOM_ENDPOINT_CONTEXT_SIZE = 128_000;

/** Wire types that can be inferred from a full endpoint URL path. */
export type InferredCustomEndpointWireType = 'openai' | 'openai_responses' | 'anthropic';

export interface InferredCustomEndpoint {
  readonly baseUrl: string;
  readonly providerType?: InferredCustomEndpointWireType;
}

export interface CustomEndpointProviderInput {
  readonly providerId: string;
  readonly baseUrl: string;
  readonly modelId: string;
  readonly apiKey?: string;
  readonly providerType?: ProviderType;
  readonly alias?: string;
  readonly maxContextSize?: number;
  readonly maxOutputSize?: number;
  readonly displayName?: string;
  readonly thinking?: boolean;
  readonly supportEfforts?: readonly string[];
  /** Extra static headers (gateways, auth proxies). Wins over preserved ones. */
  readonly customHeaders?: Readonly<Record<string, string>>;
  readonly setDefault?: boolean;
}

export interface AppliedCustomEndpointProvider {
  readonly providerId: string;
  readonly modelAlias: string;
}

/**
 * Infers wire type from a pasted endpoint URL and strips the route suffix so the
 * stored value is an SDK base URL.
 *
 * Examples:
 * - `…/v1/responses` → base `…/v1`, type `openai_responses`
 * - `…/v1/chat/completions` → base `…/v1`, type `openai`
 * - `…/v1/messages` → base `…` (Anthropic SDK appends `/v1/messages`), type `anthropic`
 */
export function inferCustomEndpointFromUrl(raw: string): InferredCustomEndpoint {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { baseUrl: trimmed };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { baseUrl: trimmed };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { baseUrl: trimmed };
  }

  parsed.search = '';
  parsed.hash = '';
  const pathname = parsed.pathname.replace(/\/+$/, '');

  const rules: readonly {
    readonly suffix: RegExp;
    readonly providerType: InferredCustomEndpointWireType;
    readonly stripTrailingVersion?: boolean;
  }[] = [
    { suffix: /\/responses$/i, providerType: 'openai_responses' },
    { suffix: /\/chat\/completions$/i, providerType: 'openai' },
    { suffix: /\/messages$/i, providerType: 'anthropic', stripTrailingVersion: true },
  ];

  for (const rule of rules) {
    if (!rule.suffix.test(pathname)) continue;
    let nextPath = pathname.replace(rule.suffix, '');
    if (rule.stripTrailingVersion === true) {
      nextPath = nextPath.replace(/\/v\d+$/i, '');
    }
    parsed.pathname = nextPath.length === 0 ? '/' : nextPath;
    return {
      baseUrl: parsed.toString().replace(/\/+$/, ''),
      providerType: rule.providerType,
    };
  }

  const host = parsed.hostname.toLowerCase();
  if (host === 'chatgpt.com' || host.endsWith('.chatgpt.com') || /\/backend-api(\/|$)/i.test(pathname)) {
    return {
      baseUrl: parsed.toString().replace(/\/+$/, ''),
      providerType: 'openai_responses',
    };
  }

  return { baseUrl: parsed.toString().replace(/\/+$/, '') };
}

export function applyCustomEndpointProvider(
  config: LioraConfig,
  input: CustomEndpointProviderInput,
): AppliedCustomEndpointProvider {
  const providerId = requireIdentifier(input.providerId, 'Provider id');
  const modelId = requireNonEmpty(input.modelId, 'Model id');
  const modelAlias = normalizeModelAlias(input.alias, providerId, modelId);
  const inferred = inferCustomEndpointFromUrl(input.baseUrl);
  const baseUrl = normalizeHttpUrl(inferred.baseUrl);
  const advertisedContext = input.maxContextSize ?? DEFAULT_CUSTOM_ENDPOINT_CONTEXT_SIZE;
  if (!Number.isInteger(advertisedContext) || advertisedContext <= 0) {
    throw new Error('Context window must be a positive integer.');
  }
  const maxContextSize = applyXaiPricingSafeContextTokens(advertisedContext, {
    provider: providerId,
    model: modelId,
  });
  const maxOutputSize = input.maxOutputSize;
  if (maxOutputSize !== undefined && (!Number.isInteger(maxOutputSize) || maxOutputSize <= 0)) {
    throw new Error('Max output tokens must be a positive integer.');
  }

  const providerType = input.providerType ?? inferred.providerType ?? 'openai';
  const apiKey = nonEmptyString(input.apiKey) ?? 'no-key-required';
  const displayName = nonEmptyString(input.displayName);
  const capabilities = input.thinking === true ? ['tool_use', 'thinking'] : ['tool_use'];

  // Re-adding a provider id (e.g. a second model on the same endpoint) must
  // not wipe hand-maintained config the dialogs never collect: keep the
  // existing credential pool and custom headers. The primary apiKey still
  // follows the new input.
  const existing = config.providers[providerId] as
    | { apiKeys?: unknown; customHeaders?: unknown }
    | undefined;
  const preservedApiKeys =
    existing !== undefined && Array.isArray(existing.apiKeys) ? [...existing.apiKeys] : [];
  const preservedHeaders =
    existing !== undefined &&
    typeof existing.customHeaders === 'object' &&
    existing.customHeaders !== null
      ? { ...(existing.customHeaders as Record<string, string>) }
      : undefined;
  // Explicit headers win; otherwise keep hand-maintained ones so re-adding a
  // model never drops gateway/proxy headers the dialogs never collect.
  const customHeaders =
    input.customHeaders !== undefined
      ? { ...input.customHeaders }
      : preservedHeaders;

  const provider: ProviderConfig = {
    type: providerType,
    baseUrl,
    apiKey,
    apiKeys: preservedApiKeys,
    ...(customHeaders === undefined ? {} : { customHeaders }),
    source: {
      kind: 'customEndpoint',
      baseUrl,
      model: modelId,
    },
  };
  const model: ModelConfig = {
    provider: providerId,
    model: modelId,
    maxContextSize,
    maxOutputSize,
    capabilities,
    displayName,
    ...(input.supportEfforts !== undefined && input.supportEfforts.length > 0
      ? { supportEfforts: [...input.supportEfforts] }
      : {}),
  };

  config.providers = {
    ...config.providers,
    [providerId]: provider,
  };
  config.models = {
    ...config.models,
    [modelAlias]: model,
  };
  if (input.setDefault === true) {
    config.defaultModel = modelAlias;
  }
  return { providerId, modelAlias };
}

function normalizeModelAlias(
  alias: string | undefined,
  providerId: string,
  modelId: string,
): string {
  const normalized = nonEmptyString(alias) ?? `${providerId}/${modelId}`;
  return requireNonEmpty(normalized, 'Model alias');
}

function requireIdentifier(value: string, label: string): string {
  const normalized = requireNonEmpty(value, label);
  if (/\s/.test(normalized)) {
    throw new Error(`${label} cannot contain whitespace.`);
  }
  return normalized;
}

function requireNonEmpty(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`${label} is required.`);
  return normalized;
}

function normalizeHttpUrl(value: string): string {
  const normalized = requireNonEmpty(value, 'Base URL');
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error('Base URL must be a valid URL.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Base URL must start with http:// or https://.');
  }
  return normalized.replace(/\/+$/, '');
}

function nonEmptyString(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized === undefined || normalized.length === 0 ? undefined : normalized;
}

/**
 * Parses extra static headers from dialog/CLI text. One `Name: value` pair
 * per line (semicolons also split, since commas are legal inside values).
 * Splits on the FIRST colon so base64 values containing `=`/`:` survive.
 * Throws a field-ready message on the first malformed line.
 */
export function parseCustomHeaders(
  raw: string | undefined,
  label = 'Headers',
): Record<string, string> | undefined {
  if (raw === undefined) return undefined;
  const out: Record<string, string> = {};
  const lines = raw
    .split(/\r?\n|;/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (const line of lines) {
    const colon = line.indexOf(':');
    if (colon <= 0) {
      throw new Error(
        `${label} must be "Name: value" pairs (line "${line.length > 40 ? `${line.slice(0, 40)}…` : line}").`,
      );
    }
    const name = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (name.length === 0 || value.length === 0) {
      throw new Error(`${label} must be "Name: value" pairs (empty name or value).`);
    }
    out[name] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

const ENV_KEY_REFERENCE_PATTERNS = [/^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/, /^env:([A-Za-z_][A-Za-z0-9_]*)$/];

/** True when the key field references an env var instead of a literal key. */
export function isApiKeyEnvReference(value: string | undefined): boolean {
  if (value === undefined) return false;
  const trimmed = value.trim();
  return ENV_KEY_REFERENCE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * Resolves an env-var key reference (`{env:NAME}` / `env:NAME`) against
 * `process.env`. Returns `{ name, value }` (`value` undefined when unset) or
 * `undefined` when the input is a literal key.
 */
export function resolveApiKeyEnvReference(
  value: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): { readonly name: string; readonly value: string | undefined } | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  for (const pattern of ENV_KEY_REFERENCE_PATTERNS) {
    const match = pattern.exec(trimmed);
    if (match?.[1] !== undefined) {
      const name = match[1];
      const resolved = env[name]?.trim();
      return { name, value: resolved !== undefined && resolved.length > 0 ? resolved : undefined };
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// models.dev catalog lookup
// ---------------------------------------------------------------------------

/** Capability hints resolved from a models.dev catalog entry. */
export interface ModelCapabilityHint {
  readonly thinking: boolean;
  readonly toolUse: boolean;
  readonly maxContextTokens?: number;
  readonly maxOutputTokens?: number;
  readonly supportEfforts?: readonly string[];
  readonly defaultEffort?: string;
}

/**
 * Looks up model capability hints from a models.dev-style catalog.
 *
 * Matching strategy:
 *  1. Exact `providerId/modelId` in the catalog's provider entry.
 *  2. Fuzzy model-id match across all providers (handles aliases like
 *     `claude-sonnet-4-20250514` matching `claude-sonnet-4`).
 *
 * Returns `undefined` when no match is found.
 */
export function lookupModelCapability(
  catalog: Catalog,
  providerId: string,
  modelId: string,
): ModelCapabilityHint | undefined {
  // 1. Try exact provider match first.
  const providerEntry = catalog[providerId];
  if (providerEntry?.models !== undefined) {
    const exact = providerEntry.models[modelId];
    if (exact !== undefined) return hintFromCatalogModel(exact);
    // Fuzzy: model id may omit a date suffix or use a different separator.
    const fuzzy = fuzzyMatchModel(providerEntry.models, modelId);
    if (fuzzy !== undefined) return hintFromCatalogModel(fuzzy);
  }

  // 2. Scan all providers for a fuzzy model-id match.
  const lowerModelId = modelId.toLowerCase();
  for (const entry of Object.values(catalog)) {
    if (entry.models === undefined) continue;
    for (const [key, model] of Object.entries(entry.models)) {
      if (key.toLowerCase() === lowerModelId || model.id?.toLowerCase() === lowerModelId) {
        return hintFromCatalogModel(model);
      }
    }
    const fuzzy = fuzzyMatchModel(entry.models, modelId);
    if (fuzzy !== undefined) return hintFromCatalogModel(fuzzy);
  }

  return undefined;
}

type CatalogModelEntry = NonNullable<Catalog[string]['models']>[string];

function hintFromCatalogModel(model: CatalogModelEntry): ModelCapabilityHint {
  const thinking = catalogThinkingMetadata(model);
  return {
    thinking: model.reasoning === true,
    toolUse: model.tool_call ?? true,
    maxContextTokens: model.limit?.context,
    maxOutputTokens: model.limit?.output,
    ...(thinking.supportEfforts !== undefined && thinking.supportEfforts.length > 0
      ? { supportEfforts: thinking.supportEfforts }
      : {}),
  };
}

/**
 * Fuzzy-matches a model id by stripping common date suffixes
 * (e.g. `-20250514`) and comparing the base name.
 */
function fuzzyMatchModel(
  models: Record<string, CatalogModelEntry>,
  modelId: string,
): CatalogModelEntry | undefined {
  const base = modelId.replace(/-\d{6,8}$/, '').toLowerCase();
  if (base === modelId.toLowerCase()) return undefined;
  for (const [key, model] of Object.entries(models)) {
    const keyBase = key.replace(/-\d{6,8}$/, '').toLowerCase();
    if (keyBase === base) return model;
    const idBase = model.id?.replace(/-\d{6,8}$/, '').toLowerCase();
    if (idBase === base) return model;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// /models endpoint probe (best-effort)
// ---------------------------------------------------------------------------

const PROBE_TIMEOUT_MS = 3000;

/** Ceiling for the pre-save endpoint verification (`connectCustomEndpoint`). */
export const VERIFY_TIMEOUT_MS = 8000;

/**
 * Pre-save verification of a custom endpoint: discriminates "key rejected"
 * from "server unreachable" from "no models API" so the login flow can block
 * on typos but stay fail-soft for offline local servers and non-OpenAI wires
 * (Anthropic/Kimi/Gemini don't serve `/models`, so 404 verifies reachability
 * without confirming the model id).
 */
export type CustomEndpointVerification =
  | {
      readonly ok: true;
      /** False when the server answered but doesn't list this model id. */
      readonly modelListed: boolean;
      readonly hint?: ModelCapabilityHint;
      /**
       * Models advertised by `/models` (first few), each with its own
       * capability hint — powers the in-flow model picker so the id never
       * has to be typed (or re-typed after a typo).
       */
      readonly availableModels?: readonly ListedEndpointModel[];
    }
  | {
      readonly ok: false;
      readonly reason: 'unreachable' | 'unauthorized' | 'env-missing';
      readonly detail: string;
      readonly status?: number;
    };

/** One `/models` entry with the capability hint the picker needs. */
export interface ListedEndpointModel {
  readonly id: string;
  readonly thinking: boolean;
  readonly supportEfforts?: readonly string[];
}

export async function verifyCustomEndpointConnection(
  baseUrl: string,
  apiKey: string | undefined,
  modelId: string,
  fetchImpl: typeof fetch = fetch,
  options: { readonly timeoutMs?: number; readonly headers?: Readonly<Record<string, string>> } = {},
): Promise<CustomEndpointVerification> {
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const url = `${normalizedBase}/models`;
  // Env-var key references resolve here so the probe tests the real
  // credential; an unset variable is its own precise failure, not a 401.
  const envRef = resolveApiKeyEnvReference(apiKey);
  if (envRef !== undefined && envRef.value === undefined) {
    return {
      ok: false,
      reason: 'env-missing',
      detail: `Environment variable ${envRef.name} is not set.`,
    };
  }
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...options.headers,
  };
  const key = envRef?.value ?? apiKey?.trim();
  const hasKey = key !== undefined && key.length > 0 && key !== 'no-key-required';
  if (hasKey) {
    headers['Authorization'] = `Bearer ${key}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, options.timeoutMs ?? VERIFY_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { headers, signal: controller.signal });
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        reason: 'unauthorized',
        status: res.status,
        detail:
          res.status === 401
            ? hasKey
              ? 'The endpoint rejected the API key (401).'
              : 'The endpoint requires an API key (401).'
            : 'The endpoint refused the API key (403). Scoped keys may still work for chat.',
      };
    }
    if (res.status === 404) {
      // No models API on this wire — reachable, but the model id is unverified.
      return { ok: true, modelListed: false };
    }
    if (!res.ok) {
      return {
        ok: false,
        reason: 'unreachable',
        status: res.status,
        detail: `The endpoint answered HTTP ${String(res.status)}.`,
      };
    }
    let payload: unknown;
    try {
      payload = await res.json();
    } catch {
      return { ok: true, modelListed: false };
    }
    const hint = extractHintFromModelsResponse(payload, modelId);
    const availableModels = listModelsResponseEntries(payload, 8);
    return {
      ok: true,
      modelListed: hint !== undefined,
      ...(hint === undefined ? {} : { hint }),
      ...(availableModels.length === 0 ? {} : { availableModels }),
    };
  } catch (error) {
    return {
      ok: false,
      reason: 'unreachable',
      detail:
        error instanceof Error && error.name === 'AbortError'
          ? 'The endpoint did not answer in time.'
          : error instanceof Error
            ? error.message
            : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** First `limit` models from an OpenAI-style `/models` payload, with hints. */
function listModelsResponseEntries(payload: unknown, limit: number): ListedEndpointModel[] {
  if (typeof payload !== 'object' || payload === null) return [];
  const data = Array.isArray(payload)
    ? payload
    : 'data' in payload && Array.isArray((payload as Record<string, unknown>)['data'])
      ? ((payload as Record<string, unknown>)['data'] as unknown[])
      : undefined;
  if (data === undefined) return [];
  const entries: ListedEndpointModel[] = [];
  for (const item of data) {
    if (entries.length >= limit) break;
    if (typeof item !== 'object' || item === null) continue;
    const record = item as Record<string, unknown>;
    const id = typeof record['id'] === 'string' ? record['id'].trim() : '';
    if (id.length === 0 || entries.some((entry) => entry.id === id)) continue;
    entries.push(hintFromModelsItem(record, id));
  }
  return entries;
}

/** Capability hint for one `/models` entry record. Shared by the typed-id lookup and the picker list. */
function hintFromModelsItem(
  record: Record<string, unknown>,
  id: string,
): ListedEndpointModel {
  const thinking =
    typeof record['reasoning'] === 'boolean'
      ? record['reasoning']
      : /(?:^|[-/])(?:o\d|reasoning|think)/i.test(id);
  const thinkingMeta = catalogThinkingMetadata({
    id,
    reasoning: thinking,
    reasoning_options: Array.isArray(record['reasoning_options'])
      ? (record['reasoning_options'] as CatalogModelEntry['reasoning_options'])
      : undefined,
  });
  const listedEfforts = Array.isArray(record['support_efforts'])
    ? record['support_efforts'].filter((value): value is string => typeof value === 'string')
    : undefined;
  return {
    id,
    thinking,
    ...(thinkingMeta.supportEfforts !== undefined && thinkingMeta.supportEfforts.length > 0
      ? { supportEfforts: thinkingMeta.supportEfforts }
      : listedEfforts !== undefined && listedEfforts.length > 0
        ? { supportEfforts: listedEfforts }
        : {}),
  };
}

/**
 * Probes an OpenAI-compatible `/models` endpoint to discover whether a model
 * supports reasoning. Returns `undefined` on any failure (network, timeout,
 * unexpected shape) — callers treat this as a hint, not a guarantee.
 */
export async function probeModelsEndpoint(
  baseUrl: string,
  apiKey: string | undefined,
  modelId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ModelCapabilityHint | undefined> {
  const url = `${baseUrl.replace(/\/+$/, '')}/models`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (apiKey !== undefined && apiKey.length > 0 && apiKey !== 'no-key-required') {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() =>{  controller.abort(); }, PROBE_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { headers, signal: controller.signal });
    if (!res.ok) return undefined;
    const payload: unknown = await res.json();
    return extractHintFromModelsResponse(payload, modelId);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extracts capability hints from an OpenAI-style `/models` response.
 * Handles both `{ data: [...] }` and bare array shapes.
 */
export function extractHintFromModelsResponse(
  payload: unknown,
  modelId: string,
): ModelCapabilityHint | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;

  let data: unknown[] | undefined;
  if (Array.isArray(payload)) {
    data = payload;
  } else if ('data' in payload && Array.isArray((payload as Record<string, unknown>)['data'])) {
    data = (payload as Record<string, unknown>)['data'] as unknown[];
  }
  if (data === undefined) return undefined;

  const lowerModelId = modelId.toLowerCase();
  for (const item of data) {
    if (typeof item !== 'object' || item === null) continue;
    const record = item as Record<string, unknown>;
    const id = typeof record['id'] === 'string' ? record['id'] : undefined;
    if (id === undefined || id.toLowerCase() !== lowerModelId) continue;

    const entry = hintFromModelsItem(record, id);
    return {
      thinking: entry.thinking,
      toolUse: true,
      ...(entry.supportEfforts !== undefined ? { supportEfforts: entry.supportEfforts } : {}),
    };
  }
  return undefined;
}
