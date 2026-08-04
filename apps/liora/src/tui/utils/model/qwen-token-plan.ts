/**
 * Alibaba Token Plan (Qwen Cloud) — first-class provider integration.
 *
 * The models.dev catalog lists this service as `alibaba-token-plan` (and the
 * China region as `alibaba-token-plan-cn`); it is the exact same service as
 * the historical "Qwen Cloud Token Plan" entry point. All three identities
 * are treated as one service here: connecting through any of them activates
 * text generation, image generation, video generation, and visual
 * understanding. Harness tools (web search, code interpreter, web extractor,
 * image search) run server-side and are invoked automatically by the models
 * that support them — no client setup.
 *
 * Zero-config: when `QWEN_TOKEN_PLAN_API_KEY` or `ALIBABA_TOKEN_PLAN_API_KEY`
 * is set (or the user connects via /provider), everything activates
 * automatically. Model names and metadata resolve live from the models.dev
 * catalog whenever it is reachable; the built-in presets below are the
 * offline fallback.
 */

import type { Catalog, LioraConfig } from '@superliora/sdk';

// ── Constants ──────────────────────────────────────────────────────────

/** Token Plan dedicated API key environment variable (legacy name). */
export const QWEN_TOKEN_PLAN_ENV_KEY = 'QWEN_TOKEN_PLAN_API_KEY';

/** Token Plan API key environment variable listed by models.dev. */
export const ALIBABA_TOKEN_PLAN_ENV_KEY = 'ALIBABA_TOKEN_PLAN_API_KEY';

/** Every env var that may carry a Token Plan dedicated key. */
export const TOKEN_PLAN_ENV_KEYS: readonly string[] = [
  QWEN_TOKEN_PLAN_ENV_KEY,
  ALIBABA_TOKEN_PLAN_ENV_KEY,
];

/** Optional override for the base URL (e.g. regional endpoint). */
export const QWEN_TOKEN_PLAN_BASE_URL_ENV = 'QWEN_TOKEN_PLAN_BASE_URL';

/** Provider id used in config.providers and model alias prefixes. */
export const QWEN_TOKEN_PLAN_PROVIDER_ID = 'qwen-token-plan';

/** models.dev catalog id for the same service (global region). */
export const ALIBABA_TOKEN_PLAN_CATALOG_ID = 'alibaba-token-plan';

/** models.dev catalog id for the same service (China region). */
export const ALIBABA_TOKEN_PLAN_CN_CATALOG_ID = 'alibaba-token-plan-cn';

/** Every catalog id that maps to the Token Plan service. */
export const TOKEN_PLAN_CATALOG_IDS: readonly string[] = [
  ALIBABA_TOKEN_PLAN_CATALOG_ID,
  ALIBABA_TOKEN_PLAN_CN_CATALOG_ID,
];

/**
 * Every provider id that identifies a Token Plan service entry in
 * `config.providers` (the canonical first-class id plus the models.dev
 * catalog ids a user may have connected through).
 */
export const TOKEN_PLAN_PROVIDER_IDS: readonly string[] = [
  QWEN_TOKEN_PLAN_PROVIDER_ID,
  ALIBABA_TOKEN_PLAN_CATALOG_ID,
  ALIBABA_TOKEN_PLAN_CN_CATALOG_ID,
];

/** Returns `true` when `providerId` refers to any Token Plan service entry. */
export function isTokenPlanProviderId(providerId: string): boolean {
  return TOKEN_PLAN_PROVIDER_IDS.includes(providerId);
}

/** Returns `true` when `catalogId` is a models.dev Token Plan entry. */
export function isTokenPlanCatalogId(catalogId: string): boolean {
  return TOKEN_PLAN_CATALOG_IDS.includes(catalogId);
}

/** OpenAI-compatible chat completions base URL (global region). */
export const QWEN_TOKEN_PLAN_BASE_URL =
  'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1';

/** OpenAI-compatible chat completions base URL (China region). */
export const QWEN_TOKEN_PLAN_CN_BASE_URL =
  'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1';

/** Multimodal generation (image) API endpoint. */
export const QWEN_TOKEN_PLAN_IMAGE_API_URL =
  'https://token-plan.ap-southeast-1.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';

/** Video synthesis (async task) API endpoint. */
export const QWEN_TOKEN_PLAN_VIDEO_API_URL =
  'https://token-plan.ap-southeast-1.maas.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis';

/** Task status polling endpoint template. Replace `<task_id>`. */
export const QWEN_TOKEN_PLAN_TASK_URL =
  'https://token-plan.ap-southeast-1.maas.aliyuncs.com/api/v1/tasks';

