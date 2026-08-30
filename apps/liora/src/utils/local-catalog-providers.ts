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
export const LOCAL_CATALOG_PROVIDERS: Readonly<Record<string, CatalogProviderEntry>> = {
  [OPENCODE_ZEN_PROVIDER_ID]: OPENCODE_ZEN_CATALOG_ENTRY,
  [OPENCODE_GO_PROVIDER_ID]: OPENCODE_GO_CATALOG_ENTRY,
  [CLINEPASS_PROVIDER_ID]: CLINEPASS_CATALOG_ENTRY,
  [ZAI_CODING_PLAN_PROVIDER_ID]: ZAI_CODING_PLAN_CATALOG_ENTRY,
};
export const CONNECT_ENV_HINTS: ReadonlyArray<{ readonly env: string; readonly label: string }> = [
  { env: 'OPENCODE_API_KEY', label: 'OpenCode Zen' },
  { env: 'OPENCODE_ZEN_API_KEY', label: 'OpenCode Zen' },
  { env: 'OPENCODE_GO_API_KEY', label: 'OpenCode Go' },
  { env: CLINEPASS_API_KEY_ENV, label: 'ClinePass' },
  { env: 'Z_AI_API_KEY', label: 'Z.AI' },
  { env: 'ZAI_API_KEY', label: 'Z.AI' },
  { env: 'OPENROUTER_API_KEY', label: 'OpenRouter' },
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
function model(id: string, name: string, context: number, output: number, reasoning: boolean, options?: { imageIn?: boolean; alwaysThinking?: boolean; supportEfforts?: readonly string[]; free?: boolean; }): LocalCatalogModel {
  const efforts = options?.supportEfforts;
  const reasoning_options = options?.alwaysThinking === true ? [{ type: 'effort' as const, values: [...(efforts ?? ['low', 'high', 'max'])] }] : undefined;
  return { id, name, limit: { context, output }, tool_call: true, reasoning, interleaved: reasoning ? true : undefined, reasoning_options, ...(options?.free === true ? { cost: { input: 0, output: 0 } } : {}), modalities: { input: options?.imageIn === true ? ['text', 'image'] : ['text'], output: ['text'] } };
}
