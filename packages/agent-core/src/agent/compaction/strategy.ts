import type { Message } from '@superliora/kosong';
import { estimateTokensForMessage } from '../../utils/tokens';
import type { CompactionSource } from './types';

export interface CompactionConfig {
  triggerRatio: number;
  blockRatio: number;
  reservedContextSize: number;
  maxCompactionPerTurn: number;
  maxOverflowCompactionAttempts: number;
  maxRecentMessages: number;
  maxRecentUserMessages: number;
  maxRecentSizeRatio: number;
  minOverflowReductionRatio: number;
  absoluteTriggerTokens: number;
  absoluteTriggerMinContextTokens?: number;
  parallelBlockThreshold: number;
  parallelBlockTarget: number;
  absoluteTriggerBlocks?: boolean;
  speculativeStepBufferTokens: number;
  minRecompactGrowthRatio: number;
  /**
   * Lower ratio at which background (async) compaction may start while the
   * turn keeps running. The regular `triggerRatio` stays the synchronous
   * threshold. Only consulted when async compaction is enabled.
   */
  asyncTriggerRatio: number;
  /**
   * Number of leading messages (system + initial user) kept in a frozen zone
   * that is never included in the compacted prefix. Defaults to 2.
   */
  frozenZoneSize: number;
}

export function resolveCompactionBlockRatio(
  triggerRatio: number,
  configuredBlockRatio?: number,
): number {
  if (configuredBlockRatio !== undefined) return configuredBlockRatio;
  return Math.max(DEFAULT_COMPACTION_BLOCK_RATIO, triggerRatio + 0.05);
}

const DEFAULT_ABSOLUTE_TRIGGER_MIN_CONTEXT_TOKENS = 256_000;

/**
 * Soft trigger for full (lossy) compaction.
 * Compact before attention rot: 0.26 sits between async pre-rot (~0.14) /
 * swarm handoff (~0.28) and hard block (~0.58), so summaries generate while
 * the model still attends well. Async path still starts earlier via asyncTriggerRatio.
 */
export const DEFAULT_COMPACTION_TRIGGER_RATIO = 0.26;
/** Hard block near the window; leaves headroom for compaction summary output. */
export const DEFAULT_COMPACTION_BLOCK_RATIO = 0.58;
/** Estimated tokens the next agent step may add for speculative pre-turn compaction (lean default). */
export const DEFAULT_SPECULATIVE_STEP_BUFFER_TOKENS = 800;
/** Minimum context growth since the last compaction before auto may fire again. */
export const DEFAULT_MIN_RECOMPACT_GROWTH_RATIO = 0.010;
/** Pre-swarm handoff compaction target (below soft trigger; aligned with async pre-rot headroom). */
export const SWARM_HANDOFF_COMPACTION_RATIO = 0.28;
/**
 * During UltraSwarm, allow micro (tool-result) clearing from this usage ratio.
 * Observation masking / tool-result clearing is preferred over full summarization
 * for cost and fidelity; start at async pre-rot (~0.14) before soft trigger.
 */
export const SWARM_MICRO_PRESSURE_RATIO = 0.14;
/** Default ratio at which async background compaction may start (pre-rot). */
export const DEFAULT_ASYNC_COMPACTION_TRIGGER_RATIO = 0.14;
/** Default number of leading messages (system + initial user) kept frozen. */
export const DEFAULT_FROZEN_ZONE_SIZE = 2;
const MAX_QUALITY_TRIGGER_BIAS = 0.05;

export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  triggerRatio: DEFAULT_COMPACTION_TRIGGER_RATIO,
  blockRatio: DEFAULT_COMPACTION_BLOCK_RATIO,
  reservedContextSize: 8_000,
  maxCompactionPerTurn: Infinity,
  maxOverflowCompactionAttempts: 3,
  maxRecentMessages: 2,
  maxRecentUserMessages: Infinity,
  maxRecentSizeRatio: 0.03,
  minOverflowReductionRatio: 0.05,
  absoluteTriggerTokens: 42_000,
  absoluteTriggerMinContextTokens: DEFAULT_ABSOLUTE_TRIGGER_MIN_CONTEXT_TOKENS,
  parallelBlockThreshold: 6_000,
  parallelBlockTarget: 3_000,
  speculativeStepBufferTokens: DEFAULT_SPECULATIVE_STEP_BUFFER_TOKENS,
  minRecompactGrowthRatio: DEFAULT_MIN_RECOMPACT_GROWTH_RATIO,
  asyncTriggerRatio: DEFAULT_ASYNC_COMPACTION_TRIGGER_RATIO,
  frozenZoneSize: DEFAULT_FROZEN_ZONE_SIZE,
};

