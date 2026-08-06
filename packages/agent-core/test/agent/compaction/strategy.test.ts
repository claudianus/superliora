import { describe, expect, it } from 'vitest';

import {
  DefaultCompactionStrategy,
  DEFAULT_ASYNC_COMPACTION_TRIGGER_RATIO,
  DEFAULT_COMPACTION_BLOCK_RATIO,
  DEFAULT_COMPACTION_CONFIG,
  DEFAULT_COMPACTION_TRIGGER_RATIO,
  DEFAULT_MAX_WORKING_SET_TOKENS,
  DEFAULT_MICRO_WORKING_SET_TOKENS,
  SWARM_HANDOFF_COMPACTION_RATIO,
  SWARM_MICRO_PRESSURE_RATIO,
  applyWorkingSetCap,
  defaultAsyncTriggerRatioForWindow,
  defaultAsyncWorkingSetTokensForWindow,
  defaultMaxWorkingSetTokensForWindow,
  defaultMicroWorkingSetTokensForWindow,
  defaultTriggerRatioForWindow,
  microPressureThresholdTokens,
  recompactGrowthBaseTokens,
  resolveCompactionBlockRatio,
} from '../../../src/agent/compaction/strategy';

describe('strategy.ts — pure helpers', () => {
  describe('applyWorkingSetCap', () => {
    it('returns the ratio threshold unchanged when the cap is missing/0/negative', () => {
      expect(applyWorkingSetCap(1234, undefined)).toBe(1234);
      expect(applyWorkingSetCap(1234, null)).toBe(1234);
      expect(applyWorkingSetCap(1234, 0)).toBe(1234);
      expect(applyWorkingSetCap(1234, -1)).toBe(1234);
    });

    it('clamps the ratio threshold to the cap when the cap is positive', () => {
      expect(applyWorkingSetCap(1_000_000, 256_000)).toBe(256_000);
      expect(applyWorkingSetCap(100, 256_000)).toBe(100);
    });
  });

  describe('recompactGrowthBaseTokens', () => {
    it('returns 0 for non-positive maxContextTokens', () => {
      expect(recompactGrowthBaseTokens({ maxContextTokens: 0 })).toBe(0);
      expect(recompactGrowthBaseTokens({ maxContextTokens: -1 })).toBe(0);
    });

    it('returns maxContextTokens when the working-set cap is disabled', () => {
      expect(
        recompactGrowthBaseTokens({ maxContextTokens: 1_000_000, maxWorkingSetTokens: 0 }),
      ).toBe(1_000_000);
      expect(
        recompactGrowthBaseTokens({ maxContextTokens: 1_000_000, maxWorkingSetTokens: undefined }),
      ).toBe(1_000_000);
    });

    it('clamps to the cap when the cap is below the model window', () => {
      expect(
        recompactGrowthBaseTokens({
          maxContextTokens: 1_000_000,
          maxWorkingSetTokens: 256_000,
        }),
      ).toBe(256_000);
    });

    it('ignores a cap that exceeds the model window', () => {
      expect(
        recompactGrowthBaseTokens({
          maxContextTokens: 100_000,
          maxWorkingSetTokens: 256_000,
        }),
      ).toBe(100_000);
    });
  });

  describe('window-aware default ratios', () => {
    it('returns the small-window default for windows below the threshold', () => {
      expect(defaultTriggerRatioForWindow(64_000)).toBe(DEFAULT_COMPACTION_TRIGGER_RATIO);
      // 128k is the documented large-window threshold: the default flips
      // to the large-window ratio at the boundary, not just past it.
      expect(defaultTriggerRatioForWindow(127_999)).toBe(DEFAULT_COMPACTION_TRIGGER_RATIO);
    });

    it('raises the soft-trigger default on large windows while staying below the hard block', () => {
      const ratio = defaultTriggerRatioForWindow(1_000_000);
      expect(ratio).toBeGreaterThan(DEFAULT_COMPACTION_TRIGGER_RATIO);
      expect(ratio).toBeLessThan(DEFAULT_COMPACTION_BLOCK_RATIO);
    });

    it('keeps the async default strictly below the sync default for the same window', () => {
      const small = defaultAsyncTriggerRatioForWindow(64_000);
      const smallSync = defaultTriggerRatioForWindow(64_000);
      expect(small).toBeLessThan(smallSync);

      const large = defaultAsyncTriggerRatioForWindow(1_000_000);
      const largeSync = defaultTriggerRatioForWindow(1_000_000);
      expect(large).toBeLessThan(largeSync);
    });
  });

  describe('window-aware working-set caps', () => {
    it('disables the soft cap when the window is at/below the default', () => {
      expect(defaultMaxWorkingSetTokensForWindow(0)).toBe(0);
      expect(defaultMaxWorkingSetTokensForWindow(64_000)).toBe(0);
      expect(defaultMaxWorkingSetTokensForWindow(262_144)).toBe(0);
    });

    it('returns the default soft cap for large windows', () => {
      expect(defaultMaxWorkingSetTokensForWindow(1_000_000)).toBe(DEFAULT_MAX_WORKING_SET_TOKENS);
    });

    it('keeps the async cap strictly below the soft cap when both apply', () => {
      const soft = defaultMaxWorkingSetTokensForWindow(1_000_000);
      const asyncCap = defaultAsyncWorkingSetTokensForWindow(1_000_000);
      expect(asyncCap).toBeGreaterThan(0);
      expect(asyncCap).toBeLessThan(soft);
    });

    it('disables the async and micro caps when the soft cap is disabled', () => {
      expect(defaultAsyncWorkingSetTokensForWindow(64_000)).toBe(0);
      expect(defaultMicroWorkingSetTokensForWindow(64_000)).toBe(0);
    });

    it('returns the micro working-set cap for large windows', () => {
      expect(defaultMicroWorkingSetTokensForWindow(1_000_000)).toBe(DEFAULT_MICRO_WORKING_SET_TOKENS);
    });
  });

  describe('microPressureThresholdTokens', () => {
    it('returns 0 for a non-positive model window', () => {
      expect(
        microPressureThresholdTokens({ maxContextTokens: 0, minContextUsageRatio: 0.4 }),
      ).toBe(0);
    });

    it('floors the ratio threshold and applies an optional working-set cap', () => {
      // 1M * 0.4 = 400_000, but the cap pulls it down to 140k.
      const th = microPressureThresholdTokens({
        maxContextTokens: 1_000_000,
        minContextUsageRatio: SWARM_MICRO_PRESSURE_RATIO,
        maxWorkingSetTokens: 140_000,
      });
      expect(th).toBe(140_000);
    });

    it('keeps the ratio threshold when no cap is configured', () => {
      const th = microPressureThresholdTokens({
        maxContextTokens: 256_000,
        minContextUsageRatio: 0.5,
      });
      expect(th).toBe(128_000);
    });
  });

  describe('resolveCompactionBlockRatio', () => {
    it('returns the configured value when provided', () => {
      expect(resolveCompactionBlockRatio(0.7, 0.95)).toBe(0.95);
    });

    it('returns max(default, trigger+0.05) when no override is provided', () => {
      expect(resolveCompactionBlockRatio(0.7)).toBeCloseTo(0.9, 5);
      expect(resolveCompactionBlockRatio(0.95)).toBeCloseTo(1.0, 5);
    });
  });

  describe('window-aware swarm ratios', () => {
    it('pins SWARM_HANDOFF_COMPACTION_RATIO and SWARM_MICRO_PRESSURE_RATIO to their declared defaults', () => {
      // Sanity: the handoff and micro-pressure ratios stay well below the
      // sync soft trigger so background reclaim never races the blocking
      // path.
      expect(SWARM_HANDOFF_COMPACTION_RATIO).toBe(0.65);
      expect(SWARM_MICRO_PRESSURE_RATIO).toBe(0.4);
      expect(SWARM_HANDOFF_COMPACTION_RATIO).toBeLessThan(DEFAULT_COMPACTION_TRIGGER_RATIO);
      expect(SWARM_MICRO_PRESSURE_RATIO).toBeLessThan(SWARM_HANDOFF_COMPACTION_RATIO);
    });
  });

  describe('DEFAULT_COMPACTION_CONFIG invariants', () => {
    it('keeps asyncTriggerRatio below the sync triggerRatio', () => {
      expect(DEFAULT_COMPACTION_CONFIG.asyncTriggerRatio).toBeLessThan(
        DEFAULT_COMPACTION_CONFIG.triggerRatio,
      );
      expect(DEFAULT_COMPACTION_CONFIG.asyncTriggerRatio).toBe(
        DEFAULT_ASYNC_COMPACTION_TRIGGER_RATIO,
      );
    });

    it('keeps asyncWorkingSetTokens strictly below maxWorkingSetTokens when both are enabled', () => {
      expect(DEFAULT_COMPACTION_CONFIG.asyncWorkingSetTokens).toBeGreaterThan(0);
      expect(DEFAULT_COMPACTION_CONFIG.maxWorkingSetTokens).toBeGreaterThan(
        DEFAULT_COMPACTION_CONFIG.asyncWorkingSetTokens,
      );
    });

    it('keeps blockRatio strictly above triggerRatio', () => {
      expect(DEFAULT_COMPACTION_CONFIG.blockRatio).toBeGreaterThan(
        DEFAULT_COMPACTION_CONFIG.triggerRatio,
      );
    });

  });
});

