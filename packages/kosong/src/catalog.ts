import type { ModelCapability } from './capability';
import type { ProviderType } from './providers';
import { resolveWireFromPackage } from './providers/wire-registry';

/**
 * models.dev-style catalog: a public map of provider/model metadata. Callers
 * consume a snapshot of this shape to populate provider + model configuration
 * without hand-writing context windows or capabilities.
 */
export interface CatalogCostTier {
  readonly input?: number;
  readonly output?: number;
  readonly cache_read?: number;
  readonly cache_write?: number;
  readonly tier?: {
    readonly type?: string;
    readonly size?: number;
  };
}

/** models.dev `cost` plus optional context-length tiers. */
export interface CatalogCost {
  readonly input?: number;
  readonly output?: number;
  readonly cache_read?: number;
  readonly cache_write?: number;
  readonly tiers?: readonly CatalogCostTier[];
}

export interface CatalogModelEntry {
  readonly id?: string;
  readonly name?: string;
  readonly family?: string;
  /**
   * Per-model SDK override (models.dev `provider` block on a model row).
   *
   * A gateway that serves several protocols from one API root publishes this
   * so a single model can use a different wire than its provider default —
   * the reason SuperLiora resolves wires per model instead of per model name.
   */
  readonly provider?: { readonly npm?: string };
  readonly limit?: { readonly context?: number; readonly output?: number };
  readonly tool_call?: boolean;
  readonly reasoning?: boolean;
  readonly reasoning_options?: readonly CatalogReasoningOption[];
  readonly interleaved?: boolean | { readonly field?: string };
  readonly modalities?: {
    readonly input?: readonly string[];
    readonly output?: readonly string[];
  };
  /** Per-million-token pricing in USD (models.dev `cost` field). */
  readonly cost?: CatalogCost;
}

export type CatalogReasoningOption =
  | {
      readonly type: 'effort';
      readonly values?: readonly (string | null)[];
    }
  | {
      readonly type: 'toggle';
    }
  | {
      readonly type: 'budget_tokens';
      readonly min?: number;
      readonly max?: number;
    };

export interface CatalogProviderEntry {
  readonly id?: string;
  readonly name?: string;
  /** Base URL for the provider; may be empty (some SDKs hardcode it). */
  readonly api?: string;
  /** Env var names carrying credentials — surfaced as a hint by callers. */
  readonly env?: readonly string[];
  /** models.dev SDK package id; used to infer the wire type when `type` is absent. */
  readonly npm?: string;
  /** Explicit wire type extension; inferred from `npm`/`id` when absent. */
  readonly type?: string;
  /** Documentation / console URL where an API key can be obtained. */
  readonly doc?: string;
  readonly models?: Record<string, CatalogModelEntry>;
}

/** Top-level catalog: `{ [providerId]: ProviderEntry }` (e.g. models.dev/api.json). */
export type Catalog = Record<string, CatalogProviderEntry>;

/** A normalized catalog model: identity plus its {@link ModelCapability}. */
export interface CatalogModel {
  readonly id: string;
  readonly name?: string;
  readonly maxOutputSize?: number;
  readonly reasoningKey?: string;
  /** Normalized discrete effort values declared by models.dev. An empty array
   * means the provider exposes reasoning but no discrete effort control. */
  readonly supportEfforts?: readonly string[];
  /** True when the catalog says reasoning cannot be disabled for this model. */
  readonly alwaysThinking?: boolean;
  readonly capability: ModelCapability;
  /** Per-million-token pricing in USD (models.dev `cost` field). */
  readonly cost?: CatalogCost;
  /**
   * Wire that serves this model: the model's own `provider.npm` override when
   * the catalog publishes one, otherwise the provider entry's wire.
   * `undefined` means nothing in the catalog named a usable protocol.
   */
  readonly wire?: ProviderType;
}

const KNOWN_WIRE_TYPES = [
  'anthropic',
  'openai',
  'kimi',
  'google-genai',
  'openai_responses',
  'vertexai',
  'cursor',
] as const satisfies readonly ProviderType[];

function isWireType(value: unknown): value is ProviderType {
  return typeof value === 'string' && (KNOWN_WIRE_TYPES as readonly string[]).includes(value);
}

