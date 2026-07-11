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
  'cline-pass/kimi-k2.7-code': model(
    'cline-pass/kimi-k2.7-code',
    'Kimi K2.7 Code',
    262_144,
    131_072,
    true,
  ),
  'cline-pass/kimi-k2.6': model('cline-pass/kimi-k2.6', 'Kimi K2.6', 262_144, 131_072, true),
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
  'cline-pass/minimax-m3': model('cline-pass/minimax-m3', 'MiniMax M3', 1_048_576, 131_072, true),
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
    1_048_576,
    131_072,
    true,
  ),
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

/**
 * SuperLiora-owned catalog entries layered on top of models.dev.
 * Add future curated providers here.
 */
export const LOCAL_CATALOG_PROVIDERS: Readonly<Record<string, CatalogProviderEntry>> = {
  [CLINEPASS_PROVIDER_ID]: CLINEPASS_CATALOG_ENTRY,
};

/**
 * Returns a new catalog with SuperLiora-curated providers merged in.
 * Local entries overwrite same-id models.dev entries so the wire type,
 * base URL, and model list stay under SuperLiora control.
 */
export function mergeLocalCatalogProviders(catalog: Catalog): Catalog {
  return {
    ...catalog,
    ...LOCAL_CATALOG_PROVIDERS,
  };
}

function model(
  id: string,
  name: string,
  context: number,
  output: number,
  reasoning: boolean,
): LocalCatalogModel {
  return {
    id,
    name,
    limit: { context, output },
    tool_call: true,
    reasoning,
    // OpenAI-compatible gateways round-trip thinking via reasoning_content.
    interleaved: reasoning ? true : undefined,
    modalities: { input: ['text'], output: ['text'] },
  };
}
