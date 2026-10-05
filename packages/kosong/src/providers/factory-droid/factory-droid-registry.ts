/**
 * Factory Droid model registry — the roster first-party clients ship because
 * Factory has no model-listing endpoint. Each entry pins the wire dialect the
 * Factory LLM proxy expects and the default upstream router (`x-api-provider`)
 * the model routes to.
 *
 * Ported from the oh-my-pi catalog (`provider "factory-droid"` seed block and
 * the `api-routes`/`upstream-rotation` tables); the first rotation entry is
 * the registry default used when live routing does not override it.
 */

export type FactoryDroidWire =
  | 'openai-completions'
  | 'openai-responses'
  | 'anthropic-messages'
  | 'google-generate';

export interface FactoryDroidModelRoute {
  readonly wire: FactoryDroidWire;
  /** Default `x-api-provider` upstream (first entry of the rotation). */
  readonly upstream: string;
  readonly displayName: string;
  readonly contextWindow: number;
  readonly maxTokens: number;
  readonly reasoning: boolean;
  readonly supportsImages: boolean;
}

const M = (
  wire: FactoryDroidWire,
  upstream: string,
  displayName: string,
  contextWindow: number,
  maxTokens: number,
  reasoning: boolean,
  supportsImages: boolean,
): FactoryDroidModelRoute => ({
  wire,
  upstream,
  displayName,
  contextWindow,
  maxTokens,
  reasoning,
  supportsImages,
});

const AN = 'anthropic';
const OAI = 'openai';
const FW = 'fireworks';
const GOOG = 'google';
const CMPL: FactoryDroidWire = 'openai-completions';
const RESP: FactoryDroidWire = 'openai-responses';
const MSGS: FactoryDroidWire = 'anthropic-messages';
const GEN: FactoryDroidWire = 'google-generate';