function hasEmbeddingMarker(value: string | undefined): boolean {
  if (value === undefined) return false;
  const lower = value.toLowerCase();
  return lower.includes('embedding') || /(?:^|[-_/])embed(?:$|[-_/])/.test(lower);
}

function isUsableChatModel(model: CatalogModelEntry): boolean {
  const outputModalities = model.modalities?.output;
  if (outputModalities !== undefined && !outputModalities.includes('text')) return false;
  return (
    !hasEmbeddingMarker(model.family) &&
    !hasEmbeddingMarker(model.id) &&
    !hasEmbeddingMarker(model.name)
  );
}

/**
 * Resolves a catalog provider entry to a supported wire type. Honors an
 * explicit `type`, otherwise infers from `npm`/`id`. Unknown providers return
 * `undefined` so callers can omit them instead of writing an invalid config.
 */
export function inferWireType(entry: CatalogProviderEntry): ProviderType | undefined {
  if (isWireType(entry.type)) return entry.type;
  // Provider-level inference keeps its historical heuristics on purpose: a
  // provider row saying `@ai-sdk/openai` still means its Chat Completions root
  // here. Only the model-level `provider.npm` override (see
  // {@link resolveModelWire}) may select a different protocol.
  const npm = (entry.npm ?? '').toLowerCase();
  const id = (entry.id ?? '').toLowerCase();
  if (npm.includes('anthropic') || id.includes('anthropic') || id.includes('claude')) {
    return 'anthropic';
  }
  if (id.includes('vertex')) return 'vertexai';
  if (npm.includes('google') || id.includes('google') || id.includes('gemini')) {
    return 'google-genai';
  }
  if (looksLikeOpenAIChatCompletions(npm, id)) return 'openai';
  return undefined;
}

/**
 * Chat Completions hosts whose models.dev `npm` package does not contain the
 * substring `openai`. Without this table, `inferWireType` returns undefined
 * and `/login` hides the row (Groq, Mistral, Together, xAI API keys, …).
 *
 * Native non-Chat-Completions SDKs stay off this list (Cohere, Bedrock, Azure
 * resource-name auth, Cloudflare gateway extras).
 */
const CHAT_COMPLETIONS_NPM = new Set([
  '@ai-sdk/groq',
  '@ai-sdk/mistral',
  '@ai-sdk/togetherai',
  '@ai-sdk/xai',
  '@ai-sdk/cerebras',
  '@ai-sdk/perplexity',
  '@ai-sdk/gateway',
  '@ai-sdk/vercel',
  '@ai-sdk/deepinfra',
  '@openrouter/ai-sdk-provider',
  '@qvac/ai-sdk-provider',
  '@qvac/sdk',
  'venice-ai-sdk-provider',
  '@aihubmix/ai-sdk-provider',
  'merge-gateway-ai-sdk-provider',
]);

const CHAT_COMPLETIONS_IDS = new Set([
  'groq',
  'mistral',
  'togetherai',
  'together',
  'xai',
  'cerebras',
  'perplexity',
  'vercel',
  'v0',
  'venice',
  'aihubmix',
  'merge-gateway',
  'openrouter',
  'deepinfra',
  'qvac',
  'github-copilot',
  'github_copilot',
  'githubcopilot',
]);

/** Official Chat Completions bases used when models.dev omits `api`. */
const CHAT_COMPLETIONS_DEFAULT_API: Readonly<Record<string, string>> = {
  groq: 'https://api.groq.com/openai/v1',
  mistral: 'https://api.mistral.ai/v1',
  togetherai: 'https://api.together.xyz/v1',
  together: 'https://api.together.xyz/v1',
  xai: 'https://api.x.ai/v1',
  cerebras: 'https://api.cerebras.ai/v1',
  perplexity: 'https://api.perplexity.ai',
  vercel: 'https://ai-gateway.vercel.sh/v1',
  v0: 'https://api.v0.dev/v1',
  venice: 'https://api.venice.ai/api/v1',
  aihubmix: 'https://aihubmix.com/v1',
};

