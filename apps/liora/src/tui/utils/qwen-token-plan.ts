/**
 * Qwen Cloud Token Plan — first-class provider integration.
 *
 * Zero-config: when `QWEN_TOKEN_PLAN_API_KEY` is set (or the user connects
 * via /provider), text generation, image generation, video generation, and
 * visual understanding all activate automatically. Harness tools (web
 * search, code interpreter, web extractor, image search) run server-side
 * and are invoked automatically by qwen3.7/3.8 models — no client setup.
 */

import type { LioraConfig } from '@superliora/sdk';

// ── Constants ──────────────────────────────────────────────────────────

/** Token Plan dedicated API key environment variable. */
export const QWEN_TOKEN_PLAN_ENV_KEY = 'QWEN_TOKEN_PLAN_API_KEY';

/** Optional override for the base URL (e.g. regional endpoint). */
export const QWEN_TOKEN_PLAN_BASE_URL_ENV = 'QWEN_TOKEN_PLAN_BASE_URL';

/** Provider id used in config.providers and model alias prefixes. */
export const QWEN_TOKEN_PLAN_PROVIDER_ID = 'qwen-token-plan';

/** OpenAI-compatible chat completions base URL. */
export const QWEN_TOKEN_PLAN_BASE_URL =
  'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1';

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
 */
export function detectQwenTokenPlanKey(config?: LioraConfig): string | undefined {
  // 1. Environment variable takes priority.
  const envKey = process.env[QWEN_TOKEN_PLAN_ENV_KEY]?.trim();
  if (envKey !== undefined && envKey.length > 0) return envKey;

  // 2. Fall back to an already-configured provider entry.
  const provider = config?.providers?.[QWEN_TOKEN_PLAN_PROVIDER_ID];
  if (provider?.apiKey !== undefined && provider.apiKey.length > 0) {
    return provider.apiKey;
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

// ── Config application ─────────────────────────────────────────────────

export interface ApplyQwenTokenPlanResult {
  readonly providerId: string;
  readonly defaultModel: string;
  readonly modelCount: number;
}

/**
 * Writes the Qwen Token Plan provider and all text model aliases into
 * `config`, sets the default model to `qwen3.8-max-preview`, and returns
 * metadata for status display.
 */
export function applyQwenTokenPlanProvider(
  config: LioraConfig,
  apiKey: string,
): ApplyQwenTokenPlanResult {
  const baseUrl =
    process.env[QWEN_TOKEN_PLAN_BASE_URL_ENV]?.trim() || QWEN_TOKEN_PLAN_BASE_URL;

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
  for (const modelDef of QWEN_TOKEN_PLAN_TEXT_MODELS) {
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

  // Set default model.
  const defaultModel = `${QWEN_TOKEN_PLAN_PROVIDER_ID}/${QWEN_TOKEN_PLAN_TEXT_MODELS[0]!.id}`;
  config.defaultModel = defaultModel;
  config.defaultThinking = true;

  return {
    providerId: QWEN_TOKEN_PLAN_PROVIDER_ID,
    defaultModel,
    modelCount: QWEN_TOKEN_PLAN_TEXT_MODELS.length,
  };
}

/**
 * Returns the harness tools supported by a given Qwen Token Plan model.
 * Informational only: harness tools run server-side and are invoked
 * automatically — no client-side tool injection is required.
 */
export function getQwenHarnessToolsForModel(modelId: string): readonly string[] {
  const def = QWEN_TOKEN_PLAN_TEXT_MODELS.find((m) => m.id === modelId);
  return def?.harnessTools ?? [];
}

/**
 * Returns `true` when the given base URL points to a Qwen Token Plan
 * endpoint. Used by the provider adapter to detect harness tool eligibility.
 */
export function isQwenTokenPlanBaseUrl(baseUrl: string | undefined): boolean {
  if (baseUrl === undefined) return false;
  return baseUrl.includes('token-plan') && baseUrl.includes('maas.aliyuncs.com');
}
