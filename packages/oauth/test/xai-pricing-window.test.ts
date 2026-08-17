import { describe, expect, it } from 'vitest';

import {
  applyXaiPricingSafeContextTokens,
  applyXaiPricingSafeWorkingSet,
  isGrokModelId,
  XAI_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS,
  XAI_PRICING_SAFE_ASYNC_WORKING_SET_TOKENS,
  XAI_PRICING_SAFE_WORKING_SET_TOKENS,
  xaiLongContextPricingThresholdTokens,
} from '../src/profiles/xai-pricing-window';

describe('xai pricing window', () => {
  it('recognizes Grok SKUs across aliases and Cursor prefixes', () => {
    expect(isGrokModelId('grok-4.6')).toBe(true);
    expect(isGrokModelId('xai-grok/grok-4.6-xhigh')).toBe(true);
    expect(isGrokModelId('cursor-grok-4.5-high-fast')).toBe(true);
    expect(isGrokModelId('grok-build-0.1')).toBe(true);
    expect(isGrokModelId('claude-4.6-sonnet')).toBe(false);
    expect(isGrokModelId('gpt-5.4')).toBe(false);
  });

  it('applies the 200k band for xAI providers and Grok model ids', () => {
    expect(xaiLongContextPricingThresholdTokens({ provider: 'xai-grok', model: 'custom' })).toBe(
      XAI_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS,
    );
    expect(xaiLongContextPricingThresholdTokens({ model: 'grok-4.6' })).toBe(
      XAI_LONG_CONTEXT_PRICING_THRESHOLD_TOKENS,
    );
    expect(xaiLongContextPricingThresholdTokens({ model: 'claude-4.6-sonnet' })).toBeUndefined();
  });

  it('caps advertised Grok windows at 200k and leaves smaller windows alone', () => {
    expect(applyXaiPricingSafeContextTokens(500_000, { model: 'grok-4.6' })).toBe(200_000);
    expect(applyXaiPricingSafeContextTokens(1_000_000, { provider: 'xai-grok' })).toBe(200_000);
    expect(applyXaiPricingSafeContextTokens(128_000, { model: 'grok-code-fast-1' })).toBe(128_000);
    expect(applyXaiPricingSafeContextTokens(500_000, { model: 'claude-4.6-sonnet' })).toBe(500_000);
    expect(applyXaiPricingSafeContextTokens(0, { model: 'grok-4.6' })).toBe(0);
  });

  it('pulls working-set caps under the price band, including full_window', () => {
    expect(
      applyXaiPricingSafeWorkingSet({
        model: 'grok-4.6',
        maxWorkingSetTokens: 262_144,
        asyncWorkingSetTokens: 220_000,
      }),
    ).toEqual({
      maxWorkingSetTokens: XAI_PRICING_SAFE_WORKING_SET_TOKENS,
      asyncWorkingSetTokens: XAI_PRICING_SAFE_ASYNC_WORKING_SET_TOKENS,
    });
    expect(
      applyXaiPricingSafeWorkingSet({
        model: 'grok-4.6',
        maxWorkingSetTokens: 0,
        asyncWorkingSetTokens: 0,
      }),
    ).toEqual({
      maxWorkingSetTokens: XAI_PRICING_SAFE_WORKING_SET_TOKENS,
      asyncWorkingSetTokens: XAI_PRICING_SAFE_ASYNC_WORKING_SET_TOKENS,
    });
    expect(
      applyXaiPricingSafeWorkingSet({
        model: 'grok-4.6',
        maxWorkingSetTokens: 100_000,
        asyncWorkingSetTokens: 80_000,
      }),
    ).toEqual({
      maxWorkingSetTokens: 100_000,
      asyncWorkingSetTokens: 80_000,
    });
    expect(
      applyXaiPricingSafeWorkingSet({
        model: 'claude-4.6-sonnet',
        maxWorkingSetTokens: 262_144,
        asyncWorkingSetTokens: 220_000,
      }),
    ).toEqual({
      maxWorkingSetTokens: 262_144,
      asyncWorkingSetTokens: 220_000,
    });
  });
});