function looksLikeOpenAIChatCompletions(npm: string, id: string): boolean {
  if (npm.includes('openai') || id.includes('openai')) return true;
  if (CHAT_COMPLETIONS_NPM.has(npm) || CHAT_COMPLETIONS_IDS.has(id)) return true;
  if (id.includes('github-copilot') || id.includes('github_copilot') || id.includes('githubcopilot')) {
    return true;
  }
  if (npm.includes('@openrouter/') || id.includes('openrouter')) return true;
  if (npm.includes('deepinfra') || id.includes('deepinfra')) return true;
  if (npm.includes('@qvac/') || id.includes('qvac')) return true;
  return false;
}

/**
 * Whether catalog import should turn thinking on. Only the selected (or
 * CLI `--default-model`) alias is considered — mixed catalogs must not
 * flip the global default just because one sibling is always-on.
 */
export function catalogImportThinking(
  models: readonly CatalogModel[],
  selectedModelId?: string,
): boolean {
  if (selectedModelId === undefined || selectedModelId.length === 0) return false;
  return models.some((model) => model.id === selectedModelId && model.alwaysThinking === true);
}

/**
 * Resolves the base URL to store for a catalog provider, adapting the catalog's
 * `api` to the wire's SDK convention.
 *
 * models.dev `api` URLs are written for the SDK named in `npm` (e.g.
 * `@ai-sdk/anthropic`), whose base already includes the `/v1` version segment.
 * We route the `anthropic` wire through the official `@anthropic-ai/sdk`, which
 * appends `/v1/messages` itself — so a catalog `api` ending in `/v1` would POST
 * to `/v1/v1/messages` (404). Strip the trailing `/v1` for anthropic. OpenAI
 * family SDKs append `/chat/completions` to a `/v1` base, so those pass through.
 */
export function catalogBaseUrl(
  entry: CatalogProviderEntry,
  wire: ProviderType,
): string | undefined {
  const api = entry.api;
  const fromCatalog = typeof api === 'string' && api.length > 0 ? api : undefined;
  const resolved =
    fromCatalog ??
    (wire === 'openai' ? defaultChatCompletionsApi(entry.id) : undefined);
  if (resolved === undefined) return undefined;
  if (wire === 'anthropic') return resolved.replace(/\/v1\/?$/, '');
  return resolved;
}

function defaultChatCompletionsApi(providerId: string | undefined): string | undefined {
  if (providerId === undefined) return undefined;
  return CHAT_COMPLETIONS_DEFAULT_API[providerId.toLowerCase()];
}

/**
 * Normalizes one catalog model entry into a {@link CatalogModel}; skips invalid
 * entries. `providerWire` is the fallback for models that carry no
 * `provider.npm` override of their own.
 */
export function catalogModelToCapability(
  model: CatalogModelEntry,
  providerWire?: ProviderType,
): CatalogModel | undefined {
  if (typeof model.id !== 'string' || model.id.length === 0) return undefined;
  const context = model.limit?.context;
  if (typeof context !== 'number' || !Number.isInteger(context) || context <= 0) return undefined;
  if (!isUsableChatModel(model)) return undefined;
  const inputs = model.modalities?.input ?? [];
  const output = model.limit?.output;
  const thinking = catalogThinkingMetadata(model);
  return {
    id: model.id,
    name: typeof model.name === 'string' && model.name.length > 0 ? model.name : undefined,
    maxOutputSize: typeof output === 'number' && output > 0 ? output : undefined,
    reasoningKey: catalogReasoningKey(model.interleaved),
    ...(thinking.supportEfforts !== undefined
      ? { supportEfforts: thinking.supportEfforts }
      : {}),
    ...(thinking.alwaysThinking ? { alwaysThinking: true } : {}),
    cost: model.cost,
    wire: resolveModelWire(model, providerWire),
    capability: {
      image_in: inputs.includes('image'),
      video_in: inputs.includes('video'),
      audio_in: inputs.includes('audio'),
      thinking: Boolean(model.reasoning),
      tool_use: model.tool_call ?? true,
      max_context_tokens: context,
    },
  };
}

const KNOWN_THINKING_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

