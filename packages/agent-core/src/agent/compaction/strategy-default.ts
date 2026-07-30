import type { Message } from '@superliora/kosong';

import { estimateTokensForMessage } from '../../utils/tokens';
import type { CompactionSource } from './types';
import {
  applyWorkingSetCap,
  DEFAULT_ABSOLUTE_TRIGGER_MIN_CONTEXT_TOKENS,
  DEFAULT_COMPACTION_CONFIG,
  recompactGrowthBaseTokens,
  type CompactionConfig,
} from './strategy-config';
import { canSplitAfter } from './strategy-split';
import type { CompactionStrategy } from './strategy-types';

/**
 * Cap for the quality trigger bias: the effective trigger ratio may move only
 * a small delta below the configured ratio, so backstop-heavy sessions cannot
 * ratchet compaction into a hair-trigger loop.
 */
const MAX_QUALITY_TRIGGER_BIAS = 0.02;

export class DefaultCompactionStrategy implements CompactionStrategy {
  private qualityTriggerBias = 0;

  constructor(
    protected readonly maxSizeProvider: () => number,
    protected readonly config: CompactionConfig = DEFAULT_COMPACTION_CONFIG
  ) { }

  protected get maxSize(): number {
    return this.maxSizeProvider();
  }

  get effectiveTriggerRatio(): number {
    return Math.max(0.01, this.config.triggerRatio - this.qualityTriggerBias);
  }

  get speculativeStepBufferTokens(): number {
    return this.config.speculativeStepBufferTokens;
  }

  get minRecompactGrowthRatio(): number {
    return this.config.minRecompactGrowthRatio;
  }

  applyQualityFeedback(input: {
    readonly recallEvalScore?: number | undefined;
    readonly usedEmergencyBackstop: boolean;
  }): number {
    if (input.usedEmergencyBackstop) {
      this.qualityTriggerBias = Math.min(MAX_QUALITY_TRIGGER_BIAS, this.qualityTriggerBias + 0.02);
    } else {
      // A clean (non-backstop) compaction shows the trigger is workable, so
      // always decay the bias. Decoupling decay from the recall score keeps
      // backstop-heavy sessions from permanently ratcheting the effective
      // trigger ratio downward.
      this.qualityTriggerBias = Math.max(0, this.qualityTriggerBias - 0.01);
    }
    return this.qualityTriggerBias;
  }

  shouldCompact(usedSize: number): boolean {
    if (this.maxSize <= 0) return false;
    return usedSize >= this.compactThreshold();
  }

  shouldAsyncCompact(usedSize: number): boolean {
    if (this.maxSize <= 0) return false;
    if (this.config.asyncTriggerRatio <= 0) return false;
    // Only start async compaction when we're above the async threshold but
    // below the synchronous trigger — once the sync trigger fires, the
    // regular blocking path takes over.
    return usedSize >= this.asyncCompactThreshold() && !this.shouldCompact(usedSize);
  }

  shouldSpeculativelyCompact(projectedUsedSize: number): boolean {
    if (this.maxSize <= 0) return false;
    return this.shouldCompact(projectedUsedSize);
  }

  shouldBlock(usedSize: number): boolean {
    if (this.maxSize <= 0) return false;
    // Floor the ratio threshold so densify floats like 0.56*100k don't leave a
    // phantom >56_000 gap between reserved-floor and hard-block paths.
    // Hard block stays ratio/reserved based — working-set caps do not block.
    const blockRatioThreshold = Math.floor(this.maxSize * this.config.blockRatio);
    return (
      (this.config.absoluteTriggerBlocks !== false && this.shouldTriggerAbsolute(usedSize)) ||
      usedSize >= blockRatioThreshold ||
      this.shouldBlockForReservedContext(usedSize)
    );
  }

