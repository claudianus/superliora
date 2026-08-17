/**
 * Whole-request long-context price cliffs.
 *
 * Official tables re-price the *entire* prompt once it crosses a threshold
 * (not only the overflow). SuperLiora keeps advertised windows and working-set
 * caps under that band so default sessions stay on the cheap schedule.
 *
 * Identity matchers cover Cursor / local catalogs and prefixed reseller
 * ids (`databricks-gpt-5-4`, `anthropic-claude-4.5-sonnet`). models.dev
 * `cost.tiers` fill in the rest, except families whose official tables
 * are now flat (Claude 4.6+, Gemini Flash, Qwen Max, MiMo V2.5).
 *
 * Cap only documented cliffs. Flat 1M windows (Claude 4.6+, Gemini Flash,
 * GPT-5.2, Qwen Max, DeepSeek V4, MiMo V2.5) stay uncapped.
 *
 * @see https://docs.x.ai/developers/pricing
 * @see https://ai.google.dev/gemini-api/docs/pricing
 * @see https://developers.openai.com/api/docs/models/gpt-5.4
 * @see https://developers.openai.com/api/docs/pricing
 * @see https://www.anthropic.com/news/1m-context (2026-03-13: 4.6+ flat)
 * @see https://help.aliyun.com/en/model-studio/model-pricing
 * @see https://platform.minimax.io/docs/guides/pricing-paygo
 * @see https://platform.xiaomimimo.com/static/docs/price/pay-as-you-go.md
 * @see https://console.sakana.ai/pricing
 */

/** xAI Grok / Gemini Pro / pre-4.6 Claude 1M beta. */
export const XAI_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS = 200_000;

/**
 * Soft working-set kept strictly below the 200k price band.
 * Matches the economy preset so those sessions compact before 2× rates.
 */
export const XAI_PRICING_SAFE_WORKING_SET_TOKENS = 196_608;

/** Async pre-rot ceiling; stays below {@link XAI_PRICING_SAFE_WORKING_SET_TOKENS}. */
export const XAI_PRICING_SAFE_ASYNC_WORKING_SET_TOKENS = 160_000;

/** OpenAI GPT-5.4 / 5.5 / 5.6 (1.05M models). */
export const OPENAI_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS = 272_000;

/** Soft working-set kept strictly below the 272k price band (balanced preset). */
export const OPENAI_PRICING_SAFE_WORKING_SET_TOKENS = 262_144;

/** Async pre-rot ceiling; stays below {@link OPENAI_PRICING_SAFE_WORKING_SET_TOKENS}. */
export const OPENAI_PRICING_SAFE_ASYNC_WORKING_SET_TOKENS = 220_000;

/** Gemini 1.5 family (historical 128k whole-request band). */
export const GEMINI_15_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS = 128_000;

export const GEMINI_15_PRICING_SAFE_WORKING_SET_TOKENS = 122_880;

export const GEMINI_15_PRICING_SAFE_ASYNC_WORKING_SET_TOKENS = 98_304;

/**
 * Qwen Plus (3.6 / 3.7 and later). Official Model Studio rule: the unit
 * price is chosen from the request's total input tokens, then applied to
 * every token in that request. Crossing 256k is a 3× whole-request jump.
 */
export const QWEN_PLUS_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS = 256_000;

/** Soft working-set kept strictly below the 256k Plus band. */
export const QWEN_PLUS_PRICING_SAFE_WORKING_SET_TOKENS = 245_760;

export const QWEN_PLUS_PRICING_SAFE_ASYNC_WORKING_SET_TOKENS = 200_000;

/** MiniMax M3 official ≤512k / >512k rows (input and output both double). */
export const MINIMAX_M3_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS = 512_000;

export const MINIMAX_M3_PRICING_SAFE_WORKING_SET_TOKENS = 491_520;

export const MINIMAX_M3_PRICING_SAFE_ASYNC_WORKING_SET_TOKENS = 409_600;

/** First long-context band for Qwen Coder and ByteDance Seed / Doubao. */
export const SEED_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS = GEMINI_15_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS;