export interface CompactionStrategy {
  shouldCompact(usedSize: number): boolean;
  shouldBlock(usedSize: number): boolean;
  shouldAsyncCompact(usedSize: number): boolean;
  computeCompactCount(messages: readonly Message[], source: CompactionSource): number;
  reduceCompactOnOverflow(messages: readonly Message[]): number;
  readonly checkAfterStep: boolean;
  readonly maxCompactionPerTurn: number;
  readonly maxOverflowCompactionAttempts: number;
  readonly parallelBlockThreshold?: number;
  readonly parallelBlockTarget?: number;
  readonly minRecompactGrowthRatio?: number;
  readonly asyncTriggerRatio: number;
  readonly frozenZoneSize: number;
}

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
    return Math.max(0.24, this.config.triggerRatio - this.qualityTriggerBias);
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
    } else if (
      input.recallEvalScore !== undefined &&
      input.recallEvalScore >= 0.9
    ) {
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
    const asyncThreshold = Math.floor(this.maxSize * this.config.asyncTriggerRatio);
    return usedSize >= asyncThreshold && !this.shouldCompact(usedSize);
  }

  shouldSpeculativelyCompact(projectedUsedSize: number): boolean {
    if (this.maxSize <= 0) return false;
    return this.shouldCompact(projectedUsedSize);
  }

  shouldBlock(usedSize: number): boolean {
    if (this.maxSize <= 0) return false;
    return (
      (this.config.absoluteTriggerBlocks !== false && this.shouldTriggerAbsolute(usedSize)) ||
      usedSize >= this.maxSize * this.config.blockRatio ||
      this.shouldBlockForReservedContext(usedSize)
    );
  }

  private compactThreshold(): number {
    const ratioThreshold = Math.floor(this.maxSize * this.effectiveTriggerRatio);
    const absoluteThreshold = this.resolveAbsoluteCompactThreshold();
    if (absoluteThreshold === null) return ratioThreshold;
    return Math.max(ratioThreshold, absoluteThreshold);
  }

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
}

export class PipelineStrategy implements CompactionStrategy {
  constructor(
    private readonly strategies: readonly CompactionStrategy[],
    private readonly trigger: CompactionStrategy,
  ) {}

  shouldCompact(usedSize: number): boolean {
    return this.trigger.shouldCompact(usedSize);
  }

  shouldBlock(usedSize: number): boolean {
    return this.trigger.shouldBlock(usedSize);
  }

  shouldAsyncCompact(usedSize: number): boolean {
    return this.trigger.shouldAsyncCompact(usedSize);
  }

  computeCompactCount(messages: readonly Message[], source: CompactionSource): number {
    let count = this.trigger.computeCompactCount(messages, source);
    for (const strategy of this.strategies) {
      if (count <= 0) break;
      // 0 from a secondary strategy means "no additional constraint", not "compact nothing".
      const constrained = strategy.computeCompactCount(messages, source);
      if (constrained > 0) {
        count = Math.min(count, constrained);
      }
    }
    return count;
  }

  reduceCompactOnOverflow(messages: readonly Message[]): number {
    let count = this.trigger.reduceCompactOnOverflow(messages);
    for (const strategy of this.strategies) {
      if (count <= 1) break;
      const constrained = strategy.reduceCompactOnOverflow(messages);
      if (constrained > 0) {
        count = Math.min(count, constrained);
      }
    }
    return count;
  }

  get checkAfterStep(): boolean {
    return this.trigger.checkAfterStep;
  }

  get maxCompactionPerTurn(): number {
    return this.trigger.maxCompactionPerTurn;
  }

  get maxOverflowCompactionAttempts(): number {
    return this.trigger.maxOverflowCompactionAttempts;
  }

  get asyncTriggerRatio(): number {
    return this.trigger.asyncTriggerRatio;
  }

  get frozenZoneSize(): number {
    return this.trigger.frozenZoneSize;
  }

  /** Forward to DefaultCompactionStrategy trigger when present (Pipeline-safe). */
  get speculativeStepBufferTokens(): number {
    if (this.trigger instanceof DefaultCompactionStrategy) {
      return this.trigger.speculativeStepBufferTokens;
    }
    return DEFAULT_COMPACTION_CONFIG.speculativeStepBufferTokens;
  }

  get minRecompactGrowthRatio(): number {
    if (this.trigger instanceof DefaultCompactionStrategy) {
      return this.trigger.minRecompactGrowthRatio;
    }
    return DEFAULT_COMPACTION_CONFIG.minRecompactGrowthRatio;
  }

  shouldSpeculativelyCompact(projectedUsedSize: number): boolean {
    if (this.trigger instanceof DefaultCompactionStrategy) {
      return this.trigger.shouldSpeculativelyCompact(projectedUsedSize);
    }
    return this.trigger.shouldCompact(projectedUsedSize);
  }

