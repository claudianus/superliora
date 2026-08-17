/**
 * xAI long-context pricing. Official tables bill the *entire* request at the
 * higher band once the prompt reaches 200k tokens (not only the overflow).
 *
 * @see https://docs.x.ai/developers/models/grok-4.6
 * @see https://docs.x.ai/developers/pricing
 */

/** Prompt size at which xAI doubles input / cached-input / output rates. */
export const XAI_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS = 200_000;

/**
 * Soft working-set kept strictly below the 200k price band.
 * Matches the existing economy preset so Grok sessions compact before 2× rates.
 */
export const XAI_PRICING_SAFE_WORKING_SET_TOKENS = 196_608;

/** Async pre-rot ceiling; stays below {@link XAI_PRICING_SAFE_WORKING_SET_TOKENS}. */
export const XAI_PRICING_SAFE_ASYNC_WORKING_SET_TOKENS = 160_000;

export interface XaiGrokModelIdentity {
  readonly provider?: string | undefined;
  readonly model?: string | undefined;
}

function lastPathSegment(value: string): string {
  const slash = value.lastIndexOf('/');
  return slash >= 0 ? value.slice(slash + 1) : value;
}

function providerKey(input: XaiGrokModelIdentity): string {
  const provider = input.provider?.trim().toLowerCase() ?? '';
  if (provider.length > 0) return provider;
  const model = input.model?.trim().toLowerCase() ?? '';
  if (!model.includes('/')) return '';
  return model.slice(0, model.indexOf('/'));
}

/** Bare Grok SKU: `grok-4.6`, `cursor-grok-4.5-high`, `xai-grok/grok-4.6`. */
export function isGrokModelId(model: string | undefined): boolean {
  if (model === undefined) return false;
  const id = lastPathSegment(model.trim().toLowerCase()).replace(/^cursor-/, '');
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
  input: XaiGrokModelIdentity,
): number | undefined {
  if (isXaiGrokProviderId(providerKey(input)) || isGrokModelId(input.model)) {
    return XAI_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS;
  }
  return undefined;
}

/** Cap an advertised window at the xAI 200k price band. Unknown (≤0) is unchanged. */
export function applyXaiPricingSafeContextTokens(
  advertised: number,
  identity: XaiGrokModelIdentity,
): number {
  const threshold = xaiLongContextPricingThresholdTokens(identity);
  if (threshold === undefined || advertised <= 0) return advertised;
  return Math.min(advertised, threshold);
}

export interface XaiPricingSafeWorkingSet {
  readonly maxWorkingSetTokens: number;
  readonly asyncWorkingSetTokens: number;
}

/**
 * Pull working-set caps under the 200k band. `0` (full_window) is replaced
 * with the pricing-safe pair so ratio-only 500k/1M windows cannot wait until
 * 2× rates.
 */
export function applyXaiPricingSafeWorkingSet(input: {
  readonly model?: string | undefined;
  readonly provider?: string | undefined;
  readonly maxWorkingSetTokens: number;
  readonly asyncWorkingSetTokens: number;
}): XaiPricingSafeWorkingSet {
  if (xaiLongContextPricingThresholdTokens(input) === undefined) {
    return {
      maxWorkingSetTokens: input.maxWorkingSetTokens,
      asyncWorkingSetTokens: input.asyncWorkingSetTokens,
    };
  }

  const maxCap = XAI_PRICING_SAFE_WORKING_SET_TOKENS;
  const asyncCap = XAI_PRICING_SAFE_ASYNC_WORKING_SET_TOKENS;
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