export const FACTORY_DROID_MODELS: Readonly<Record<string, FactoryDroidModelRoute>> = {
  'claude-fable-5.1': M(MSGS, AN, 'Fable 5.1', 867000, 128000, true, true),
  'claude-fable-5': M(MSGS, AN, 'Fable 5', 867000, 128000, true, true),
  'claude-opus-5-5': M(MSGS, AN, 'Opus 5.5', 872000, 128000, true, true),
  'claude-opus-5-5-fast': M(MSGS, AN, 'Opus 5.5 Fast Mode', 872000, 128000, true, true),
  'claude-opus-5': M(MSGS, AN, 'Opus 5', 867000, 128000, true, true),
  'claude-opus-5-fast': M(MSGS, AN, 'Opus 5 Fast Mode', 867000, 128000, true, true),
  'claude-opus-4-8': M(MSGS, AN, 'Opus 4.8', 867000, 128000, true, true),
  'claude-opus-4-8-fast': M(MSGS, AN, 'Opus 4.8 Fast Mode', 867000, 128000, true, true),
  'claude-opus-4-7': M(MSGS, AN, 'Opus 4.7', 867000, 128000, true, true),
  'claude-opus-4-6': M(MSGS, AN, 'Opus 4.6', 867000, 128000, true, true),
  'claude-opus-4-5-20251101': M(MSGS, AN, 'Opus 4.5', 180000, 64000, true, true),
  'claude-sonnet-5-5': M(MSGS, AN, 'Sonnet 5.5', 872000, 128000, true, true),
  'claude-sonnet-5': M(MSGS, AN, 'Sonnet 5', 872000, 128000, true, true),
  'claude-sonnet-4-6': M(MSGS, AN, 'Sonnet 4.6', 931000, 64000, true, true),
  'claude-sonnet-4-5-20250929': M(MSGS, AN, 'Sonnet 4.5', 180000, 32000, true, true),
  'claude-haiku-4-5-20251001': M(MSGS, AN, 'Haiku 4.5', 180000, 32000, true, true),
  'gpt-6-astra': M(RESP, OAI, 'GPT-6 Astra', 922000, 128000, true, true),
  'gpt-6.1-sol': M(RESP, OAI, 'GPT-6.1 Sol', 922000, 128000, true, true),
  'gpt-6-sol': M(RESP, OAI, 'GPT-6 Sol', 922000, 128000, true, true),
  'gpt-6-luna': M(RESP, OAI, 'GPT-6 Luna', 922000, 128000, true, true),
  'gpt-5.6-sol': M(RESP, OAI, 'GPT-5.6 Sol', 922000, 128000, true, true),
  'gpt-5.6-sol-fast': M(RESP, OAI, 'GPT-5.6 Sol Fast Mode', 922000, 128000, true, true),
  'gpt-5.6-terra': M(RESP, OAI, 'GPT-5.6 Terra', 922000, 128000, true, true),
  'gpt-5.6-luna': M(RESP, OAI, 'GPT-5.6 Luna', 922000, 128000, true, true),
  'gpt-5.5': M(RESP, OAI, 'GPT-5.5', 922000, 128000, true, true),
  'gpt-5.5-fast': M(RESP, OAI, 'GPT-5.5 Fast Mode', 922000, 128000, true, true),
  'gpt-5.5-pro': M(RESP, OAI, 'GPT-5.5 Pro', 922000, 128000, true, true),
  'gpt-5.4': M(RESP, OAI, 'GPT-5.4', 922000, 128000, true, true),
  'gpt-5.4-fast': M(RESP, OAI, 'GPT-5.4 Fast Mode', 922000, 128000, true, true),
  'gpt-5.4-mini': M(RESP, OAI, 'GPT-5.4 Mini', 272000, 128000, true, true),
  'gpt-5.4-mini-fast': M(RESP, OAI, 'GPT-5.4 Mini Fast Mode', 272000, 128000, true, true),
  'gpt-5.3-codex': M(RESP, OAI, 'GPT-5.3-Codex', 272000, 128000, true, true),
  'gpt-5.3-codex-fast': M(RESP, OAI, 'GPT-5.3-Codex Fast Mode', 272000, 128000, true, true),
  'gpt-5.2': M(RESP, OAI, 'GPT-5.2', 272000, 128000, true, true),
  'garnet-07-15': M(GEN, GOOG, 'Garnet 07/15 (Preview)', 1000000, 65536, true, true),
  'gemini-3.1-pro-preview': M(GEN, GOOG, 'Gemini 3.1 Pro', 1000000, 65536, true, true),
  'gemini-3.8-flash': M(GEN, GOOG, 'Gemini 3.8 Flash', 1000000, 65536, true, true),
  'gemini-3.7-flash': M(GEN, GOOG, 'Gemini 3.7 Flash', 1000000, 65536, true, true),
  'gemini-3.6-flash': M(GEN, GOOG, 'Gemini 3.6 Flash', 1000000, 65536, true, true),
  'gemini-3.5-flash': M(GEN, GOOG, 'Gemini 3.5 Flash', 1000000, 65536, true, true),
  'gemini-3-flash-preview': M(GEN, GOOG, 'Gemini 3 Flash', 1000000, 65536, true, true),
  inkling: M(CMPL, FW, 'Inkling', 1007232, 32768, true, true),
  'mistral-medium-3.5': M(CMPL, 'mistral', 'Mistral Medium 3.5', 192000, 64000, true, true),
  'glm-5.3-flash': M(CMPL, FW, 'GLM-5.3-Flash', 917504, 131072, true, true),
  'glm-5.3': M(CMPL, FW, 'GLM-5.3', 908928, 131072, true, false),
  'glm-5.2': M(CMPL, 'baseten', 'GLM-5.2', 908928, 131072, true, false),
  'glm-5.2-fast': M(CMPL, 'baseten', 'GLM-5.2 Fast', 393216, 131072, true, false),
  'kimi-k3': M(CMPL, FW, 'Kimi K3', 196608, 65536, true, true),
  'qwen3.8-max': M(CMPL, FW, 'Qwen3.8 Max', 131072, 131072, true, false),
  'nemotron-3-ultra': M(CMPL, 'baseten', 'Nemotron 3 Ultra', 136464, 65536, true, false),
  'deepseek-v4.1-flash': M(CMPL, FW, 'DeepSeek V4.1 Flash', 908928, 131072, true, true),
  'deepseek-v4-flash-0731': M(CMPL, FW, 'DeepSeek V4 Flash 0731', 908928, 131072, true, false),
  'deepseek-v4-pro': M(CMPL, FW, 'DeepSeek V4 Pro', 908928, 131072, true, false),
  'minimax-m3': M(CMPL, FW, 'MiniMax M3', 448000, 64000, true, true),
  'grok-4.7': M(RESP, 'xai', 'Grok 4.7', 436644, 63356, true, true),
  'grok-4.6': M(RESP, 'xai', 'Grok 4.6', 200000, 63356, true, true),
  'grok-4.5': M(RESP, 'xai', 'Grok 4.5', 200000, 63356, true, true),
  'atlas-07-21': M(MSGS, AN, 'Atlas 07/21 (Preview)', 867000, 128000, true, true),
  'aster-07-15': M(MSGS, AN, 'Aster 07/15 (Preview)', 867000, 128000, true, true),
  'minimax-m2.7': M(MSGS, FW, 'MiniMax M2.7', 196600, 64000, true, false),
};

/**
 * Family fallbacks for registry misses — the roster only lists IDs Factory's
 * CLI pins; future entries in a family share its wire. Upstream falls back to
 * the family's canonical router so unlisted IDs still route.
 */
const FAMILY_ROUTES: ReadonlyArray<readonly [RegExp, FactoryDroidWire, string]> = [
  [/^(claude|atlas|aster)-/, MSGS, AN],
  [/^gemini-|^garnet-/, GEN, GOOG],
  [/^(gpt-|grok-|o\d)/, RESP, OAI],
];

/** Resolves the wire + default upstream for a model id, or `undefined`. */
export function resolveFactoryDroidRoute(model: string): FactoryDroidModelRoute | undefined {
  const known = FACTORY_DROID_MODELS[model];
  if (known !== undefined) return known;
  for (const [pattern, wire, upstream] of FAMILY_ROUTES) {
    if (pattern.test(model)) {
      return {
        wire,
        upstream,
        displayName: model,
        contextWindow: 0,
        maxTokens: 0,
        reasoning: true,
        supportsImages: true,
      };
    }
  }
  // Unrecognized ids default to the OpenAI completions proxy route.
  return {
    wire: CMPL,
    upstream: FW,
    displayName: model,
    contextWindow: 0,
    maxTokens: 0,
    reasoning: false,
    supportsImages: false,
  };
}
