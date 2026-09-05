/**
 * Curated catalog providers that are not (yet) in models.dev.
 */
import type { Catalog, CatalogProviderEntry } from '@superliora/sdk';
export const CLINEPASS_API_BASE = 'https://api.cline.bot/api/v1';
export const CLINEPASS_PROVIDER_ID = 'cline-pass';
export const CLINEPASS_API_KEY_ENV = 'CLINE_API_KEY';
type LocalCatalogModel = NonNullable<CatalogProviderEntry['models']>[string];
const CLINEPASS_MODELS: Readonly<Record<string, LocalCatalogModel>> = {};
export const CLINEPASS_CATALOG_ENTRY: CatalogProviderEntry = {
  id: CLINEPASS_PROVIDER_ID, name: 'ClinePass', api: CLINEPASS_API_BASE, env: [CLINEPASS_API_KEY_ENV],
  type: 'openai', npm: '@ai-sdk/openai-compatible', doc: 'https://docs.cline.bot/getting-started/clinepass', models: CLINEPASS_MODELS,
};
export const ZAI_CODING_PLAN_API_BASE = 'https://api.z.ai/api/coding/paas/v4';
export const ZAI_CODING_PLAN_PROVIDER_ID = 'zai-coding-plan';
export const ZAI_API_KEY_ENVS = ['Z_AI_API_KEY', 'ZAI_API_KEY'] as const;
const ZAI_CODING_PLAN_MODELS: Readonly<Record<string, LocalCatalogModel>> = {};
export const ZAI_CODING_PLAN_CATALOG_ENTRY: CatalogProviderEntry = {
  id: ZAI_CODING_PLAN_PROVIDER_ID, name: 'Z.AI (GLM Coding Plan)', api: ZAI_CODING_PLAN_API_BASE, env: [...ZAI_API_KEY_ENVS],
  type: 'openai', npm: '@ai-sdk/openai-compatible', doc: 'https://docs.z.ai/devpack/overview', models: ZAI_CODING_PLAN_MODELS,
};
export const OPENCODE_ZEN_API_BASE = 'https://opencode.ai/zen/v1';
export const OPENCODE_ZEN_PROVIDER_ID = 'opencode';
export const OPENCODE_GO_API_BASE = 'https://opencode.ai/zen/go/v1';
export const OPENCODE_GO_PROVIDER_ID = 'opencode-go';
export const OPENCODE_API_KEY_ENVS = ['OPENCODE_API_KEY', 'OPENCODE_ZEN_API_KEY'] as const;
export const OPENCODE_GO_API_KEY_ENVS = ['OPENCODE_GO_API_KEY', ...OPENCODE_API_KEY_ENVS] as const;
const OPENCODE_ZEN_MODELS: Readonly<Record<string, LocalCatalogModel>> = {};
const OPENCODE_GO_MODELS: Readonly<Record<string, LocalCatalogModel>> = {};
export const OPENCODE_ZEN_CATALOG_ENTRY: CatalogProviderEntry = {
  id: OPENCODE_ZEN_PROVIDER_ID, name: 'OpenCode Zen', api: OPENCODE_ZEN_API_BASE, env: [...OPENCODE_API_KEY_ENVS],
  type: 'openai', npm: '@ai-sdk/openai-compatible', doc: 'https://opencode.ai/docs/zen', models: OPENCODE_ZEN_MODELS,
};
export const OPENCODE_GO_CATALOG_ENTRY: CatalogProviderEntry = {
  id: OPENCODE_GO_PROVIDER_ID, name: 'OpenCode Go', api: OPENCODE_GO_API_BASE, env: [...OPENCODE_GO_API_KEY_ENVS],
  type: 'openai', npm: '@ai-sdk/openai-compatible', doc: 'https://opencode.ai/docs/go', models: OPENCODE_GO_MODELS,
};
export const COMMANDCODE_API_BASE = 'https://api.commandcode.ai/provider/v1';
export const COMMANDCODE_PROVIDER_ID = 'commandcode';
export const COMMANDCODE_MODELS_URL = 'https://api.commandcode.ai/provider/v1/models';
export const COMMANDCODE_API_KEY_ENVS = ['CMD_API_KEY', 'COMMANDCODE_API_KEY'] as const;
export const COMMANDCODE_DOC_URL = 'https://commandcode.ai/settings/keys';
/** Claude rows on the Provider API must POST /messages, not /chat/completions. */
const COMMANDCODE_ANTHROPIC_NPM = '@ai-sdk/anthropic';
// Offline fallback snapshot of the public /provider/v1/models listing (67
// models, 2026-09). The live fetch is the source of truth at connect time;
// these rows keep /login, /model, and `provider catalog` usable offline and
// fill in capabilities (reasoning toggle, vision, pricing) live metadata omits.
const COMMANDCODE_MODELS: Readonly<Record<string, LocalCatalogModel>> = {
  'claude-sonnet-5': model('claude-sonnet-5', 'Claude Sonnet 5', 1_000_000, 0, true, { imageIn: true, toggleThinking: true, npm: COMMANDCODE_ANTHROPIC_NPM }),
  'claude-sonnet-4-6': model('claude-sonnet-4-6', 'Claude Sonnet 4.6', 1_000_000, 0, true, { imageIn: true, toggleThinking: true, npm: COMMANDCODE_ANTHROPIC_NPM }),
  'claude-fable-5-1': model('claude-fable-5-1', 'Claude Fable 5.1', 1_000_000, 0, true, { imageIn: true, toggleThinking: true, npm: COMMANDCODE_ANTHROPIC_NPM }),
  'claude-fable-5': model('claude-fable-5', 'Claude Fable 5', 1_000_000, 0, true, { imageIn: true, toggleThinking: true, npm: COMMANDCODE_ANTHROPIC_NPM }),
  'claude-opus-5': model('claude-opus-5', 'Claude Opus 5', 1_000_000, 0, true, { imageIn: true, toggleThinking: true, npm: COMMANDCODE_ANTHROPIC_NPM }),
  'claude-opus-4-8': model('claude-opus-4-8', 'Claude Opus 4.8', 1_000_000, 0, true, { imageIn: true, toggleThinking: true, npm: COMMANDCODE_ANTHROPIC_NPM }),
  'claude-opus-4-7': model('claude-opus-4-7', 'Claude Opus 4.7', 1_000_000, 0, true, { imageIn: true, toggleThinking: true, npm: COMMANDCODE_ANTHROPIC_NPM }),
  'claude-haiku-4-5-20251001': model('claude-haiku-4-5-20251001', 'Claude Haiku 4.5', 200_000, 0, true, { imageIn: true, toggleThinking: true, npm: COMMANDCODE_ANTHROPIC_NPM }),
  'gpt-5.6-sol': model('gpt-5.6-sol', 'GPT-5.6 Sol', 1_050_000, 0, true, { imageIn: true, toggleThinking: true, cost: { input: 5, output: 30, cache_read: 0.5 } }),
  'gpt-5.6-terra': model('gpt-5.6-terra', 'GPT-5.6 Terra', 1_050_000, 0, true, { imageIn: true, toggleThinking: true }),
  'gpt-5.6-luna': model('gpt-5.6-luna', 'GPT-5.6 Luna', 1_050_000, 0, true, { imageIn: true, toggleThinking: true, cost: { input: 0.2, output: 1.2, cache_read: 0.02 } }),
  'gpt-5.5': model('gpt-5.5', 'GPT-5.5', 400_000, 0, true, { toggleThinking: true }),
  'gpt-5.4': model('gpt-5.4', 'GPT-5.4', 400_000, 0, true, { toggleThinking: true }),
  'gpt-5.3-codex': model('gpt-5.3-codex', 'GPT-5.3 Codex', 400_000, 0, true, { toggleThinking: true }),
  'gpt-5.4-mini': model('gpt-5.4-mini', 'GPT-5.4 Mini', 400_000, 0, true, { toggleThinking: true }),
  'deepseek/deepseek-v4-pro': model('deepseek/deepseek-v4-pro', 'DeepSeek V4 Pro (latest)', 1_000_000, 0, true, { toggleThinking: true, cost: { input: 0.66, output: 1.98, cache_read: 0.022 } }),
  'deepseek/deepseek-v4-flash': model('deepseek/deepseek-v4-flash', 'DeepSeek V4 Flash (latest)', 1_000_000, 0, true, { toggleThinking: true, cost: { input: 0.22, output: 0.66, cache_read: 0.007 } }),
  'deepseek/deepseek-v4-flash-vision-exp': model('deepseek/deepseek-v4-flash-vision-exp', 'DeepSeek V4 Flash Vision (exp)', 1_000_000, 0, true, { imageIn: true, toggleThinking: true, cost: { input: 0.22, output: 0.66, cache_read: 0.007 } }),
  'deepseek/deepseek-v4-flash-fast': model('deepseek/deepseek-v4-flash-fast', 'DeepSeek V4 Flash Fast', 1_000_000, 0, false, { cost: { input: 0.28, output: 0.56, cache_read: 0.07 } }),
  'moonshotai/Kimi-K3': model('moonshotai/Kimi-K3', 'Kimi K3', 1_000_000, 0, true, { imageIn: true, toggleThinking: true, cost: { input: 3, output: 15, cache_read: 0.3 } }),
  'moonshotai/Kimi-K2.7-Code': model('moonshotai/Kimi-K2.7-Code', 'Kimi K2.7 Code', 256_000, 0, true, { toggleThinking: true, cost: { input: 0.95, output: 4, cache_read: 0.19 } }),
  'moonshotai/Kimi-K2.7-Code-Highspeed': model('moonshotai/Kimi-K2.7-Code-Highspeed', 'Kimi K2.7 Code HighSpeed', 262_000, 0, false, { cost: { input: 1.9, output: 8, cache_read: 0.38 } }),
  'moonshotai/Kimi-K2.6': model('moonshotai/Kimi-K2.6', 'Kimi K2.6', 256_000, 0, true, { toggleThinking: true, cost: { input: 0.95, output: 4, cache_read: 0.16 } }),
  'moonshotai/Kimi-K2.5': model('moonshotai/Kimi-K2.5', 'Kimi K2.5', 256_000, 0, true, { toggleThinking: true, cost: { input: 0.6, output: 3, cache_read: 0.1 } }),
  'z-ai/glm-5.3-flash': model('z-ai/glm-5.3-flash', 'GLM-5.3 Flash', 1_048_576, 0, false, { cost: { input: 0.15, output: 0.5, cache_read: 0.03 } }),
  'zai-org/GLM-5.3': model('zai-org/GLM-5.3', 'GLM-5.3', 1_000_000, 0, true, { toggleThinking: true, cost: { input: 1.4, output: 4.4, cache_read: 0.26 } }),
  'zai-org/GLM-5.2': model('zai-org/GLM-5.2', 'GLM-5.2', 1_000_000, 0, true, { toggleThinking: true, cost: { input: 1.4, output: 4.4, cache_read: 0.26 } }),
  'zai-org/GLM-5.2-Fast': model('zai-org/GLM-5.2-Fast', 'GLM-5.2 Fast', 1_000_000, 0, false, { cost: { input: 3, output: 10.25, cache_read: 0.5 } }),
  'zai-org/GLM-5.1': model('zai-org/GLM-5.1', 'GLM-5.1', 200_000, 0, true, { toggleThinking: true, cost: { input: 1.4, output: 4.4, cache_read: 0.26 } }),
  'zai-org/GLM-5': model('zai-org/GLM-5', 'GLM-5', 200_000, 0, true, { toggleThinking: true, cost: { input: 1, output: 3.2, cache_read: 0.2 } }),
  'MiniMaxAI/MiniMax-M3': model('MiniMaxAI/MiniMax-M3', 'MiniMax M3', 1_000_000, 0, true, { imageIn: true, toggleThinking: true, cost: { input: 0.3, output: 1.2, cache_read: 0.06 } }),
  'MiniMaxAI/MiniMax-M2.7': model('MiniMaxAI/MiniMax-M2.7', 'MiniMax M2.7', 200_000, 0, true, { toggleThinking: true, cost: { input: 0.3, output: 1.2, cache_read: 0.06 } }),
  'MiniMaxAI/MiniMax-M2.5': model('MiniMaxAI/MiniMax-M2.5', 'MiniMax M2.5', 200_000, 0, true, { toggleThinking: true, cost: { input: 0.3, output: 1.2, cache_read: 0.03 } }),
  'xiaomi/mimo-v2.5-pro': model('xiaomi/mimo-v2.5-pro', 'MiMo V2.5 Pro', 1_000_000, 0, true, { toggleThinking: true, cost: { input: 0.435, output: 0.87, cache_read: 0.0036 } }),
  'xiaomi/mimo-v2.5': model('xiaomi/mimo-v2.5', 'MiMo V2.5', 1_000_000, 0, true, { toggleThinking: true, cost: { input: 0.14, output: 0.28, cache_read: 0.0028 } }),
  'Qwen/Qwen3.8-Max-0902': model('Qwen/Qwen3.8-Max-0902', 'Qwen 3.8 Max 0902', 1_000_000, 0, true, { imageIn: true, toggleThinking: true, cost: { input: 2, output: 6, cache_read: 0.25 } }),
  'Qwen/Qwen3.8-Max': model('Qwen/Qwen3.8-Max', 'Qwen 3.8 Max', 1_000_000, 0, true, { imageIn: true, toggleThinking: true, cost: { input: 2, output: 6, cache_read: 0.25 } }),
  'Qwen/Qwen3.8-27B': model('Qwen/Qwen3.8-27B', 'Qwen 3.8 27B', 262_144, 0, true, { imageIn: true, toggleThinking: true, cost: { input: 0.4, output: 3, cache_read: 0.04 } }),
  'Qwen/Qwen3.8-Flash': model('Qwen/Qwen3.8-Flash', 'Qwen 3.8 Flash', 1_000_000, 0, false, { imageIn: true, cost: { input: 0.16, output: 0.47, cache_read: 0.016 } }),
  'Qwen/Qwen3.7-Max': model('Qwen/Qwen3.7-Max', 'Qwen 3.7 Max', 1_000_000, 0, true, { toggleThinking: true, cost: { input: 2.5, output: 7.5, cache_read: 0.5 } }),
  'Qwen/Qwen3.7-Plus': model('Qwen/Qwen3.7-Plus', 'Qwen 3.7 Plus', 1_000_000, 0, true, { imageIn: true, toggleThinking: true, cost: { input: 0.4, output: 1.6, cache_read: 0.08 } }),
  'Qwen/Qwen3.7-Flash': model('Qwen/Qwen3.7-Flash', 'Qwen 3.7 Flash', 1_000_000, 0, false, { imageIn: true, cost: { input: 0.03, output: 0.13, cache_read: 0.006 } }),
  'Qwen/Qwen3.6-Max-Preview': model('Qwen/Qwen3.6-Max-Preview', 'Qwen 3.6 Max Preview', 200_000, 0, true, { toggleThinking: true, cost: { input: 1.3, output: 7.8, cache_read: 0.26 } }),
  'Qwen/Qwen3.6-Plus': model('Qwen/Qwen3.6-Plus', 'Qwen 3.6 Plus', 200_000, 0, false, { imageIn: true, cost: { input: 0.5, output: 3, cache_read: 0.1 } }),
  'meituan/LongCat-2.0:free': model('meituan/LongCat-2.0:free', 'LongCat 2.0', 1_048_576, 0, false, { free: true }),
  'stepfun/Step-3.7-Flash': model('stepfun/Step-3.7-Flash', 'Step 3.7 Flash', 256_000, 0, false, { imageIn: true, cost: { input: 0.2, output: 1.15, cache_read: 0.04 } }),
  'stepfun/Step-3.5-Flash': model('stepfun/Step-3.5-Flash', 'Step 3.5 Flash', 1_000_000, 0, false, { cost: { input: 0.1, output: 0.3, cache_read: 0.02 } }),
  'tencent/hy3-paid': model('tencent/hy3-paid', 'Tencent Hy3', 262_144, 0, false, { cost: { input: 0.14, output: 0.58, cache_read: 0.035 } }),
  'tencent/hy4-preview': model('tencent/hy4-preview', 'Tencent Hy4 Preview', 1_048_576, 0, false, { cost: { input: 0.834, output: 2.501, cache_read: 0.042 } }),
  'google/gemini-3.8-flash': model('google/gemini-3.8-flash', 'Gemini 3.8 Flash', 1_000_000, 0, true, { imageIn: true, toggleThinking: true, cost: { input: 1.5, output: 7.5, cache_read: 0.15 } }),
  'google/gemini-3.7-flash': model('google/gemini-3.7-flash', 'Gemini 3.7 Flash', 1_048_576, 0, true, { imageIn: true, toggleThinking: true, cost: { input: 1.5, output: 7.5, cache_read: 0.15 } }),
  'google/gemini-3.6-flash': model('google/gemini-3.6-flash', 'Gemini 3.6 Flash', 1_000_000, 0, true, { imageIn: true, toggleThinking: true }),
  'google/gemini-3.5-flash': model('google/gemini-3.5-flash', 'Gemini 3.5 Flash', 1_000_000, 0, true, { imageIn: true, toggleThinking: true }),
  'google/gemini-3.5-flash-lite': model('google/gemini-3.5-flash-lite', 'Gemini 3.5 Flash Lite', 1_000_000, 0, false, { imageIn: true }),
  'google/gemini-3.1-flash-lite': model('google/gemini-3.1-flash-lite', 'Gemini 3.1 Flash Lite', 1_000_000, 0, false, { imageIn: true }),
  'sakana/fugu-ultra': model('sakana/fugu-ultra', 'Fugu Ultra', 1_000_000, 0, false),
  'nvidia/nemotron-3-ultra-550b-a55b': model('nvidia/nemotron-3-ultra-550b-a55b', 'Nemotron 3 Ultra', 1_000_000, 0, true, { toggleThinking: true, cost: { input: 0.6, output: 2.4, cache_read: 0.12 } }),
  'thinkingmachines/inkling': model('thinkingmachines/inkling', 'Inkling', 256_000, 0, false, { imageIn: true, cost: { input: 1, output: 4.05, cache_read: 0.17 } }),
  'thinkingmachines/inkling-small': model('thinkingmachines/inkling-small', 'Inkling Small', 1_000_000, 0, false, { imageIn: true, cost: { input: 0.5, output: 1.2, cache_read: 0.1 } }),
  'poolside/laguna-s-2.1-free': model('poolside/laguna-s-2.1-free', 'Laguna S 2.1', 256_000, 0, false, { free: true }),
  'meta/muse-spark-1.1': model('meta/muse-spark-1.1', 'Muse Spark 1.1', 1_048_576, 0, false),
  'meta/muse-spark-1.2': model('meta/muse-spark-1.2', 'Muse Spark 1.2', 1_048_576, 0, false, { imageIn: true, cost: { input: 1.25, output: 4.25, cache_read: 0.15 } }),
  'meta/muse-spark-1.2-contributor': model('meta/muse-spark-1.2-contributor', 'Muse Spark 1.2 Contributor', 1_048_576, 0, false, { imageIn: true, cost: { input: 0.1, output: 0.2, cache_read: 0.002 } }),
  'meta/muse-spark-1.3': model('meta/muse-spark-1.3', 'Muse Spark 1.3', 1_048_576, 0, false, { imageIn: true, cost: { input: 1.25, output: 4.25, cache_read: 0.15 } }),
  'meta/muse-spark-1.3-contributor': model('meta/muse-spark-1.3-contributor', 'Muse Spark 1.3 Contributor', 1_048_576, 0, false, { imageIn: true, cost: { input: 0.1, output: 0.2, cache_read: 0.002 } }),
  'xai/grok-4.5': model('xai/grok-4.5', 'Grok 4.5', 500_000, 0, true, { imageIn: true, toggleThinking: true, cost: { input: 2, output: 6, cache_read: 0.5 } }),
  'xai/grok-4.6': model('xai/grok-4.6', 'Grok 4.6', 500_000, 0, true, { imageIn: true, toggleThinking: true, cost: { input: 2, output: 6, cache_read: 0.5 } }),
};
export const COMMANDCODE_CATALOG_ENTRY: CatalogProviderEntry = {
  id: COMMANDCODE_PROVIDER_ID, name: 'Command Code', api: COMMANDCODE_API_BASE, env: [...COMMANDCODE_API_KEY_ENVS],
  type: 'openai', npm: '@ai-sdk/openai-compatible', doc: COMMANDCODE_DOC_URL, models: COMMANDCODE_MODELS,
};
export const LOCAL_CATALOG_PROVIDERS: Readonly<Record<string, CatalogProviderEntry>> = {
  [OPENCODE_ZEN_PROVIDER_ID]: OPENCODE_ZEN_CATALOG_ENTRY,
  [OPENCODE_GO_PROVIDER_ID]: OPENCODE_GO_CATALOG_ENTRY,
  [CLINEPASS_PROVIDER_ID]: CLINEPASS_CATALOG_ENTRY,
  [ZAI_CODING_PLAN_PROVIDER_ID]: ZAI_CODING_PLAN_CATALOG_ENTRY,
  [COMMANDCODE_PROVIDER_ID]: COMMANDCODE_CATALOG_ENTRY,
};
export const CONNECT_ENV_HINTS: ReadonlyArray<{ readonly env: string; readonly label: string }> = [
  { env: 'OPENCODE_API_KEY', label: 'OpenCode Zen' },
  { env: 'OPENCODE_ZEN_API_KEY', label: 'OpenCode Zen' },
  { env: 'OPENCODE_GO_API_KEY', label: 'OpenCode Go' },
  { env: CLINEPASS_API_KEY_ENV, label: 'ClinePass' },
  { env: 'Z_AI_API_KEY', label: 'Z.AI' },
  { env: 'ZAI_API_KEY', label: 'Z.AI' },
  { env: 'OPENROUTER_API_KEY', label: 'OpenRouter' },
  { env: 'CMD_API_KEY', label: 'Command Code' },
  { env: 'COMMANDCODE_API_KEY', label: 'Command Code' },
];
export interface DetectedConnectEnvHint { readonly env: string; readonly label: string; }
export function detectedConnectEnvHints(env: NodeJS.Dict<string> = process.env): readonly DetectedConnectEnvHint[] {
  const seen = new Set<string>(); const out: DetectedConnectEnvHint[] = [];
  for (const row of CONNECT_ENV_HINTS) { const value = env[row.env]?.trim(); if (value === undefined || value.length === 0) continue; if (seen.has(row.label)) continue; seen.add(row.label); out.push(row); }
  return out;
}
export function mergeLocalCatalogProviders(catalog: Catalog): Catalog {
  const merged: Catalog = { ...catalog };
  for (const [id, local] of Object.entries(LOCAL_CATALOG_PROVIDERS)) {
    const remote = catalog[id]; if (remote === undefined) { merged[id] = local; } else { merged[id] = { ...remote, ...local, models: { ...remote.models, ...local.models } }; }
  }
  return merged;
}
/**
 * The offline Command Code snapshot is the metadata donor; the live listing is
 * authoritative for which ids exist. Returns `undefined` when the network (or
 * the payload shape) disappoints so callers keep the curated rows.
 */