  /**
   * Soft full-compact threshold: max(ratio, absoluteFloor) then min with
   * working-set cap. Cap never forces a threshold above the model window.
   * Non-finite ratios (overflow-only fixtures with Infinity) skip the cap path.
   */
  private compactThreshold(): number {
    const ratioThreshold = Math.floor(this.maxSize * this.effectiveTriggerRatio);
    if (!Number.isFinite(ratioThreshold)) {
      return ratioThreshold;
    }
    const absoluteFloor = this.resolveAbsoluteCompactThreshold();
    const floored =
      absoluteFloor === null ? ratioThreshold : Math.max(ratioThreshold, absoluteFloor);
    const capped = applyWorkingSetCap(floored, this.resolveMaxWorkingSetCap());
    // Cap must stay inside the window; if the cap is above the window it is a no-op.
    return Math.min(capped, this.maxSize);
  }

  private asyncCompactThreshold(): number {
    const ratioThreshold = Math.floor(this.maxSize * this.config.asyncTriggerRatio);
    if (!Number.isFinite(ratioThreshold) || ratioThreshold <= 0) {
      return ratioThreshold;
    }
    const softThreshold = this.compactThreshold();
    // Async must stay strictly below soft so the blocking path can take over.
    const asyncCap = this.resolveAsyncWorkingSetCap();
    const capped = applyWorkingSetCap(ratioThreshold, asyncCap);
    if (!Number.isFinite(softThreshold)) {
      return capped;
    }
    return Math.min(capped, Math.max(0, softThreshold - 1));
  }

  /**
   * Soft working-set ceiling. `0` disables. Caps above the model window are
   * ignored (ratio-only). Caps at/below the window clamp soft compact early.
   */
  private resolveMaxWorkingSetCap(): number | null {
    const cap = this.config.maxWorkingSetTokens;
    if (cap === undefined || cap <= 0) return null;
    if (cap >= this.maxSize) return null;
    return cap;
  }

  private resolveAsyncWorkingSetCap(): number | null {
    const cap = this.config.asyncWorkingSetTokens;
    if (cap === undefined || cap <= 0) return null;
    if (cap >= this.maxSize) return null;
    const softCap = this.resolveMaxWorkingSetCap();
    if (softCap !== null && cap >= softCap) {
      // Keep async strictly below soft when both caps are configured.
      return Math.max(1, softCap - 1);
    }
    return cap;
  }

  /**
   * Absolute *floor* for soft compact (legacy). When set, soft compact will not
   * fire before this many tokens even if the ratio threshold is lower.
   */
  private resolveAbsoluteCompactThreshold(): number | null {
    const absolute = this.config.absoluteTriggerTokens;
    const minContext =
      this.config.absoluteTriggerMinContextTokens ?? DEFAULT_ABSOLUTE_TRIGGER_MIN_CONTEXT_TOKENS;
    if (absolute <= 0 || this.maxSize < minContext || absolute > this.maxSize) return null;
    return absolute;
  }

  private shouldBlockForReservedContext(usedSize: number): boolean {
    const reservedSize = this.config.reservedContextSize;
    if (reservedSize <= 0 || reservedSize >= this.maxSize) return false;
    const reservedThreshold = this.maxSize - reservedSize;
    const blockRatioThreshold = Math.floor(this.maxSize * this.config.blockRatio);
    return usedSize >= Math.max(reservedThreshold, blockRatioThreshold);
  }

  private shouldTriggerAbsolute(usedSize: number): boolean {
    const absoluteThreshold = this.resolveAbsoluteCompactThreshold();
    if (absoluteThreshold === null) return false;
    return usedSize >= this.compactThreshold();
  }

  /** Working-set base used for recompact growth hysteresis. */
  get workingSetBaseTokens(): number {
    return recompactGrowthBaseTokens({
      maxContextTokens: this.maxSize,
      maxWorkingSetTokens: this.config.maxWorkingSetTokens,
    });
  }

  get maxWorkingSetTokens(): number {
    return this.config.maxWorkingSetTokens ?? 0;
  }

  get asyncWorkingSetTokens(): number {
    return this.config.asyncWorkingSetTokens ?? 0;
  }

