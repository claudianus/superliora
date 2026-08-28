/**
 * Curated catalog providers that are not (yet) in models.dev.
 *
 * Previously this file hard-coded 9+ opencode, 7 zai, 13 cline-pass model
 * lists, which drifted from live `https://models.dev/api.json` (now 93
 * opencode, 16 zai, 7 zai-coding-plan, 13 cline-pass) and caused the
 * picker to show stale free tiers. As of 2026-08, all three are on
 * models.dev, so hard-coded model lists are removed — provider entries
 * now only pin wire type / baseUrl and rely on live fetch. Offline
 * fallback is the built-in snapshot + live provider /models and
 * OpenRouter (see catalog-cache.ts), not hard-coded arrays.
 */

import type { Catalog, CatalogProviderEntry } from '@superliora/sdk';

/** Cline API base for OpenAI-compatible chat completions. */
export const CLINEPASS_API_BASE = 'https://api.cline.bot/api/v1';

export const CLINEPASS_PROVIDER_ID = 'cline-pass';

/** Env var checked for an existing Cline / ClinePass API key. */
export const CLINEPASS_API_KEY_ENV = 'CLINE_API_KEY';

type LocalCatalogModel = NonNullable<CatalogProviderEntry['models']>[string];

// opencode (93), zai (16), zai-coding-plan (7) are now on models.dev —
// hard-coded model maps removed so live is single source. cline-pass
// (id `cline-pass` with hyphen) is also on models.dev (13), but keep a
// single curated entry as offline fallback for fresh installs without
// built-in snapshot; live merge will still expose all 13.
const CLINEPASS_MODELS: Readonly<Record<string, LocalCatalogModel>> = {
  'cline-pass/glm-5.2': model('cline-pass/glm-5.2', 'GLM-5.2', 200_000, 131_072, true),
};

export const CLINEPASS_CATALOG_ENTRY: CatalogProviderEntry = {
  id: CLINEPASS_PROVIDER_ID,
  name: 'ClinePass',
  api: CLINEPASS_API_BASE,
  env: [CLINEPASS_API_KEY_ENV],
  // Explicit wire type: id "cline-pass" does not match the openai substring
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
const ZAI_CODING_PLAN_MODELS: Readonly<Record<string, LocalCatalogModel>> = {};

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

const OPENCODE_ZEN_MODELS: Readonly<Record<string, LocalCatalogModel>> = {};

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
