/**
 * Pure auto-compaction policy helpers (pre-rot / recompact growth / overflow).
 */

import { applyWorkingSetCap, recompactGrowthBaseTokens } from '../strategy';

export function shouldSkipRecompactUntilGrowth(input: {
  readonly lastCompactedTokenCount: number | null;
  readonly tokenCountWithPending: number;
  readonly minGrowthRatio: number;
  readonly maxContextTokens: number;
  /**
   * Optional soft working-set cap. When set, min growth is measured against
   * min(window, cap) so 1M models do not require ~50k growth before recompact.
   */
  readonly maxWorkingSetTokens?: number | null;
}): boolean {
  if (input.lastCompactedTokenCount === null) return false;
  if (input.tokenCountWithPending <= input.lastCompactedTokenCount) {
    return true;
  }
  if (input.minGrowthRatio <= 0 || input.maxContextTokens <= 0) {
    return false;
  }
  const growthBase = recompactGrowthBaseTokens({
    maxContextTokens: input.maxContextTokens,
    maxWorkingSetTokens: input.maxWorkingSetTokens,
  });
  const minGrowth = Math.floor(growthBase * input.minGrowthRatio);
  return input.tokenCountWithPending - input.lastCompactedTokenCount < minGrowth;
}

export function shouldDeferAutoCompaction(input: {
  readonly hasActiveForegroundChildren: boolean;
}): boolean {
  return input.hasActiveForegroundChildren;
}

export function shouldDeferAsyncCompaction(input: {
  readonly hasActiveForegroundChildren: boolean;
  readonly hasRunningConductorJobs: boolean;
}): boolean {
  return input.hasActiveForegroundChildren || input.hasRunningConductorJobs;
}

export function handoffThresholdTokens(input: {
  readonly maxTokens: number | undefined;
  readonly triggerRatio: number;
  /** Optional absolute ceiling for pre-swarm handoff reclaim. */
  readonly maxWorkingSetTokens?: number | null;
}): number | undefined {
  if (input.maxTokens === undefined || input.maxTokens <= 0) return undefined;
  const ratioThreshold = Math.floor(input.maxTokens * input.triggerRatio);
  return applyWorkingSetCap(ratioThreshold, input.maxWorkingSetTokens);
}

export function relaxObservedMaxContextTokens(input: {
  readonly observed: number;
  readonly configured: number;
  readonly decayPerTurn: number;
}): number {
  if (input.configured <= 0 || input.observed >= input.configured) return input.observed;
  const gap = input.configured - input.observed;
  const relaxed = input.observed + Math.ceil(gap * input.decayPerTurn);
  return Math.min(input.configured, relaxed);
}

/**
 * Floor applied to unstated overflow observations when rewriting the session
 * ceiling. Short fixtures (and one-shot false-positive overflows) would
 * otherwise collapse the budget to tens of tokens and thrash multi-round
 * compaction under a synthetic block threshold. Provider-stated limits still
 * win as-is (after the safety ratio).
 */
export const MIN_OBSERVED_MAX_CONTEXT_TOKENS = 4_096;

export function resolveEffectiveMaxContextTokens(input: {
  readonly configured: number;
  readonly observed: number | undefined;
}): number {
  if (input.observed === undefined) return input.configured;
  if (input.configured <= 0) return input.observed;
  return Math.min(input.configured, input.observed);
}

/**
 * Clamp an overflow-derived observation so tiny unstated estimates cannot
 * collapse the ceiling to tens of tokens (multi-round thrash), while still
 * always allowing a real tighten step against the current effective max.
 *
 * Provider-stated limits are used as-is (after the safety ratio). Unstated
 * estimates are floored to min(MIN_OBSERVED, currentEffective - 1) so short
 * fixtures still tighten a large window without overshooting a small one.
 */
export function clampObservedOverflowTokens(input: {
  readonly observed: number;
  readonly currentEffective: number;
  readonly statedLimitTokens?: number;
}): number {
  const observed = Math.max(1, Math.floor(input.observed));
  if (
    input.statedLimitTokens !== undefined &&
    Number.isFinite(input.statedLimitTokens) &&
    input.statedLimitTokens > 0
  ) {
    return observed;
  }
  if (!(input.currentEffective > 1)) {
    return Math.max(observed, MIN_OBSERVED_MAX_CONTEXT_TOKENS);
  }
  const floor = Math.min(
    MIN_OBSERVED_MAX_CONTEXT_TOKENS,
    Math.max(1, input.currentEffective - 1),
  );
  return Math.max(observed, floor);
}

export function shouldRecoverFromOverflowStatus(input: {
  readonly isContextOverflowError: boolean;
  readonly isStatus413: boolean;
  /**
   * True when the status/message pair matches known prompt-limit overflow
   * shapes (including non-413 400s such as "maximum prompt length is N").
   */
  readonly isOverflowStatusMessage?: boolean;
  readonly estimatedRequestTokens: number;
  readonly maxContextTokens: number;
  readonly recoveryRatio: number;
}): boolean {
  if (input.isContextOverflowError) return true;
  if (input.isOverflowStatusMessage === true) return true;
  if (!input.isStatus413) return false;
  return (
    input.maxContextTokens > 0 &&
    input.estimatedRequestTokens >= input.maxContextTokens * input.recoveryRatio
  );
}

export function shouldUseParallelSummarize(input: {
  readonly compactedTokens: number;
  readonly messageCount: number;
  readonly parallelThreshold: number;
  readonly minMessages?: number;
}): boolean {
  const minMessages = input.minMessages ?? 4;
  return (
    input.compactedTokens > input.parallelThreshold &&
    input.messageCount > minMessages
  );
}