export interface PricingCatalogCostTier {
  readonly input?: number;
  readonly output?: number;
  readonly tier?: {
    readonly type?: string;
    readonly size?: number;
  };
}

export interface PricingCatalogCost {
  readonly input?: number;
  readonly output?: number;
  readonly tiers?: readonly PricingCatalogCostTier[];
}

export interface PricingModelIdentity {
  readonly provider?: string | undefined;
  readonly model?: string | undefined;
  /** models.dev `cost` when the row is available; ignored for known-flat families. */
  readonly cost?: PricingCatalogCost | undefined;
}

export type XaiGrokModelIdentity = PricingModelIdentity;

function lastPathSegment(value: string): string {
  const slash = value.lastIndexOf('/');
  return slash >= 0 ? value.slice(slash + 1) : value;
}

function providerKey(input: PricingModelIdentity): string {
  const provider = input.provider?.trim().toLowerCase() ?? '';
  if (provider.length > 0) return provider;
  const model = input.model?.trim().toLowerCase() ?? '';
  if (!model.includes('/')) return '';
  return model.slice(0, model.indexOf('/'));
}

function normalizeModelId(model: string | undefined): string {
  if (model === undefined) return '';
  return lastPathSegment(model.trim().toLowerCase())
    .replace(/^cursor-/, '')
    .replace(/@.*$/, '');
}

/** Bare Grok SKU: `grok-4.6`, `cursor-grok-4.5-high`, `xai-grok/grok-4.6`. */
export function isGrokModelId(model: string | undefined): boolean {
  if (model === undefined) return false;
  const id = normalizeModelId(model);
  return id === 'grok' || id.startsWith('grok-') || id.startsWith('grok_') || id.startsWith('grok.');
}

export function isXaiGrokProviderId(provider: string | undefined): boolean {
  const key = provider?.trim().toLowerCase() ?? '';
  return key === 'xai-grok' || key === 'xai';
}

/**
 * xAI 200k long-context price band, or `undefined` when the model is not Grok.
 * Cursor / OpenRouter Grok SKUs match by model id so the same cap applies.
 */
export function xaiLongContextPricingThresholdTokens(
  input: PricingModelIdentity,
): number | undefined {
  if (isXaiGrokProviderId(providerKey(input)) || isGrokModelId(input.model)) {
    return XAI_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS;
  }
  return undefined;
}

function openaiLongContextThreshold(id: string): number | undefined {
  if (id.includes('daybreak-blue')) return OPENAI_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS;
  if (/(^|[^a-z0-9])gpt-pro-latest(\b|[-_]|$)/.test(id)) {
    return OPENAI_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS;
  }
  if (/(^|[^a-z0-9])gpt-latest(\b|[-_]|$)/.test(id)) {
    return OPENAI_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS;
  }
  if (/gpt-5[.-][456](\b|[-_]|$)/.test(id)) return OPENAI_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS;
  return undefined;
}

function geminiLongContextThreshold(id: string): number | undefined {
  if (!id.includes('gemini')) return undefined;
  if (/gemini-1[.-]5/.test(id)) return GEMINI_15_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS;
  if (id.includes('pro') && !id.includes('flash')) {
    return XAI_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS;
  }
  return undefined;
}

function parseClaudeGeneration(id: string): { major: number; minor: number } | undefined {
  const dated = id.match(/claude-(\d+)(?:[.-](\d+))?-(opus|sonnet|haiku)\b/);
  if (dated?.[1] !== undefined) {
    return {
      major: Number(dated[1]),
      minor: dated[2] !== undefined ? Number(dated[2]) : 0,
    };
  }
  const named = id.match(/claude-(opus|sonnet|haiku)-(\d+)(?:[.-](\d+))?/);
  if (named?.[2] !== undefined) {
    return {
      major: Number(named[2]),
      minor: named[3] !== undefined ? Number(named[3]) : 0,
    };
  }
  return undefined;
}

function claudeLongContextThreshold(id: string): number | undefined {
  if (id.includes('mythos') || id.includes('fable')) return undefined;
  if (!id.includes('claude')) return undefined;
  const gen = parseClaudeGeneration(id);
  if (gen === undefined) return undefined;
  if (gen.major >= 5) return undefined;
  if (gen.major === 4 && gen.minor >= 6) return undefined;
  return XAI_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS;
}

