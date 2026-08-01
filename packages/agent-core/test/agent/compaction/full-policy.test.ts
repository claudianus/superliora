import { describe, expect, it } from 'vitest';

import {
  clampObservedOverflowTokens,
  handoffThresholdTokens,
  MIN_OBSERVED_MAX_CONTEXT_TOKENS,
  relaxObservedMaxContextTokens,
  resolveEffectiveMaxContextTokens,
  shouldDeferAutoCompaction,
  shouldRecoverFromOverflowStatus,
  shouldSkipRecompactUntilGrowth,
  shouldUseParallelSummarize,
} from '../../../src/agent/compaction/full-policy';

describe('full-policy.ts — pure policy helpers', () => {
  describe('shouldSkipRecompactUntilGrowth', () => {
    it('never skips on the first compaction (no baseline)', () => {
      expect(
        shouldSkipRecompactUntilGrowth({
          lastCompactedTokenCount: null,
          tokenCountWithPending: 10_000,
          minGrowthRatio: 0.05,
          maxContextTokens: 200_000,
        }),
      ).toBe(false);
    });

    it('skips when the session has not grown past the last baseline', () => {
      expect(
        shouldSkipRecompactUntilGrowth({
          lastCompactedTokenCount: 50_000,
          tokenCountWithPending: 50_000,
          minGrowthRatio: 0.05,
          maxContextTokens: 200_000,
        }),
      ).toBe(true);
    });

    it('does not enforce growth when minGrowthRatio is non-positive', () => {
      expect(
        shouldSkipRecompactUntilGrowth({
          lastCompactedTokenCount: 50_000,
          tokenCountWithPending: 50_500,
          minGrowthRatio: 0,
          maxContextTokens: 200_000,
        }),
      ).toBe(false);
    });

    it('skips when growth is below the configured ratio of the working-set base', () => {
      // base = 200k, minGrowth = floor(200k * 0.05) = 10_000
      // growth = 100_500 - 100_000 = 500
      expect(
        shouldSkipRecompactUntilGrowth({
          lastCompactedTokenCount: 100_000,
          tokenCountWithPending: 100_500,
          minGrowthRatio: 0.05,
          maxContextTokens: 200_000,
        }),
      ).toBe(true);
    });

    it('allows re-compact once growth clears the floor', () => {
      expect(
        shouldSkipRecompactUntilGrowth({
          lastCompactedTokenCount: 100_000,
          tokenCountWithPending: 130_000,
          minGrowthRatio: 0.05,
          maxContextTokens: 200_000,
        }),
      ).toBe(false);
    });

    it('uses the working-set cap as the growth base on 1M windows', () => {
      // cap=256k, base=256k, minGrowth = floor(256k * 0.05) = 12_800
      // growth = 200_000 - 100_000 = 100_000 → 100_000 >= 12_800 → false
      expect(
        shouldSkipRecompactUntilGrowth({
          lastCompactedTokenCount: 100_000,
          tokenCountWithPending: 200_000,
          minGrowthRatio: 0.05,
          maxContextTokens: 1_000_000,
          maxWorkingSetTokens: 256_000,
        }),
      ).toBe(false);
    });
  });

  describe('shouldDeferAutoCompaction', () => {
    it('defers while UltraSwarm is active and the soft trigger has not fired', () => {
      expect(
        shouldDeferAutoCompaction({
          ultraSwarmActive: true,
          shouldBlock: false,
          hasActiveForegroundChildren: false,
        }),
      ).toBe(true);
    });

    it('does not defer when UltraSwarm is active and the hard block is imminent', () => {
      expect(
        shouldDeferAutoCompaction({
          ultraSwarmActive: true,
          shouldBlock: true,
          hasActiveForegroundChildren: false,
        }),
      ).toBe(false);
    });

    it('deferring defers to foreground children only outside UltraSwarm', () => {
      expect(
        shouldDeferAutoCompaction({
          ultraSwarmActive: false,
          shouldBlock: false,
          hasActiveForegroundChildren: true,
        }),
      ).toBe(true);
      expect(
        shouldDeferAutoCompaction({
          ultraSwarmActive: false,
          shouldBlock: false,
          hasActiveForegroundChildren: false,
        }),
      ).toBe(false);
    });
  });

  describe('handoffThresholdTokens', () => {
    it('returns undefined when maxTokens is missing/0/negative', () => {
      expect(handoffThresholdTokens({ maxTokens: undefined, triggerRatio: 0.65 })).toBeUndefined();
      expect(handoffThresholdTokens({ maxTokens: 0, triggerRatio: 0.65 })).toBeUndefined();
      expect(handoffThresholdTokens({ maxTokens: -1, triggerRatio: 0.65 })).toBeUndefined();
    });

    it('returns floor(maxTokens * triggerRatio) when no cap is configured', () => {
      expect(handoffThresholdTokens({ maxTokens: 1_000_000, triggerRatio: 0.65 })).toBe(650_000);
    });

    it('clamps to the working-set cap when the cap is below the ratio', () => {
      expect(
        handoffThresholdTokens({
          maxTokens: 1_000_000,
          triggerRatio: 0.65,
          maxWorkingSetTokens: 180_000,
        }),
      ).toBe(180_000);
    });
  });

  describe('relaxObservedMaxContextTokens', () => {
    it('returns observed when configured is non-positive', () => {
      expect(
        relaxObservedMaxContextTokens({ observed: 10_000, configured: 0, decayPerTurn: 0.5 }),
      ).toBe(10_000);
    });

    it('returns observed when observed already reached configured', () => {
      expect(
        relaxObservedMaxContextTokens({
          observed: 200_000,
          configured: 200_000,
          decayPerTurn: 0.5,
        }),
      ).toBe(200_000);
    });

    it('decays the gap toward configured and never overshoots', () => {
      // gap=100_000, ceil(100_000 * 0.5) = 50_000 → 150_000
      expect(
        relaxObservedMaxContextTokens({
          observed: 100_000,
          configured: 200_000,
          decayPerTurn: 0.5,
        }),
      ).toBe(150_000);
    });
  });

  describe('resolveEffectiveMaxContextTokens', () => {
    it('returns configured when no observed value exists', () => {
      expect(
        resolveEffectiveMaxContextTokens({ configured: 200_000, observed: undefined }),
      ).toBe(200_000);
    });

    it('returns observed when configured is non-positive', () => {
      expect(resolveEffectiveMaxContextTokens({ configured: 0, observed: 50_000 })).toBe(50_000);
    });

    it('returns min(configured, observed) when both are positive', () => {
      expect(
        resolveEffectiveMaxContextTokens({ configured: 200_000, observed: 150_000 }),
      ).toBe(150_000);
      expect(
        resolveEffectiveMaxContextTokens({ configured: 200_000, observed: 250_000 }),
      ).toBe(200_000);
    });
  });

  describe('clampObservedOverflowTokens', () => {
    it('floors unstated tiny estimates so short fixtures still tighten a large window', () => {
      expect(
        clampObservedOverflowTokens({
          observed: 97,
          currentEffective: 256_000,
        }),
      ).toBe(MIN_OBSERVED_MAX_CONTEXT_TOKENS);
    });

    it('still tightens a small configured window without overshooting', () => {
      expect(
        clampObservedOverflowTokens({
          observed: 606,
          currentEffective: 1_000,
        }),
      ).toBe(999);
    });

    it('keeps provider-stated limits as-is after the safety ratio', () => {
      expect(
        clampObservedOverflowTokens({
          observed: 425_000,
          currentEffective: 2_000_000,
          statedLimitTokens: 500_000,
        }),
      ).toBe(425_000);
    });
  });

  describe('shouldRecoverFromOverflowStatus', () => {
    it('recovers whenever a context-overflow error is signalled', () => {
      expect(
        shouldRecoverFromOverflowStatus({
          isContextOverflowError: true,
          isStatus413: false,
          estimatedRequestTokens: 0,
          maxContextTokens: 200_000,
          recoveryRatio: 0.9,
        }),
      ).toBe(true);
    });

    it('recovers on overflow-shaped 400 status messages (max prompt length)', () => {
      expect(
        shouldRecoverFromOverflowStatus({
          isContextOverflowError: false,
          isStatus413: false,
          isOverflowStatusMessage: true,
          estimatedRequestTokens: 2_000_000,
          maxContextTokens: 2_000_000,
          recoveryRatio: 0.5,
        }),
      ).toBe(true);
    });

    it('does not recover from a 413 when context usage is below the recovery ratio', () => {
      expect(
        shouldRecoverFromOverflowStatus({
          isContextOverflowError: false,
          isStatus413: true,
          estimatedRequestTokens: 50_000,
          maxContextTokens: 200_000,
          recoveryRatio: 0.9,
        }),
      ).toBe(false);
    });

    it('recovers from a 413 once usage crosses the recovery ratio', () => {
      expect(
        shouldRecoverFromOverflowStatus({
          isContextOverflowError: false,
          isStatus413: true,
          estimatedRequestTokens: 195_000,
          maxContextTokens: 200_000,
          recoveryRatio: 0.9,
        }),
      ).toBe(true);
    });

    it('does not recover from a 413 when maxContextTokens is non-positive', () => {
      expect(
        shouldRecoverFromOverflowStatus({
          isContextOverflowError: false,
          isStatus413: true,
          estimatedRequestTokens: 200_000,
          maxContextTokens: 0,
          recoveryRatio: 0.9,
        }),
      ).toBe(false);
    });
  });

  describe('shouldUseParallelSummarize', () => {
    it('returns true when both token and message thresholds are exceeded', () => {
      expect(
        shouldUseParallelSummarize({
          compactedTokens: 20_000,
          messageCount: 8,
          parallelThreshold: 12_000,
        }),
      ).toBe(true);
    });

    it('returns false when compactedTokens is below the parallel threshold', () => {
      expect(
        shouldUseParallelSummarize({
          compactedTokens: 12_000,
          messageCount: 8,
          parallelThreshold: 12_000,
        }),
      ).toBe(false);
    });

    it('respects the custom minMessages floor', () => {
      expect(
        shouldUseParallelSummarize({
          compactedTokens: 20_000,
          messageCount: 4,
          parallelThreshold: 12_000,
          minMessages: 6,
        }),
      ).toBe(false);
    });

    it('uses the default minMessages floor of 4 when not overridden', () => {
      expect(
        shouldUseParallelSummarize({
          compactedTokens: 20_000,
          messageCount: 4,
          parallelThreshold: 12_000,
        }),
      ).toBe(false);
      expect(
        shouldUseParallelSummarize({
          compactedTokens: 20_000,
          messageCount: 5,
          parallelThreshold: 12_000,
        }),
      ).toBe(true);
    });
  });
});