export function catalogThinkingMetadata(model: CatalogModelEntry): {
  readonly supportEfforts: readonly string[] | undefined;
  readonly alwaysThinking: boolean;
} {
  const options = model.reasoning_options;
  if (!Array.isArray(options)) {
    return { supportEfforts: undefined, alwaysThinking: false };
  }

  const effortValues = options
    .filter((option): option is Extract<CatalogReasoningOption, { readonly type: 'effort' }> => {
      return option?.type === 'effort';
    })
    .flatMap((option) => (Array.isArray(option.values) ? option.values : []));
  const supportEfforts = [...new Set(
    effortValues
      .map((value) => (typeof value === 'string' ? value.trim().toLowerCase() : undefined))
      .filter((value): value is string => value !== undefined && KNOWN_THINKING_EFFORTS.has(value)),
  )];
  const hasOffEffort = effortValues.some(
    (value) => value === null || (typeof value === 'string' && value.trim().toLowerCase() === 'none'),
  );
  const hasToggle = options.some((option) => option?.type === 'toggle');

  return {
    // An explicit effort option with no recognized graded values is different
    // from an omitted option: do not fall back to a guessed provider ladder.
    supportEfforts: options.some((option) => option?.type === 'effort') ? supportEfforts : [],
    // models.dev defines an explicit toggle or an effort value of `none` as
    // the off path. Without either, reasoning is always on for this model.
    alwaysThinking: Boolean(model.reasoning) && !hasToggle && !hasOffEffort,
  };
}

function catalogReasoningKey(interleaved: CatalogModelEntry['interleaved']): string | undefined {
  // models.dev allows `interleaved: true` as "general support" — read it as
  // the default `reasoning_content` field so providers without an explicit
  // field name (e.g. some openai-compatible gateways) still round-trip.
  if (interleaved === true) return 'reasoning_content';
  if (typeof interleaved !== 'object' || interleaved === null) return undefined;
  const field = interleaved.field?.trim();
  return field !== undefined && field.length > 0 ? field : undefined;
}

/** Extracts the valid, normalized models from a catalog provider entry. */
export function catalogProviderModels(entry: CatalogProviderEntry): CatalogModel[] {
  const models = entry.models ?? {};
  const providerWire = inferWireType(entry);
  return Object.values(models)
    .map((model) => catalogModelToCapability(model, providerWire))
    .filter((model): model is CatalogModel => model !== undefined);
}

/**
 * Wire for one catalog model: its own `provider.npm` override wins, then the
 * provider-level wire. Metadata decides the protocol — never the model name.
 */
export function resolveModelWire(
  model: CatalogModelEntry,
  providerWire?: ProviderType,
): ProviderType | undefined {
  return resolveWireFromPackage(model.provider?.npm) ?? providerWire;
}

/** Models of one catalog provider that share a wire, plus the API root for it. */
export interface CatalogWireGroup {
  readonly wire: ProviderType;
  readonly baseUrl?: string;
  readonly models: readonly CatalogModel[];
}

/**
 * Partitions a catalog provider by wire. A gateway such as OpenCode Zen or Go
 * yields one group per protocol it serves (`openai` for Chat Completions,
 * `openai_responses` for the Responses API, `anthropic`, `google-genai`), each
 * with the API root adapted for that wire, so callers can write one provider
 * config per group instead of matching on model names.
 *
 * `options.wire` is the fallback for models whose catalog row names no package
 * and that sit under a provider entry the catalog cannot classify; without it
 * those models are dropped, since a model with no known protocol cannot be
 * called.
 */
export function catalogWireGroups(
  entry: CatalogProviderEntry,
  options?: { readonly wire?: ProviderType },
): CatalogWireGroup[] {
  const fallbackWire = inferWireType(entry) ?? options?.wire;
  const models = catalogProviderModels(entry);
  const groups = new Map<ProviderType, CatalogModel[]>();
  for (const model of models) {
    const wire = model.wire ?? fallbackWire;
    if (wire === undefined) continue;
    const bucket = groups.get(wire);
    if (bucket === undefined) groups.set(wire, [model]);
    else bucket.push(model);
  }
  return [...groups.entries()].map(([wire, groupModels]): CatalogWireGroup => {
    const baseUrl = catalogBaseUrl(entry, wire);
    return { wire, ...(baseUrl === undefined ? {} : { baseUrl }), models: groupModels };
  });
}
