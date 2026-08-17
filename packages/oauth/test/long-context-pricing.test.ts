import { describe, expect, it } from 'vitest';

import {
  applyPricingSafeContextTokens,
  applyPricingSafeWorkingSet,
  GEMINI_15_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS,
  GEMINI_15_PRICING_SAFE_ASYNC_WORKING_SET_TOKENS,
  GEMINI_15_PRICING_SAFE_WORKING_SET_TOKENS,
  longContextPricingThresholdTokens,
  OPENAI_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS,
  OPENAI_PRICING_SAFE_ASYNC_WORKING_SET_TOKENS,
  OPENAI_PRICING_SAFE_WORKING_SET_TOKENS,
  MINIMAX_M3_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS,
  MINIMAX_M3_PRICING_SAFE_ASYNC_WORKING_SET_TOKENS,
  MINIMAX_M3_PRICING_SAFE_WORKING_SET_TOKENS,
  QWEN_PLUS_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS,
  QWEN_PLUS_PRICING_SAFE_ASYNC_WORKING_SET_TOKENS,
  QWEN_PLUS_PRICING_SAFE_WORKING_SET_TOKENS,
  SEED_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS,
  thresholdFromCatalogCost,
  XAI_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS,
  XAI_PRICING_SAFE_ASYNC_WORKING_SET_TOKENS,
  XAI_PRICING_SAFE_WORKING_SET_TOKENS,
} from '../src/profiles/long-context-pricing';