  computeCompactCount(messages: readonly Message[], source: CompactionSource): number {
    // Return value: N messages to be compacted (0 means no compaction possible)
    // LLM Input: messages.slice(0, N) + [user:instruction]
    // Preserved recent messages: messages.slice(N)

    // Manual compaction: when no assistant/tool boundary exists, compact the full
    // prefix so applyCompaction can apply head/tail user-message retention.
    if (source === 'manual') {
      for (let i = messages.length - 1; i > 0; i--) {
        if (canSplitAfter(messages, i)) {
          return this.fitCompactCountToWindow(messages, i + 1);
        }
      }
      if (messages.length > 0) {
        return this.fitCompactCountToWindow(messages, messages.length);
      }
      return 0;
    }

    // Auto compaction rules (in order of precedence):
    // 1. The split after messages[N-1] must be safe per `canSplitAfter`:
    //    messages[N-1] is not a user or asst-with-tool-calls, and the retained
    //    suffix messages.slice(N) has no orphan tool result.
    // 2. At least one recent message must be preserved
    // 3. At most maxRecentMessages recent messages should be preserved
    // 4. At most maxRecentUserMessages recent user messages should be preserved
    // 5. At most maxRecentSizeRatio * maxSize recent messages should be preserved
    // 6. N should be as small as possible

    let recentMessages = 1;
    let recentUserMessages = 0;
    let recentSize = 0;
    let bestN: number | undefined;

    for (; recentMessages < messages.length; recentMessages++) {
      const splitIndex = messages.length - recentMessages - 1;
      const m2 = messages[messages.length - recentMessages]!;

      if (m2.role === 'user') {
        recentUserMessages++;
      }
      recentSize += estimateTokensForMessage(m2);

      if (canSplitAfter(messages, splitIndex)) {
        bestN = splitIndex + 1;
      }

      const reachesMax = recentMessages >= this.config.maxRecentMessages
        || recentUserMessages >= this.config.maxRecentUserMessages
        || recentSize >= this.maxSize * this.config.maxRecentSizeRatio;
      if (reachesMax && bestN !== undefined) {
        break;
      }
    }

    return this.fitCompactCountToWindow(messages, bestN ?? 0);
  }

  reduceCompactOnOverflow(messages: readonly Message[]): number {
    const minReducedSize = Math.max(
      1,
      Math.ceil(this.maxSize * this.config.minOverflowReductionRatio),
    );
    let reducedSize = 0;
    let bestN: number | undefined;

    for (let i = messages.length - 2; i > 0; i--) {
      reducedSize += estimateTokensForMessage(messages[i + 1]!);
      if (canSplitAfter(messages, i)) {
        bestN = i + 1;
        if (reducedSize >= minReducedSize) {
          return i + 1;
        }
      }
    }
    return bestN ?? messages.length;
  }

  private fitCompactCountToWindow(
    messages: readonly Message[],
    compactedCount: number,
  ): number {
    if (this.maxSize <= 0 || compactedCount <= 0) {
      return compactedCount;
    }

    let compactedSize = 0;
    for (let i = 0; i < compactedCount; i++) {
      compactedSize += estimateTokensForMessage(messages[i]!);
    }
    if (compactedSize <= this.maxSize) {
      return compactedCount;
    }

    let bestN: number | undefined;
    for (let n = compactedCount - 1; n > 0; n--) {
      compactedSize -= estimateTokensForMessage(messages[n]!);
      if (!canSplitAfter(messages, n - 1)) {
        continue;
      }
      bestN = n;
      if (compactedSize <= this.maxSize) {
        return n;
      }
    }

    return bestN ?? compactedCount;
  }

  get checkAfterStep(): boolean {
    return this.config.triggerRatio !== this.config.blockRatio;
  }

  get maxCompactionPerTurn(): number {
    return this.config.maxCompactionPerTurn;
  }

  get maxOverflowCompactionAttempts(): number {
    return this.config.maxOverflowCompactionAttempts;
  }

  get asyncTriggerRatio(): number {
    return this.config.asyncTriggerRatio;
  }

  get frozenZoneSize(): number {
    return this.config.frozenZoneSize;
  }

  get parallelBlockThreshold(): number {
    return this.config.parallelBlockThreshold;
  }

  get parallelBlockTarget(): number {
    return this.config.parallelBlockTarget;
  }

  get parallelBlockConcurrency(): number {
    return this.config.parallelBlockConcurrency ?? 0;
  }
}