export async function fetchCommandCodeModels(
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<Readonly<Record<string, LocalCatalogModel>> | undefined> {
  try {
    const res = await fetchImpl(COMMANDCODE_MODELS_URL, {
      headers: { Accept: 'application/json' },
      signal,
    });
    if (!res.ok) return undefined;
    const json = (await res.json()) as {
      data?: readonly { id?: string; name?: string; context_length?: number }[];
    };
    if (!Array.isArray(json.data) || json.data.length === 0) return undefined;
    const models: Record<string, LocalCatalogModel> = {};
    for (const row of json.data) {
      if (typeof row.id !== 'string' || row.id.length === 0) continue;
      const curated = COMMANDCODE_MODELS[row.id];
      const context =
        typeof row.context_length === 'number' &&
        Number.isInteger(row.context_length) &&
        row.context_length > 0
          ? row.context_length
          : curated?.limit?.context;
      if (context === undefined) continue;
      models[row.id] = {
        ...curated,
        id: row.id,
        ...(typeof row.name === 'string' && row.name.length > 0 ? { name: row.name } : {}),
        limit: { context },
      };
    }
    return Object.keys(models).length > 0 ? models : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Catalog entry the connect flows import from. Command Code's row is
 * refreshed from its public models listing when reachable (live ids win,
 * curated capabilities fill the gaps); every other provider passes through.
 * Returns `undefined` when `catalog` has no such entry and no curated shell.
 */
export async function resolveConnectCatalogEntry(
  catalog: Catalog,
  providerId: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<CatalogProviderEntry | undefined> {
  const entry = catalog[providerId];
  if (providerId !== COMMANDCODE_PROVIDER_ID) return entry;
  const base = entry ?? COMMANDCODE_CATALOG_ENTRY;
  const live = await fetchCommandCodeModels(signal, fetchImpl);
  if (live === undefined) return base;
  return { ...base, models: { ...live } };
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
    /** Route this model over a different wire (e.g. Anthropic Messages). */
    npm?: string;
    toggleThinking?: boolean;
    cost?: { input: number; output: number; cache_read?: number };
  },
): LocalCatalogModel {
  const efforts = options?.supportEfforts;
  const reasoning_options =
    options?.alwaysThinking === true
      ? [{ type: 'effort' as const, values: [...(efforts ?? ['low', 'high', 'max'])] }]
      : options?.toggleThinking === true
        ? [{ type: 'toggle' as const }]
        : undefined;
  const cost = options?.free === true ? { input: 0, output: 0 } : options?.cost;
  return {
    id,
    name,
    limit: { context, output },
    tool_call: true,
    reasoning,
    interleaved: reasoning ? true : undefined,
    reasoning_options,
    ...(cost !== undefined ? { cost } : {}),
    ...(options?.npm !== undefined ? { provider: { npm: options.npm } } : {}),
    modalities: { input: options?.imageIn === true ? ['text', 'image'] : ['text'], output: ['text'] },
  };
}
