/**
 * Pure auto-compaction policy helpers (pre-rot / recompact growth / overflow).
 */

export function shouldSkipRecompactUntilGrowth(input: {
  readonly lastCompactedTokenCount: number | null;
  readonly tokenCountWithPending: number;
  readonly minGrowthRatio: number;
  readonly maxContextTokens: number;
}): boolean {
  if (input.lastCompactedTokenCount === null) return false;
  if (input.tokenCountWithPending <= input.lastCompactedTokenCount) {
    return true;
  }
  if (input.minGrowthRatio <= 0 || input.maxContextTokens <= 0) {
    return false;
  }
  const minGrowth = Math.floor(input.maxContextTokens * input.minGrowthRatio);
  return input.tokenCountWithPending - input.lastCompactedTokenCount < minGrowth;
}

export function shouldDeferAutoCompaction(input: {
  readonly ultraSwarmActive: boolean;
  readonly shouldBlock: boolean;
  readonly hasActiveForegroundChildren: boolean;
}): boolean {
  if (input.ultraSwarmActive) {
    if (input.shouldBlock) return false;
    return true;
  }
  return input.hasActiveForegroundChildren;
}

export function handoffThresholdTokens(input: {
  readonly maxTokens: number | undefined;
  readonly triggerRatio: number;
}): number | undefined {
  if (input.maxTokens === undefined || input.maxTokens <= 0) return undefined;
  return Math.floor(input.maxTokens * input.triggerRatio);
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

export function resolveEffectiveMaxContextTokens(input: {
  readonly configured: number;
  readonly observed: number | undefined;
}): number {
  if (input.observed === undefined) return input.configured;
  if (input.configured <= 0) return input.observed;
  return Math.min(input.configured, input.observed);
}

export function shouldRecoverFromOverflowStatus(input: {
  readonly isContextOverflowError: boolean;
  readonly isStatus413: boolean;
  readonly estimatedRequestTokens: number;
  readonly maxContextTokens: number;
  readonly recoveryRatio: number;
}): boolean {
  if (input.isContextOverflowError) return true;
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