describe('DefaultCompactionStrategy — threshold logic', () => {
  it('never compacts or blocks when maxSize is non-positive', () => {
    const s = new DefaultCompactionStrategy(() => 0, DEFAULT_COMPACTION_CONFIG);
    expect(s.shouldCompact(999_999)).toBe(false);
    expect(s.shouldAsyncCompact(999_999)).toBe(false);
    expect(s.shouldBlock(999_999)).toBe(false);
  });

  it('fires shouldCompact at the ratio threshold and shouldBlock at the block ratio', () => {
    const s = new DefaultCompactionStrategy(() => 200_000, {
      ...DEFAULT_COMPACTION_CONFIG,
      triggerRatio: 0.7,
      blockRatio: 0.9,
    });
    // ratio threshold = floor(200_000 * 0.7) = 140_000
    expect(s.shouldCompact(139_999)).toBe(false);
    expect(s.shouldCompact(140_000)).toBe(true);
    // block threshold = floor(200_000 * 0.9) = 180_000
    expect(s.shouldBlock(179_999)).toBe(false);
    expect(s.shouldBlock(180_000)).toBe(true);
  });

  it('caps the soft threshold with maxWorkingSetTokens when the cap is below the ratio', () => {
    const s = new DefaultCompactionStrategy(() => 1_000_000, {
      ...DEFAULT_COMPACTION_CONFIG,
      triggerRatio: 0.7,
      maxWorkingSetTokens: 200_000,
    });
    // ratio = 700_000, but cap pulls soft to 200_000.
    expect(s.shouldCompact(199_999)).toBe(false);
    expect(s.shouldCompact(200_000)).toBe(true);
  });

  it('fires shouldAsyncCompact only between the async and sync thresholds', () => {
    const s = new DefaultCompactionStrategy(() => 200_000, {
      ...DEFAULT_COMPACTION_CONFIG,
      triggerRatio: 0.7,
      blockRatio: 0.9,
      asyncTriggerRatio: 0.5,
    });
    // async threshold = floor(200_000 * 0.5) = 100_000
    // sync threshold = 140_000
    expect(s.shouldAsyncCompact(99_999)).toBe(false);
    expect(s.shouldAsyncCompact(100_000)).toBe(true);
    // once sync fires, async must not fire alongside it
    expect(s.shouldAsyncCompact(140_000)).toBe(false);
  });

  it('disables async compaction when asyncTriggerRatio is 0', () => {
    const s = new DefaultCompactionStrategy(() => 200_000, {
      ...DEFAULT_COMPACTION_CONFIG,
      asyncTriggerRatio: 0,
    });
    expect(s.shouldAsyncCompact(200_000)).toBe(false);
  });

  it('uses the reserved-context path to block before the hard ratio when reserved is larger', () => {
    const s = new DefaultCompactionStrategy(() => 200_000, {
      ...DEFAULT_COMPACTION_CONFIG,
      triggerRatio: 0.7,
      blockRatio: 0.9,
      reservedContextSize: 60_000,
    });
    // block ratio = 180_000; reserved threshold = 200_000 - 60_000 = 140_000;
    // shouldBlockForReservedContext fires at max(140_000, 180_000) = 180_000.
    expect(s.shouldBlock(179_999)).toBe(false);
    expect(s.shouldBlock(180_000)).toBe(true);
  });

  it('clamps quality-bias ratchet between 0 and MAX_QUALITY_TRIGGER_BIAS (0.02)', () => {
    const s = new DefaultCompactionStrategy(() => 200_000, DEFAULT_COMPACTION_CONFIG);
    // First backstop: +0.02 → 0.02
    expect(
      s.applyQualityFeedback({ usedEmergencyBackstop: true, recallEvalScore: 0.5 }),
    ).toBeCloseTo(0.02, 5);
    // Second backstop: already at cap, stays at 0.02
    expect(s.applyQualityFeedback({ usedEmergencyBackstop: true })).toBeCloseTo(0.02, 5);
    // Clean compaction: -0.01 → 0.01
    expect(s.applyQualityFeedback({ usedEmergencyBackstop: false })).toBeCloseTo(0.01, 5);
    // Decay all the way to 0, not below
    expect(s.applyQualityFeedback({ usedEmergencyBackstop: false })).toBe(0);
    expect(s.applyQualityFeedback({ usedEmergencyBackstop: false })).toBe(0);
  });

  it('lowers the effective trigger ratio by the quality bias (clamped to 0.01)', () => {
    const s = new DefaultCompactionStrategy(() => 200_000, {
      ...DEFAULT_COMPACTION_CONFIG,
      triggerRatio: 0.7,
    });
    s.applyQualityFeedback({ usedEmergencyBackstop: true });
    // effective = max(0.01, 0.7 - 0.02) = 0.68
    expect(s.effectiveTriggerRatio).toBeCloseTo(0.68, 5);
  });

  it('reflects the maxWorkingSetTokens base in workingSetBaseTokens', () => {
    const s = new DefaultCompactionStrategy(() => 1_000_000, {
      ...DEFAULT_COMPACTION_CONFIG,
      maxWorkingSetTokens: 256_000,
    });
    expect(s.workingSetBaseTokens).toBe(256_000);
  });

  it('exposes a positive parallelBlockThreshold that is at least the parallelBlockTarget', () => {
    const cfg = DEFAULT_COMPACTION_CONFIG;
    expect(cfg.parallelBlockThreshold).toBeGreaterThan(0);
    expect(cfg.parallelBlockTarget).toBeGreaterThan(0);
    expect(cfg.parallelBlockThreshold).toBeGreaterThanOrEqual(cfg.parallelBlockTarget);
  });
});
