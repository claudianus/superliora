import type { LioraConfig } from '@superliora/sdk';

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