/** Expected API key prefix for Token Plan dedicated keys. */
export const QWEN_TOKEN_PLAN_KEY_PREFIX = 'sk-sp-';

// ── Model definitions ──────────────────────────────────────────────────

export interface QwenTokenPlanModelDef {
  readonly id: string;
  readonly displayName: string;
  readonly maxContextSize: number;
  readonly maxOutputSize?: number;
  readonly capabilities: readonly string[];
  readonly harnessTools: readonly string[];
}

/**
 * Official harness tool identifiers for Token Plan models. These are
 * server-side built-in tools (Responses API) that qwen3.7/3.8 models
 * invoke automatically — the client never sends tool entries for them.
 */
export const QWEN_HARNESS_TOOLS = {
  webSearch: 'web_search',
  codeInterpreter: 'code_interpreter',
  webExtractor: 'web_extractor',
  reverseImageSearch: 'i2i_search',
  textToImageSearch: 't2i_search',
} as const;

const ALL_HARNESS_TOOLS: readonly string[] = [
  QWEN_HARNESS_TOOLS.webSearch,
  QWEN_HARNESS_TOOLS.codeInterpreter,
  QWEN_HARNESS_TOOLS.webExtractor,
  QWEN_HARNESS_TOOLS.reverseImageSearch,
  QWEN_HARNESS_TOOLS.textToImageSearch,
];

const CORE_HARNESS_TOOLS: readonly string[] = [
  QWEN_HARNESS_TOOLS.webSearch,
  QWEN_HARNESS_TOOLS.codeInterpreter,
  QWEN_HARNESS_TOOLS.webExtractor,
];

/** Text generation models available on Token Plan. */
export const QWEN_TOKEN_PLAN_TEXT_MODELS: readonly QwenTokenPlanModelDef[] = [
  {
    id: 'qwen3.8-max-preview',
    displayName: 'Qwen 3.8 Max Preview',
    maxContextSize: 1_000_000,
    maxOutputSize: 131_072,
    capabilities: ['thinking', 'tool_use', 'image_in'],
    harnessTools: ALL_HARNESS_TOOLS,
  },
  {
    id: 'qwen3.7-max',
    displayName: 'Qwen 3.7 Max',
    maxContextSize: 1_000_000,
    maxOutputSize: 65_536,
    capabilities: ['thinking', 'tool_use'],
    harnessTools: CORE_HARNESS_TOOLS,
  },
  {
    id: 'qwen3.7-plus',
    displayName: 'Qwen 3.7 Plus',
    maxContextSize: 1_000_000,
    maxOutputSize: 64_000,
    capabilities: ['thinking', 'tool_use', 'image_in'],
    harnessTools: ALL_HARNESS_TOOLS,
  },
  {
    id: 'qwen3.6-flash',
    displayName: 'Qwen 3.6 Flash',
    maxContextSize: 1_000_000,
    maxOutputSize: 65_536,
    capabilities: ['thinking', 'tool_use', 'image_in'],
    harnessTools: [],
  },
  {
    id: 'glm-5.2',
    displayName: 'GLM 5.2',
    maxContextSize: 1_000_000,
    maxOutputSize: 131_072,
    capabilities: ['thinking', 'tool_use'],
    harnessTools: [],
  },
  {
    id: 'deepseek-v4-pro',
    displayName: 'DeepSeek V4 Pro',
    maxContextSize: 1_000_000,
    maxOutputSize: 384_000,
    capabilities: ['thinking', 'tool_use'],
    harnessTools: [],
  },
];

/** Image generation models available on Token Plan (Personal plan). */
export const QWEN_TOKEN_PLAN_IMAGE_MODELS = [
  'wan2.7-image',
  'wan2.7-image-pro',
  'qwen-image-2.0',
  'qwen-image-2.0-pro',
] as const;

/** Video generation models available on Token Plan. */
export const QWEN_TOKEN_PLAN_VIDEO_MODELS = {
  textToVideo: 'happyhorse-1.1-t2v',
  imageToVideo: 'happyhorse-1.1-i2v',
  referenceToVideo: 'happyhorse-1.1-r2v',
} as const;

// ── Detection helpers ──────────────────────────────────────────────────

/**
 * Resolves the Token Plan API key from the environment or an existing
 * provider config. Returns `undefined` when no key is available.
 *
 * Checks both dedicated env vars and every Token Plan provider identity
 * (canonical first-class id plus the models.dev catalog ids).
 */
