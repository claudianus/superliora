import type { Catalog, LioraConfig } from '@superliora/sdk';

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
  const maxContextSize = input.maxContextSize ?? DEFAULT_CUSTOM_ENDPOINT_CONTEXT_SIZE;
  if (!Number.isInteger(maxContextSize) || maxContextSize <= 0) {
    throw new Error('Context window must be a positive integer.');
  }
  const maxOutputSize = input.maxOutputSize;
  if (maxOutputSize !== undefined && (!Number.isInteger(maxOutputSize) || maxOutputSize <= 0)) {
    throw new Error('Max output tokens must be a positive integer.');
  }

  const providerType = input.providerType ?? inferred.providerType ?? 'openai';
  const apiKey = nonEmptyString(input.apiKey) ?? 'no-key-required';
  const displayName = nonEmptyString(input.displayName);
  const capabilities = input.thinking === true ? ['tool_use', 'thinking'] : ['tool_use'];

  const provider: ProviderConfig = {
    type: providerType,
    baseUrl,
    apiKey,
    apiKeys: [],
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
  return {
    thinking: model.reasoning === true,
    toolUse: model.tool_call ?? true,
    maxContextTokens: model.limit?.context,
    maxOutputTokens: model.limit?.output,
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
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
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
function extractHintFromModelsResponse(
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

    // OpenAI-style: no explicit reasoning field — infer from model name.
    const thinking =
      typeof record['reasoning'] === 'boolean'
        ? record['reasoning']
        : /(?:^|[-/])(?:o\d|reasoning|think)/i.test(id);
    return {
      thinking,
      toolUse: true,
    };
  }
  return undefined;
}