describe('long-context pricing cliffs', () => {
  it('caps Gemini Pro at 200k and leaves Flash / 3 Flash flat', () => {
    expect(longContextPricingThresholdTokens({ model: 'gemini-3.1-pro' })).toBe(
      XAI_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS,
    );
    expect(longContextPricingThresholdTokens({ model: 'google/gemini-2.5-pro' })).toBe(
      XAI_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS,
    );
    expect(longContextPricingThresholdTokens({ model: 'gemini-3-pro-preview' })).toBe(
      XAI_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS,
    );
    expect(longContextPricingThresholdTokens({ model: 'gemini-3.5-flash' })).toBeUndefined();
    expect(longContextPricingThresholdTokens({ model: 'gemini-3-flash-preview' })).toBeUndefined();
    expect(longContextPricingThresholdTokens({ model: 'gemini-2.5-flash' })).toBeUndefined();
    expect(applyPricingSafeContextTokens(1_000_000, { model: 'gemini-3.1-pro' })).toBe(200_000);
    expect(applyPricingSafeContextTokens(1_000_000, { model: 'gemini-3.5-flash' })).toBe(1_000_000);
  });

  it('caps Gemini 1.5 at the historical 128k band', () => {
    expect(longContextPricingThresholdTokens({ model: 'gemini-1.5-pro' })).toBe(
      GEMINI_15_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS,
    );
    expect(longContextPricingThresholdTokens({ model: 'gemini-1.5-flash' })).toBe(
      GEMINI_15_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS,
    );
    expect(applyPricingSafeContextTokens(2_000_000, { model: 'gemini-1.5-pro' })).toBe(128_000);
  });

  it('caps GPT-5.4 / 5.5 / 5.6 at 272k and leaves GPT-5.2 / 5.3 Codex alone', () => {
    expect(longContextPricingThresholdTokens({ model: 'gpt-5.4' })).toBe(
      OPENAI_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS,
    );
    expect(longContextPricingThresholdTokens({ model: 'gpt-5.4-pro' })).toBe(
      OPENAI_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS,
    );
    expect(longContextPricingThresholdTokens({ model: 'gpt-5.4-medium' })).toBe(
      OPENAI_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS,
    );
    expect(longContextPricingThresholdTokens({ model: 'openai/gpt-5.6-sol' })).toBe(
      OPENAI_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS,
    );
    expect(longContextPricingThresholdTokens({ model: 'gpt-5.6-terra' })).toBe(
      OPENAI_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS,
    );
    expect(longContextPricingThresholdTokens({ model: 'gpt-5.6-luna' })).toBe(
      OPENAI_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS,
    );
    expect(longContextPricingThresholdTokens({ model: 'gpt-5.5' })).toBe(
      OPENAI_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS,
    );
    expect(longContextPricingThresholdTokens({ model: 'databricks-gpt-5-4' })).toBe(
      OPENAI_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS,
    );
    expect(longContextPricingThresholdTokens({ model: 'gpt-5.4@eu' })).toBe(
      OPENAI_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS,
    );
    expect(longContextPricingThresholdTokens({ model: 'gpt-latest' })).toBe(
      OPENAI_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS,
    );
    expect(longContextPricingThresholdTokens({ model: 'gpt-pro-latest' })).toBe(
      OPENAI_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS,
    );
    expect(longContextPricingThresholdTokens({ model: 'fugu-ultra-v1.1' })).toBe(
      OPENAI_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS,
    );
    expect(longContextPricingThresholdTokens({ model: 'sakana/fugu-ultra-20260615' })).toBe(
      OPENAI_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS,
    );
    expect(longContextPricingThresholdTokens({ model: 'daybreak-blue-latest' })).toBe(
      OPENAI_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS,
    );
    expect(longContextPricingThresholdTokens({ model: 'gpt-5.2' })).toBeUndefined();
    expect(longContextPricingThresholdTokens({ model: 'gpt-5.3-codex' })).toBeUndefined();
    expect(longContextPricingThresholdTokens({ model: 'gpt-5.1-codex' })).toBeUndefined();
    expect(applyPricingSafeContextTokens(1_050_000, { model: 'gpt-5.4' })).toBe(272_000);
    expect(applyPricingSafeContextTokens(1_000_000, { model: 'fugu-ultra' })).toBe(272_000);
    expect(applyPricingSafeContextTokens(400_000, { model: 'gpt-5.2' })).toBe(400_000);
    expect(applyPricingSafeContextTokens(272_000, { model: 'gpt-5.4-medium' })).toBe(272_000);
  });

  it('does not cap Claude 4.6+ / 5 / Mythos, and caps older 1M beta SKUs', () => {
    expect(longContextPricingThresholdTokens({ model: 'claude-4.6-sonnet' })).toBeUndefined();
    expect(longContextPricingThresholdTokens({ model: 'claude-4.6-opus-high' })).toBeUndefined();
    expect(longContextPricingThresholdTokens({ model: 'claude-sonnet-5-medium' })).toBeUndefined();
    expect(longContextPricingThresholdTokens({ model: 'claude-opus-4-8-medium' })).toBeUndefined();
    expect(longContextPricingThresholdTokens({ model: 'claude-mythos-preview' })).toBeUndefined();
    expect(longContextPricingThresholdTokens({ model: 'anthropic-claude-4.6-sonnet' })).toBeUndefined();
    expect(longContextPricingThresholdTokens({ model: 'claude-opus-4-6@default' })).toBeUndefined();
    expect(longContextPricingThresholdTokens({ model: 'anthropic-claude-4.5-sonnet' })).toBe(
      XAI_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS,
    );
    expect(longContextPricingThresholdTokens({ model: 'claude-sonnet-4' })).toBe(
      XAI_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS,
    );
    expect(longContextPricingThresholdTokens({ model: 'claude-opus-4-1' })).toBe(
      XAI_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS,
    );
    expect(longContextPricingThresholdTokens({ model: 'claude-sonnet-4-5' })).toBe(
      XAI_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS,
    );
    expect(applyPricingSafeContextTokens(1_000_000, { model: 'claude-4.6-sonnet' })).toBe(1_000_000);
    expect(applyPricingSafeContextTokens(1_000_000, { model: 'claude-sonnet-4' })).toBe(200_000);
    expect(applyPricingSafeContextTokens(200_000, { model: 'claude-4.5-sonnet' })).toBe(200_000);
  });

  it('caps Qwen Plus / Flash / Coder and leaves Max / DeepSeek / Kimi / GLM / MiMo flat', () => {
    expect(longContextPricingThresholdTokens({ model: 'qwen3.7-plus' })).toBe(
      QWEN_PLUS_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS,
    );
    expect(longContextPricingThresholdTokens({ model: 'cline-pass/qwen3.7-plus' })).toBe(
      QWEN_PLUS_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS,
    );
    expect(longContextPricingThresholdTokens({ model: 'qwen3.6-plus' })).toBe(
      QWEN_PLUS_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS,
    );
    expect(longContextPricingThresholdTokens({ model: 'qwen3.6-flash' })).toBe(
      QWEN_PLUS_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS,
    );
    expect(longContextPricingThresholdTokens({ model: 'qwen3.7-flash' })).toBe(
      QWEN_PLUS_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS,
    );
    expect(longContextPricingThresholdTokens({ model: 'qwen3-coder-plus' })).toBe(
      SEED_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS,
    );
    expect(longContextPricingThresholdTokens({ model: 'qwen3-coder-flash' })).toBe(
      SEED_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS,
    );
    expect(longContextPricingThresholdTokens({ model: 'qwen3.5-plus' })).toBe(
      GEMINI_15_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS,
    );
    expect(longContextPricingThresholdTokens({ model: 'qwen3.7-max' })).toBeUndefined();
    expect(longContextPricingThresholdTokens({ model: 'qwen3.8-max' })).toBeUndefined();
    expect(longContextPricingThresholdTokens({ model: 'kimi-k2.7-code' })).toBeUndefined();
    expect(longContextPricingThresholdTokens({ model: 'glm-5.2-high' })).toBeUndefined();
    expect(longContextPricingThresholdTokens({ model: 'deepseek-v4-pro' })).toBeUndefined();
    expect(longContextPricingThresholdTokens({ model: 'mimo-v2.5-pro' })).toBeUndefined();
    expect(applyPricingSafeContextTokens(1_048_576, { model: 'qwen3.7-plus' })).toBe(256_000);
    expect(applyPricingSafeContextTokens(1_000_000, { model: 'qwen3.6-flash' })).toBe(256_000);
    expect(applyPricingSafeContextTokens(1_000_000, { model: 'qwen3.7-max' })).toBe(1_000_000);
  });

  it('caps MiniMax M3 at 512k and Seed / Doubao at 128k', () => {
    expect(longContextPricingThresholdTokens({ model: 'minimax-m3' })).toBe(
      MINIMAX_M3_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS,
    );
    expect(longContextPricingThresholdTokens({ model: 'cline-pass/minimax-m3' })).toBe(
      MINIMAX_M3_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS,
    );
    expect(longContextPricingThresholdTokens({ model: 'MiniMax-M2.7' })).toBeUndefined();
    expect(longContextPricingThresholdTokens({ model: 'doubao-seed-2-0-pro' })).toBe(
      SEED_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS,
    );
    expect(longContextPricingThresholdTokens({ model: 'bytedance-seed/seed-1.6' })).toBe(
      SEED_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS,
    );
    expect(applyPricingSafeContextTokens(1_048_576, { model: 'minimax-m3' })).toBe(512_000);
    expect(applyPricingSafeContextTokens(256_000, { model: 'seed-2.0-code' })).toBe(128_000);
  });

  it('reads models.dev context tiers and ignores stale cliffs on flat families', () => {
    const stale200k = {
      input: 3,
      output: 15,
      tiers: [{ input: 6, output: 22.5, tier: { type: 'context', size: 200_000 } }],
    };
    expect(thresholdFromCatalogCost(stale200k)).toBe(200_000);
    expect(thresholdFromCatalogCost({ input: 1, output: 2, tiers: [{ input: 2, output: 4, tier: { type: 'context', size: 32_000 } }] })).toBeUndefined();
    expect(
      applyPricingSafeContextTokens(1_000_000, {
        model: 'acme-1m',
        cost: stale200k,
      }),
    ).toBe(200_000);
    expect(
      applyPricingSafeContextTokens(1_000_000, {
        model: 'claude-4.6-sonnet',
        cost: stale200k,
      }),
    ).toBe(1_000_000);
    expect(
      applyPricingSafeContextTokens(1_000_000, {
        model: 'gemini-3-flash-preview',
        cost: stale200k,
      }),
    ).toBe(1_000_000);
    expect(
      applyPricingSafeContextTokens(1_000_000, {
        model: 'mimo-v2.5-pro',
        cost: {
          input: 0.435,
          output: 0.87,
          tiers: [{ input: 2, output: 6, tier: { type: 'context', size: 256_000 } }],
        },
      }),
    ).toBe(1_000_000);
  });

  it('pulls Gemini Pro working-set under 200k including full_window and deep', () => {
    expect(
      applyPricingSafeWorkingSet({
        model: 'gemini-3.1-pro',
        maxWorkingSetTokens: 262_144,
        asyncWorkingSetTokens: 220_000,
      }),
    ).toEqual({
      maxWorkingSetTokens: XAI_PRICING_SAFE_WORKING_SET_TOKENS,
      asyncWorkingSetTokens: XAI_PRICING_SAFE_ASYNC_WORKING_SET_TOKENS,
    });
    expect(
      applyPricingSafeWorkingSet({
        model: 'gemini-3.1-pro',
        maxWorkingSetTokens: 393_216,
        asyncWorkingSetTokens: 320_000,
      }),
    ).toEqual({
      maxWorkingSetTokens: XAI_PRICING_SAFE_WORKING_SET_TOKENS,
      asyncWorkingSetTokens: XAI_PRICING_SAFE_ASYNC_WORKING_SET_TOKENS,
    });
    expect(
      applyPricingSafeWorkingSet({
        model: 'gemini-3.5-flash',
        maxWorkingSetTokens: 393_216,
        asyncWorkingSetTokens: 320_000,
      }),
    ).toEqual({
      maxWorkingSetTokens: 393_216,
      asyncWorkingSetTokens: 320_000,
    });
  });

  it('pulls GPT-5.4 deep / full_window under 272k and leaves balanced alone', () => {
    expect(
      applyPricingSafeWorkingSet({
        model: 'gpt-5.4',
        maxWorkingSetTokens: 262_144,
        asyncWorkingSetTokens: 220_000,
      }),
    ).toEqual({
      maxWorkingSetTokens: OPENAI_PRICING_SAFE_WORKING_SET_TOKENS,
      asyncWorkingSetTokens: OPENAI_PRICING_SAFE_ASYNC_WORKING_SET_TOKENS,
    });
    expect(
      applyPricingSafeWorkingSet({
        model: 'gpt-5.6-sol',
        maxWorkingSetTokens: 0,
        asyncWorkingSetTokens: 0,
      }),
    ).toEqual({
      maxWorkingSetTokens: OPENAI_PRICING_SAFE_WORKING_SET_TOKENS,
      asyncWorkingSetTokens: OPENAI_PRICING_SAFE_ASYNC_WORKING_SET_TOKENS,
    });
    expect(
      applyPricingSafeWorkingSet({
        model: 'gpt-5.4',
        maxWorkingSetTokens: 393_216,
        asyncWorkingSetTokens: 320_000,
      }),
    ).toEqual({
      maxWorkingSetTokens: OPENAI_PRICING_SAFE_WORKING_SET_TOKENS,
      asyncWorkingSetTokens: OPENAI_PRICING_SAFE_ASYNC_WORKING_SET_TOKENS,
    });
    expect(
      applyPricingSafeWorkingSet({
        model: 'gpt-5.2',
        maxWorkingSetTokens: 393_216,
        asyncWorkingSetTokens: 320_000,
      }),
    ).toEqual({
      maxWorkingSetTokens: 393_216,
      asyncWorkingSetTokens: 320_000,
    });
  });

  it('pulls MiniMax M3 full_window under 512k', () => {
    expect(
      applyPricingSafeWorkingSet({
        model: 'minimax-m3',
        maxWorkingSetTokens: 0,
        asyncWorkingSetTokens: 0,
      }),
    ).toEqual({
      maxWorkingSetTokens: MINIMAX_M3_PRICING_SAFE_WORKING_SET_TOKENS,
      asyncWorkingSetTokens: MINIMAX_M3_PRICING_SAFE_ASYNC_WORKING_SET_TOKENS,
    });
  });

  it('pulls Qwen Plus working-set under 256k including default balanced', () => {
    expect(
      applyPricingSafeWorkingSet({
        model: 'qwen3.7-plus',
        maxWorkingSetTokens: 262_144,
        asyncWorkingSetTokens: 220_000,
      }),
    ).toEqual({
      maxWorkingSetTokens: QWEN_PLUS_PRICING_SAFE_WORKING_SET_TOKENS,
      asyncWorkingSetTokens: QWEN_PLUS_PRICING_SAFE_ASYNC_WORKING_SET_TOKENS,
    });
    expect(
      applyPricingSafeWorkingSet({
        model: 'qwen3.7-plus',
        maxWorkingSetTokens: 0,
        asyncWorkingSetTokens: 0,
      }),
    ).toEqual({
      maxWorkingSetTokens: QWEN_PLUS_PRICING_SAFE_WORKING_SET_TOKENS,
      asyncWorkingSetTokens: QWEN_PLUS_PRICING_SAFE_ASYNC_WORKING_SET_TOKENS,
    });
  });

  it('pulls Gemini 1.5 working-set under 128k', () => {
    expect(
      applyPricingSafeWorkingSet({
        model: 'gemini-1.5-pro',
        maxWorkingSetTokens: 262_144,
        asyncWorkingSetTokens: 220_000,
      }),
    ).toEqual({
      maxWorkingSetTokens: GEMINI_15_PRICING_SAFE_WORKING_SET_TOKENS,
      asyncWorkingSetTokens: GEMINI_15_PRICING_SAFE_ASYNC_WORKING_SET_TOKENS,
    });
  });
});