function qwenLongContextThreshold(id: string): number | undefined {
  if (!id.includes('qwen')) return undefined;
  if (id.includes('max') || id.includes('turbo')) return undefined;
  if (id.includes('coder')) return SEED_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS;
  if (id.includes('flash')) {
    if (/qwen3[._-]?5/.test(id) || /qwen2[._-]?5/.test(id)) {
      return GEMINI_15_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS;
    }
    return QWEN_PLUS_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS;
  }
  if (!id.includes('plus')) return undefined;
  if (/qwen3[._-]?5/.test(id) || /qwen2[._-]?5/.test(id)) {
    return GEMINI_15_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS;
  }
  return QWEN_PLUS_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS;
}

function minimaxLongContextThreshold(id: string): number | undefined {
  if (!id.includes('minimax')) return undefined;
  if (/(^|[^0-9])m3([^0-9]|$)/.test(id)) {
    return MINIMAX_M3_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS;
  }
  return undefined;
}

function seedLongContextThreshold(id: string): number | undefined {
  if (id.includes('doubao')) return SEED_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS;
  if (/seed[-_.]?1[.-]?6/.test(id) || /seed[-_.]?2[.-]?0/.test(id)) {
    return SEED_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS;
  }
  return undefined;
}

/** Sakana Fugu Ultra official >272k whole-request row (same band as GPT-5.4). */
function fuguLongContextThreshold(id: string): number | undefined {
  if (id.includes('fugu-ultra') || id.includes('fugu_ultra')) {
    return OPENAI_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS;
  }
  return undefined;
}

/**
 * Official tables that are now flat. models.dev still lists stale
 * `context_over_200k` / 256k rows for several of these.
 */
function isOfficiallyFlatLongContext(id: string): boolean {
  if (id.includes('mimo')) return true;
  if (id.includes('qwen') && id.includes('max')) return true;
  if (id.includes('gemini') && id.includes('flash') && !/gemini-1[.-]5/.test(id)) {
    return true;
  }
  if (id.includes('claude')) {
    if (id.includes('mythos') || id.includes('fable')) return true;
    const gen = parseClaudeGeneration(id);
    if (gen !== undefined && (gen.major >= 5 || (gen.major === 4 && gen.minor >= 6))) {
      return true;
    }
  }
  return false;
}

/**
 * Smallest models.dev context tier at or above 128k that is strictly more
 * expensive than the catalog base rate. 32k Chinese short-context steps
 * are ignored — those are not the 1M-window cliffs this cap targets.
 */
export function thresholdFromCatalogCost(cost: PricingCatalogCost | undefined): number | undefined {
  if (cost?.tiers === undefined || cost.tiers.length === 0) return undefined;
  const baseInput = cost.input ?? 0;
  const baseOutput = cost.output ?? 0;
  let smallest: number | undefined;
  for (const tier of cost.tiers) {
    const size = tier.tier?.size;
    if (typeof size !== 'number' || !Number.isFinite(size) || size < 128_000) continue;
    const input = tier.input ?? 0;
    const output = tier.output ?? 0;
    if (input <= baseInput && output <= baseOutput) continue;
    if (smallest === undefined || size < smallest) smallest = size;
  }
  return smallest;
}

/**
 * Whole-request long-context threshold for this identity, or `undefined`
 * when the model is billed flat across its advertised window.
 */
export function longContextPricingThresholdTokens(
  input: PricingModelIdentity,
): number | undefined {
  const grok = xaiLongContextPricingThresholdTokens(input);
  if (grok !== undefined) return grok;
  const id = normalizeModelId(input.model);
  if (id.length === 0) return thresholdFromCatalogCost(input.cost);
  if (isOfficiallyFlatLongContext(id)) return undefined;
  return (
    openaiLongContextThreshold(id) ??
    fuguLongContextThreshold(id) ??
    geminiLongContextThreshold(id) ??
    claudeLongContextThreshold(id) ??
    qwenLongContextThreshold(id) ??
    minimaxLongContextThreshold(id) ??
    seedLongContextThreshold(id) ??
    thresholdFromCatalogCost(input.cost)
  );
}