export function detectQwenTokenPlanKey(config?: LioraConfig): string | undefined {
  // 1. Environment variable takes priority.
  for (const envKey of TOKEN_PLAN_ENV_KEYS) {
    const value = process.env[envKey]?.trim();
    if (value !== undefined && value.length > 0) return value;
  }

  // 2. Fall back to an already-configured provider entry.
  for (const providerId of TOKEN_PLAN_PROVIDER_IDS) {
    const provider = config?.providers?.[providerId];
    if (provider?.apiKey !== undefined && provider.apiKey.length > 0) {
      return provider.apiKey;
    }
  }

  return undefined;
}

/**
 * Returns `true` when a Token Plan key is available (env or config),
 * indicating that Qwen media generation tools should be registered.
 */
export function isQwenTokenPlanAvailable(config?: LioraConfig): boolean {
  return detectQwenTokenPlanKey(config) !== undefined;
}

/**
 * Validates that a key looks like a Token Plan dedicated key.
 * Returns a warning message when the format is unexpected, `undefined` when OK.
 */
export function validateQwenTokenPlanKeyFormat(key: string): string | undefined {
  if (!key.startsWith(QWEN_TOKEN_PLAN_KEY_PREFIX)) {
    return `Token Plan API keys start with "${QWEN_TOKEN_PLAN_KEY_PREFIX}". Regular Qwen Cloud keys (sk-) are not interchangeable. Continue anyway?`;
  }
  return undefined;
}

// ── Live model resolution from the models.dev catalog ──────────────────

type TokenPlanCatalogModelEntry = NonNullable<Catalog[string]['models']>[string];

/**
 * Model-family heuristic for server-side harness tool eligibility. Mirrors
 * `qwenHarnessToolsForModel` in `packages/kosong` so catalog-derived models
 * (which are not in the built-in presets) resolve the same tool set.
 */
export function qwenHarnessToolsForModelId(modelId: string): readonly string[] {
  const normalized = modelId.toLowerCase();
  // qwen3.8* and qwen3.7-plus support every harness tool.
  if (normalized.includes('qwen3.8') || normalized.includes('qwen3.7-plus')) {
    return ALL_HARNESS_TOOLS;
  }
  // Other qwen3.7 variants support the core tools only.
  if (normalized.includes('qwen3.7')) {
    return CORE_HARNESS_TOOLS;
  }
  // Non-Qwen models (GLM, DeepSeek, Kimi, …) run without harness tools.
  return [];
}

function isEmbeddingModel(model: TokenPlanCatalogModelEntry): boolean {
  const markers = [model.id, model.name, model.family];
  return markers.some(
    (value) =>
      typeof value === 'string' &&
      (value.toLowerCase().includes('embedding') || /(?:^|[-_/])embed(?:$|[-_/])/.test(value.toLowerCase())),
  );
}

/**
 * Extracts the live text-generation model list for the Token Plan service
 * from a models.dev-style catalog entry. Returns `undefined` when the entry
 * is missing or yields no usable chat model — callers fall back to the
 * built-in {@link QWEN_TOKEN_PLAN_TEXT_MODELS} presets.
 *
 * Image/video-output models are excluded (they back the media tools, not
 * chat aliases); capabilities and harness tools derive from the catalog's
 * `reasoning` / `tool_call` / `modalities` metadata.
 */
export function tokenPlanTextModelsFromCatalog(
  catalog: Catalog,
  catalogId: string = ALIBABA_TOKEN_PLAN_CATALOG_ID,
): readonly QwenTokenPlanModelDef[] | undefined {
  const entry = catalog[catalogId];
  const models = entry?.models;
  if (models === undefined) return undefined;

  const defs: QwenTokenPlanModelDef[] = [];
  for (const model of Object.values(models)) {
    const id = model.id;
    if (typeof id !== 'string' || id.length === 0) continue;
    // Chat aliases carry text output; image/video models are media-only.
    const outputs = model.modalities?.output;
    if (outputs !== undefined && !outputs.includes('text')) continue;
    if (isEmbeddingModel(model)) continue;
    const context = model.limit?.context;
    if (typeof context !== 'number' || !Number.isInteger(context) || context <= 0) continue;

    const capabilities: string[] = [];
    if (model.reasoning === true) capabilities.push('thinking');
    if (model.tool_call !== false) capabilities.push('tool_use');
    if (model.modalities?.input?.includes('image') === true) capabilities.push('image_in');

    const output = model.limit?.output;
    defs.push({
      id,
      displayName: typeof model.name === 'string' && model.name.length > 0 ? model.name : id,
      maxContextSize: context,
      ...(typeof output === 'number' && output > 0 ? { maxOutputSize: output } : {}),
      capabilities,
      harnessTools: qwenHarnessToolsForModelId(id),
    });
  }
  return defs.length > 0 ? defs : undefined;
}