  applyQualityFeedback(input: {
    readonly recallEvalScore?: number | undefined;
    readonly usedEmergencyBackstop: boolean;
  }): number {
    if (this.trigger instanceof DefaultCompactionStrategy) {
      return this.trigger.applyQualityFeedback(input);
    }
    return 0;
  }
}

export class ToolCollapseStrategy implements CompactionStrategy {
  /**
   * Keep the last N tool-call groups fully intact (observation masking).
   * Default 2 retains the current exchange plus one prior group so the model
   * can still ground on the immediately previous tool result (context-engineering
   * keep-window practice; JetBrains observation masking).
   *
   * NOTE: `computeCompactCount` returns 0 when there is nothing older to
   * collapse. PipelineStrategy treats 0 as "no additional constraint".
   * Live tool-result clearing remains owned by MicroCompaction (usage-primary);
   * this strategy only bounds how far full compaction may cut into recent tool groups.
   */
  constructor(
    private readonly keepRecentToolGroups: number = 2,
  ) {}

  shouldCompact(): boolean { return true; }
  shouldBlock(): boolean { return false; }
  shouldAsyncCompact(): boolean { return false; }
  checkAfterStep = false;
  maxCompactionPerTurn = Infinity;
  maxOverflowCompactionAttempts = 3;
  asyncTriggerRatio = 0;
  frozenZoneSize = 0;

  computeCompactCount(messages: readonly Message[], _source: CompactionSource): number {
    let toolGroupsSeen = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]!;
      if (m.role === 'assistant' && m.toolCalls.length > 0) {
        toolGroupsSeen++;
        if (toolGroupsSeen > this.keepRecentToolGroups) {
          let end = i;
          for (let j = i + 1; j < messages.length && messages[j]!.role === 'tool'; j++) {
            end = j;
          }
          return end + 1;
        }
      }
    }
    return 0;
  }

  reduceCompactOnOverflow(messages: readonly Message[]): number {
    return this.computeCompactCount(messages, 'auto');
  }
}

export class SlidingWindowStrategy implements CompactionStrategy {
  constructor(
    private readonly keepLastGroups: number = 20,
  ) {}

  shouldCompact(): boolean { return true; }
  shouldBlock(): boolean { return false; }
  shouldAsyncCompact(): boolean { return false; }
  checkAfterStep = false;
  maxCompactionPerTurn = Infinity;
  maxOverflowCompactionAttempts = 3;
  asyncTriggerRatio = 0;
  frozenZoneSize = 0;

  computeCompactCount(messages: readonly Message[], _source: CompactionSource): number {
    let groupsKept = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]!;
      if (m.role !== 'system') {
        groupsKept++;
        if (groupsKept >= this.keepLastGroups) {
          for (let j = i - 1; j >= 0; j--) {
            if (canSplitAfter(messages, j)) {
              return j + 1;
            }
          }
          return i;
        }
      }
    }
    return 0;
  }

  reduceCompactOnOverflow(messages: readonly Message[]): number {
    return this.computeCompactCount(messages, 'auto');
  }
}

/**
 * Decide whether a compaction split is safe to place immediately after
 * `messages[index]`. A split is safe only when:
 *   - `messages[index]` itself is not a user message or an assistant message
 *     with pending tool calls (cutting either of those off from what follows
 *     would break the conversation), AND
 *   - the next message is not a tool result. The history is well-formed:
 *     tool results only appear after their owning `asst_w_tc` and all tool
 *     results for one exchange land consecutively before the next non-tool
 *     message. So if the suffix starts with a tool result, its `asst_w_tc`
 *     must be in the compacted prefix, which would orphan that result
 *     (e.g. splitting between tool_a and tool_b of a parallel call), AND
 *   - the compacted prefix itself does not end with an unresolved tool
 *     exchange, because pending tool results must remain in the retained tail.
 */
function canSplitAfter(messages: readonly Message[], index: number): boolean {
  const m = messages[index];
  if (m === undefined) return false;
  if (m.role === 'user') return false;
  if (m.role === 'assistant' && m.toolCalls.length > 0) return false;
  if (messages[index + 1]?.role === 'tool') return false;
  if (prefixEndsWithOpenToolExchange(messages, index)) return false;
  return true;
}

function prefixEndsWithOpenToolExchange(messages: readonly Message[], index: number): boolean {
  if (messages[index]?.role !== 'tool') return false;

  let toolResultCount = 0;
  for (let i = index; i >= 0; i--) {
    const message = messages[i];
    if (message === undefined) return false;
    if (message.role === 'tool') {
      toolResultCount++;
      continue;
    }
    return message.role === 'assistant' && message.toolCalls.length > toolResultCount;
  }
  return false;
}
