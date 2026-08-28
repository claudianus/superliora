/**
 * Curated catalog providers that are not (yet) in models.dev.
 *
 * Merged into the public catalog on every load so `/login`,
 * `liora provider catalog *`, and the TUI picker expose them alongside
 * models.dev entries. Local entries always win for their id so SuperLiora
 * can pin the wire type, base URL, and model list.
 */

import type { Catalog, CatalogProviderEntry } from '@superliora/sdk';

/** Cline API base for OpenAI-compatible chat completions. */
export const CLINEPASS_API_BASE = 'https://api.cline.bot/api/v1';

export const CLINEPASS_PROVIDER_ID = 'clinepass';

/** Env var checked for an existing Cline / ClinePass API key. */
export const CLINEPASS_API_KEY_ENV = 'CLINE_API_KEY';

/**
 * Curated ClinePass open-weight coding models.
 *
 * Model IDs use the full ClinePass slug (e.g. `cline-pass/glm-5.2`) expected
 * by `https://api.cline.bot/api/v1/chat/completions`. Context windows and
 * reasoning flags follow the public ClinePass docs.
 *
 * @see https://docs.cline.bot/getting-started/clinepass
 */
type LocalCatalogModel = NonNullable<CatalogProviderEntry['models']>[string];

const CLINEPASS_MODELS: Readonly<Record<string, LocalCatalogModel>> = {
  'cline-pass/glm-5.2': model('cline-pass/glm-5.2', 'GLM-5.2', 200_000, 131_072, true),
  'cline-pass/glm-5.3': model('cline-pass/glm-5.3', 'GLM-5.3', 200_000, 131_072, true),
  'cline-pass/kimi-k2.7-code': model(
    'cline-pass/kimi-k2.7-code',
    'Kimi K2.7 Code',
    262_144,
    131_072,
    true,
  ),
  'cline-pass/kimi-k2.6': model('cline-pass/kimi-k2.6', 'Kimi K2.6', 262_144, 131_072, true),
  'cline-pass/kimi-k3': model('cline-pass/kimi-k3', 'Kimi K3', 262_144, 131_072, true),
  'cline-pass/deepseek-v4-pro': model(
    'cline-pass/deepseek-v4-pro',
    'DeepSeek V4 Pro',
    1_000_000,
    384_000,
    true,
  ),
  'cline-pass/deepseek-v4-flash': model(
    'cline-pass/deepseek-v4-flash',
    'DeepSeek V4 Flash',
    1_000_000,
    384_000,
    true,
  ),
  'cline-pass/mimo-v2.5': model('cline-pass/mimo-v2.5', 'MiMo-V2.5', 262_144, 131_072, true),
  'cline-pass/mimo-v2.5-pro': model(
    'cline-pass/mimo-v2.5-pro',
    'MiMo-V2.5-Pro',
    262_144,
    131_072,
    true,
  ),
  'cline-pass/minimax-m3': model('cline-pass/minimax-m3', 'MiniMax M3', 512_000, 131_072, true),
  'cline-pass/qwen3.7-max': model(
    'cline-pass/qwen3.7-max',
    'Qwen3.7 Max',
    262_144,
    131_072,
    true,
  ),
  'cline-pass/qwen3.7-plus': model(
    'cline-pass/qwen3.7-plus',
    'Qwen3.7 Plus',
    256_000,
    131_072,
    true,
  ),
  'cline-pass/qwen3.8-max': model('cline-pass/qwen3.8-max', 'Qwen3.8 Max', 262_144, 131_072, true),
};

export const CLINEPASS_CATALOG_ENTRY: CatalogProviderEntry = {
  id: CLINEPASS_PROVIDER_ID,
  name: 'ClinePass',
  api: CLINEPASS_API_BASE,
  env: [CLINEPASS_API_KEY_ENV],
  // Explicit wire type: id "clinepass" does not match the openai substring
  // heuristic used by inferWireType for packages like openrouter.
  type: 'openai',
  npm: '@ai-sdk/openai-compatible',
  doc: 'https://docs.cline.bot/getting-started/clinepass',
  models: CLINEPASS_MODELS,
};

/** Z.AI GLM Coding Plan API base (OpenAI-compatible chat). */
export const ZAI_CODING_PLAN_API_BASE = 'https://api.z.ai/api/coding/paas/v4';

export const ZAI_CODING_PLAN_PROVIDER_ID = 'zai-coding-plan';

/** Env vars checked for an existing Z.AI API key. */
export const ZAI_API_KEY_ENVS = ['Z_AI_API_KEY', 'ZAI_API_KEY'] as const;