export function workingSetCapsForPricingThreshold(threshold: number): {
  readonly max: number;
  readonly async: number;
} {
  if (threshold <= GEMINI_15_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS) {
    return {
      max: GEMINI_15_PRICING_SAFE_WORKING_SET_TOKENS,
      async: GEMINI_15_PRICING_SAFE_ASYNC_WORKING_SET_TOKENS,
    };
  }
  if (threshold <= XAI_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS) {
    return {
      max: XAI_PRICING_SAFE_WORKING_SET_TOKENS,
      async: XAI_PRICING_SAFE_ASYNC_WORKING_SET_TOKENS,
    };
  }
  if (threshold <= QWEN_PLUS_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS) {
    return {
      max: QWEN_PLUS_PRICING_SAFE_WORKING_SET_TOKENS,
      async: QWEN_PLUS_PRICING_SAFE_ASYNC_WORKING_SET_TOKENS,
    };
  }
  if (threshold <= OPENAI_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS) {
    return {
      max: OPENAI_PRICING_SAFE_WORKING_SET_TOKENS,
      async: OPENAI_PRICING_SAFE_ASYNC_WORKING_SET_TOKENS,
    };
  }
  if (threshold <= MINIMAX_M3_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS) {
    return {
      max: MINIMAX_M3_PRICING_SAFE_WORKING_SET_TOKENS,
      async: MINIMAX_M3_PRICING_SAFE_ASYNC_WORKING_SET_TOKENS,
    };
  }
  return {
    max: Math.floor((threshold * XAI_PRICING_SAFE_WORKING_SET_TOKENS) / XAI_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS),
    async: Math.floor(
      (threshold * XAI_PRICING_SAFE_ASYNC_WORKING_SET_TOKENS) / XAI_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS,
    ),
  };
}

/** Cap an advertised window at the model's price band. Unknown (≤0) is unchanged. */
export function applyPricingSafeContextTokens(
  advertised: number,
  identity: PricingModelIdentity,
): number {
  const threshold = longContextPricingThresholdTokens(identity);
  if (threshold === undefined || advertised <= 0) return advertised;
  return Math.min(advertised, threshold);
}

export const applyXaiPricingSafeContextTokens = applyPricingSafeContextTokens;

export interface PricingSafeWorkingSet {
  readonly maxWorkingSetTokens: number;
  readonly asyncWorkingSetTokens: number;
}

export type XaiPricingSafeWorkingSet = PricingSafeWorkingSet;

/**
 * Pull working-set caps under the model's price band. `0` (full_window) is
 * replaced with the pricing-safe pair so ratio-only 500k/1M windows cannot
 * wait until whole-request long-context rates.
 */
export function applyPricingSafeWorkingSet(input: {
  readonly model?: string | undefined;
  readonly provider?: string | undefined;
  readonly maxWorkingSetTokens: number;
  readonly asyncWorkingSetTokens: number;
}): PricingSafeWorkingSet {
  const threshold = longContextPricingThresholdTokens(input);
  if (threshold === undefined) {
    return {
      maxWorkingSetTokens: input.maxWorkingSetTokens,
      asyncWorkingSetTokens: input.asyncWorkingSetTokens,
    };
  }

  const { max: maxCap, async: asyncCap } = workingSetCapsForPricingThreshold(threshold);
  const maxWorkingSetTokens =
    input.maxWorkingSetTokens <= 0
      ? maxCap
      : Math.min(input.maxWorkingSetTokens, maxCap);
  const asyncWorkingSetTokens =
    input.asyncWorkingSetTokens <= 0
      ? Math.min(asyncCap, Math.max(0, maxWorkingSetTokens - 1))
      : Math.min(
          input.asyncWorkingSetTokens,
          asyncCap,
          Math.max(0, maxWorkingSetTokens - 1),
        );
  return { maxWorkingSetTokens, asyncWorkingSetTokens };
}

export const applyXaiPricingSafeWorkingSet = applyPricingSafeWorkingSet;
