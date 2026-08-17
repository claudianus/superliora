/**
 * xAI long-context pricing helpers.
 *
 * Grok-specific matchers stay here for existing imports. Context / working-set
 * clamps now cover documented whole-request cliffs (Grok, Gemini Pro,
 * GPT-5.4+, Qwen Plus/Flash/Coder, MiniMax M3, Seed, pre-4.6 Claude)
 * via {@link long-context-pricing}.
 *
 * @see ./long-context-pricing.ts
 */

export {
  applyPricingSafeContextTokens as applyXaiPricingSafeContextTokens,
  applyPricingSafeWorkingSet as applyXaiPricingSafeWorkingSet,
  isGrokModelId,
  isXaiGrokProviderId,
  XAI_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS,
  XAI_PRICING_SAFE_ASYNC_WORKING_SET_TOKENS,
  XAI_PRICING_SAFE_WORKING_SET_TOKENS,
  xaiLongContextPricingThresholdTokens,
} from './long-context-pricing';
export type {
  PricingModelIdentity as XaiGrokModelIdentity,
  PricingSafeWorkingSet as XaiPricingSafeWorkingSet,
} from './long-context-pricing';