/**
 * Curated Z.AI GLM Coding Plan models.
 *
 * The coding plan subscription also bundles dedicated MCP extras (web search,
 * web reader, zread, vision) that SuperLiora auto-injects when the key is
 * detected — no extra configuration required.
 *
 * @see https://docs.z.ai/devpack/overview
 */
const ZAI_CODING_PLAN_MODELS: Readonly<Record<string, LocalCatalogModel>> = {
  'glm-5.2': model('glm-5.2', 'GLM-5.2', 200_000, 131_072, true),
  'glm-5.2-highspeed': model('glm-5.2-highspeed', 'GLM-5.2 HighSpeed', 200_000, 131_072, true),
  'glm-5-turbo': model('glm-5-turbo', 'GLM-5 Turbo', 200_000, 131_072, true),
  'glm-4.7': model('glm-4.7', 'GLM-4.7', 200_000, 131_072, true),
  'glm-5.3': model('glm-5.3', 'GLM-5.3', 200_000, 131_072, true),
  'glm-5.3-flash': model('glm-5.3-flash', 'GLM-5.3 Flash', 200_000, 131_072, true),
  'glm-5.3-highspeed': model('glm-5.3-highspeed', 'GLM-5.3 HighSpeed', 200_000, 131_072, true),
};

export const ZAI_CODING_PLAN_CATALOG_ENTRY: CatalogProviderEntry = {
  id: ZAI_CODING_PLAN_PROVIDER_ID,
  name: 'Z.AI (GLM Coding Plan)',
  api: ZAI_CODING_PLAN_API_BASE,
  env: [...ZAI_API_KEY_ENVS],
  // Explicit wire type: id "zai-coding-plan" does not match the openai
  // substring heuristic used by inferWireType.
  type: 'openai',
  npm: '@ai-sdk/openai-compatible',
  doc: 'https://docs.z.ai/devpack/overview',
  models: ZAI_CODING_PLAN_MODELS,
};

/** OpenCode Zen OpenAI-compatible chat base. */
export const OPENCODE_ZEN_API_BASE = 'https://opencode.ai/zen/v1';

export const OPENCODE_ZEN_PROVIDER_ID = 'opencode';

/** Env vars checked for an existing OpenCode Zen API key. */
export const OPENCODE_API_KEY_ENVS = ['OPENCODE_API_KEY', 'OPENCODE_ZEN_API_KEY'] as const;

const ZEN_ALWAYS_THINKING = {
  alwaysThinking: true,
  supportEfforts: ['low', 'high', 'max'],
} as const;

const ZEN_FREE = {
  ...ZEN_ALWAYS_THINKING,
  free: true as const,
} as const;

/**
 * Curated OpenCode Zen models (free + paid representatives).
 *
 * Live `/models` after connect can expand this list. Effort rungs stay
 * `low` / `high` / `max` — Zen rejects OpenAI `xhigh`, and several SKUs
 * cannot disable thinking.
 *
 * @see https://opencode.ai/docs/zen
 */
const OPENCODE_ZEN_MODELS: Readonly<Record<string, LocalCatalogModel>> = {
  // Free tier (pricing table: Free input/output) — keep in sync with https://opencode.ai/docs/zen
  'big-pickle': model('big-pickle', 'Big Pickle', 262_144, 65_536, true, ZEN_FREE),
  'mimo-v2.5-free': model(
    'mimo-v2.5-free',
    'MiMo-V2.5 Free',
    262_144,
    131_072,
    true,
    ZEN_FREE,
  ),
  'hy3-free': model('hy3-free', 'Hy3 Free', 262_144, 65_536, true, ZEN_FREE),
  'nemotron-3-ultra-free': model(
    'nemotron-3-ultra-free',
    'Nemotron 3 Ultra Free',
    262_144,
    65_536,
    true,
    ZEN_FREE,
  ),
  'nemotron-3.5-lightning-free': model(
    'nemotron-3.5-lightning-free',
    'Nemotron 3.5 Lightning Free',
    262_144,
    65_536,
    true,
    ZEN_FREE,
  ),
  'muse-spark-1.2-contributor-free': model(
    'muse-spark-1.2-contributor-free',
    'Muse Spark 1.2 Contributor Free',
    262_144,
    65_536,
    true,
    ZEN_FREE,
  ),
  // Paid representatives (curated subset — live /models expands this after connect)
  'deepseek-v4-flash': model(
    'deepseek-v4-flash',
    'DeepSeek V4 Flash',
    1_000_000,
    384_000,
    true,
    ZEN_ALWAYS_THINKING,
  ),
  'glm-5.2': model('glm-5.2', 'GLM-5.2', 200_000, 131_072, true, ZEN_ALWAYS_THINKING),
  'kimi-k3': model('kimi-k3', 'Kimi K3', 262_144, 131_072, true, ZEN_ALWAYS_THINKING),
};