// ── Config application ─────────────────────────────────────────────────

export interface ApplyQwenTokenPlanOptions {
  /**
   * Live model list resolved from the models.dev catalog. Falls back to the
   * built-in {@link QWEN_TOKEN_PLAN_TEXT_MODELS} presets when omitted.
   */
  readonly models?: readonly QwenTokenPlanModelDef[];
  /** Regional base URL (e.g. the China endpoint). Env override still wins. */
  readonly baseUrl?: string;
}

export interface ApplyQwenTokenPlanResult {
  readonly providerId: string;
  readonly defaultModel: string;
  readonly modelCount: number;
  /** Where the applied model metadata came from. */
  readonly modelSource: 'catalog' | 'preset';
}

/** Preferred default models, in priority order. */
const TOKEN_PLAN_DEFAULT_MODEL_PRIORITY: readonly string[] = [
  'qwen3.8-max-preview',
  'qwen3.8-max',
];

/**
 * Writes the Token Plan provider and its text model aliases into `config`,
 * sets the default model, and returns metadata for status display. Model
 * metadata comes from the models.dev catalog when `options.models` is
 * provided, otherwise from the built-in presets.
 */
export function applyQwenTokenPlanProvider(
  config: LioraConfig,
  apiKey: string,
  options: ApplyQwenTokenPlanOptions = {},
): ApplyQwenTokenPlanResult {
  const envBaseUrl = process.env[QWEN_TOKEN_PLAN_BASE_URL_ENV]?.trim();
  const baseUrl =
    envBaseUrl !== undefined && envBaseUrl.length > 0
      ? envBaseUrl
      : options.baseUrl ?? QWEN_TOKEN_PLAN_BASE_URL;
  const textModels = options.models ?? QWEN_TOKEN_PLAN_TEXT_MODELS;

  // Register provider.
  config.providers = {
    ...config.providers,
    [QWEN_TOKEN_PLAN_PROVIDER_ID]: {
      type: 'openai',
      baseUrl,
      apiKey,
      apiKeys: [],
      source: {
        kind: 'qwenTokenPlan',
        baseUrl,
      },
    },
  };

  // Remove stale aliases for this provider.
  const models = config.models ?? {};
  for (const [key, alias] of Object.entries(models)) {
    if (alias.provider === QWEN_TOKEN_PLAN_PROVIDER_ID) delete models[key];
  }

  // Register text model aliases.
  for (const modelDef of textModels) {
    models[`${QWEN_TOKEN_PLAN_PROVIDER_ID}/${modelDef.id}`] = {
      provider: QWEN_TOKEN_PLAN_PROVIDER_ID,
      model: modelDef.id,
      maxContextSize: modelDef.maxContextSize,
      maxOutputSize: modelDef.maxOutputSize,
      capabilities: [...modelDef.capabilities],
      displayName: modelDef.displayName,
    };
  }
  config.models = models;

  // Set default model: preferred flagship when present, else the first model.
  const preferred = TOKEN_PLAN_DEFAULT_MODEL_PRIORITY.find((id) =>
    textModels.some((m) => m.id === id),
  );
  const defaultModelId = preferred ?? textModels[0]!.id;
  const defaultModel = `${QWEN_TOKEN_PLAN_PROVIDER_ID}/${defaultModelId}`;
  config.defaultModel = defaultModel;
  config.defaultThinking = true;

  return {
    providerId: QWEN_TOKEN_PLAN_PROVIDER_ID,
    defaultModel,
    modelCount: textModels.length,
    modelSource: options.models !== undefined ? 'catalog' : 'preset',
  };
}

/**
 * Returns the harness tools supported by a given Token Plan model.
 * Informational only: harness tools run server-side and are invoked
 * automatically — no client-side tool injection is required.
 */
export function getQwenHarnessToolsForModel(modelId: string): readonly string[] {
  return qwenHarnessToolsForModelId(modelId);
}

/**
 * Returns `true` when the given base URL points to a Qwen Token Plan
 * endpoint. Used by the provider adapter to detect harness tool eligibility.
 */
export function isQwenTokenPlanBaseUrl(baseUrl: string | undefined): boolean {
  if (baseUrl === undefined) return false;
  return baseUrl.includes('token-plan') && baseUrl.includes('maas.aliyuncs.com');
}