export const OPENCODE_ZEN_CATALOG_ENTRY: CatalogProviderEntry = {
  id: OPENCODE_ZEN_PROVIDER_ID,
  name: 'OpenCode Zen',
  api: OPENCODE_ZEN_API_BASE,
  env: [...OPENCODE_API_KEY_ENVS],
  type: 'openai',
  npm: '@ai-sdk/openai-compatible',
  doc: 'https://opencode.ai/docs/zen',
  models: OPENCODE_ZEN_MODELS,
};

/**
 * SuperLiora-owned catalog entries layered on top of models.dev.
 * Add future curated providers here.
 */
export const LOCAL_CATALOG_PROVIDERS: Readonly<Record<string, CatalogProviderEntry>> = {
  [OPENCODE_ZEN_PROVIDER_ID]: OPENCODE_ZEN_CATALOG_ENTRY,
  [CLINEPASS_PROVIDER_ID]: CLINEPASS_CATALOG_ENTRY,
  [ZAI_CODING_PLAN_PROVIDER_ID]: ZAI_CODING_PLAN_CATALOG_ENTRY,
};

/**
 * Env vars that mean a catalog provider is available but not yet written
 * to config. Startup may hint `/login`; it must not persist the secret.
 */
export const CONNECT_ENV_HINTS: ReadonlyArray<{ readonly env: string; readonly label: string }> = [
  { env: 'OPENCODE_API_KEY', label: 'OpenCode Zen' },
  { env: 'OPENCODE_ZEN_API_KEY', label: 'OpenCode Zen' },
  { env: CLINEPASS_API_KEY_ENV, label: 'ClinePass' },
  { env: 'Z_AI_API_KEY', label: 'Z.AI' },
  { env: 'ZAI_API_KEY', label: 'Z.AI' },
  { env: 'OPENROUTER_API_KEY', label: 'OpenRouter' },
];

export interface DetectedConnectEnvHint {
  readonly env: string;
  readonly label: string;
}

/** Unique provider labels whose catalog env var is set in `env`. */
export function detectedConnectEnvHints(
  env: NodeJS.Dict<string> = process.env,
): readonly DetectedConnectEnvHint[] {
  const seen = new Set<string>();
  const out: DetectedConnectEnvHint[] = [];
  for (const row of CONNECT_ENV_HINTS) {
    const value = env[row.env]?.trim();
    if (value === undefined || value.length === 0) continue;
    if (seen.has(row.label)) continue;
    seen.add(row.label);
    out.push(row);
  }
  return out;
}

/**
 * Returns a new catalog with SuperLiora-curated providers merged in.
 * For providers already in models.dev (opencode, zai, zai-coding-plan), merge
 * models so the TUI picker shows the full live list plus our curated pins
 * (local wins for same model id, but remote-only models are kept). For
 * providers not yet in models.dev, the local entry is added as-is.
 */
export function mergeLocalCatalogProviders(catalog: Catalog): Catalog {
  const merged: Catalog = { ...catalog };
  for (const [id, local] of Object.entries(LOCAL_CATALOG_PROVIDERS)) {
    const remote = catalog[id];
    if (remote === undefined) {
      merged[id] = local;
    } else {
      merged[id] = {
        ...remote,
        ...local,
        models: {
          ...remote.models,
          ...local.models,
        },
      };
    }
  }
  return merged;
}

function model(
  id: string,
  name: string,
  context: number,
  output: number,
  reasoning: boolean,
  options?: {
    imageIn?: boolean;
    alwaysThinking?: boolean;
    supportEfforts?: readonly string[];
    free?: boolean;
  },
): LocalCatalogModel {
  const efforts = options?.supportEfforts;
  const reasoning_options =
    options?.alwaysThinking === true
      ? [{ type: 'effort' as const, values: [...(efforts ?? ['low', 'high', 'max'])] }]
      : undefined;
  return {
    id,
    name,
    limit: { context, output },
    tool_call: true,
    reasoning,
    // OpenAI-compatible gateways round-trip thinking via reasoning_content.
    interleaved: reasoning ? true : undefined,
    reasoning_options,
    ...(options?.free === true ? { cost: { input: 0, output: 0 } } : {}),
    modalities: {
      input: options?.imageIn === true ? ['text', 'image'] : ['text'],
      output: ['text'],
    },
  };
}
