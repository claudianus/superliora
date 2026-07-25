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
  /**
   * Absolute *floor* for soft compact (legacy / explicit opt-in).
   * When set, soft compact will not fire before this many tokens even if the
   * ratio threshold is lower. Prefer `maxWorkingSetTokens` for large-window caps.
   */
  absoluteTriggerTokens: number;
  absoluteTriggerMinContextTokens?: number;
  parallelBlockThreshold: number;
  parallelBlockTarget: number;
  absoluteTriggerBlocks?: boolean;
  speculativeStepBufferTokens: number;
  minRecompactGrowthRatio: number;
  /**
   * Soft *ceiling* for full compaction on large windows (tokens).
   * Effective soft threshold is `min(ratio * window, maxWorkingSetTokens)`.
   * `0` disables the cap. Defaults keep agent working sets near ~256k even on
   * 1M-class models (cost + lost-in-the-middle / effective-context limits).
   */
  maxWorkingSetTokens: number;
  /**
   * Soft *ceiling* for async (pre-rot) compaction. Must stay ≤ soft working-set
   * cap when both are enabled. `0` disables.
   */
  asyncWorkingSetTokens: number;
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
 *
 * Industry / paper guidance (MemGPT-style hierarchical memory, lost-in-the-middle,
 * long-horizon agent compaction): keep a useful working set, then summarize with
 * headroom left for the summary call itself.
 *
 * Soft 0.70 sits above the kept-user budget (`COMPACT_USER_MESSAGE_WINDOW_RATIO`
 * 0.15 and `COMPACT_USER_MESSAGE_MAX_TOKENS` 16k) so post-compaction residual
 * cannot immediately re-arm auto-compact (the old 0.08 default hit ~20k on a
 * 256k window and looped forever). Async pre-rot and micro clearing still run
 * earlier; hard block stays near the ceiling.
 *
 * On 1M-class windows, ratio alone would wait until ~800k tokens — past the
 * practical quality/cost knee. `maxWorkingSetTokens` (~256k) caps the soft path
 * so advertised context size ≠ agent working set.
 */
export const DEFAULT_COMPACTION_TRIGGER_RATIO = 0.70;
/** Hard block near the window; leaves headroom for compaction summary output. */
export const DEFAULT_COMPACTION_BLOCK_RATIO = 0.90;
/** Estimated tokens the next agent step may add for speculative pre-turn compaction. */
export const DEFAULT_SPECULATIVE_STEP_BUFFER_TOKENS = 2_000;
/**
 * Minimum context growth since the last compaction before auto may fire again.
 * Applied against the working-set base (not the full advertised window) so 1M
 * models do not require ~50k growth before recompact can arm again.
 */
export const DEFAULT_MIN_RECOMPACT_GROWTH_RATIO = 0.05;
/** Pre-swarm handoff ceiling: force reclaim before UltraSwarm if usage is above this ratio. */
export const SWARM_HANDOFF_COMPACTION_RATIO = 0.65;
/**
 * During UltraSwarm, allow micro (tool-result) clearing from this usage ratio.
 * Observation masking / tool-result clearing is preferred over full summarization
 * for cost and fidelity; start well before soft trigger.
 */
export const SWARM_MICRO_PRESSURE_RATIO = 0.40;
/** Default ratio at which async background compaction may start (pre-rot). */
export const DEFAULT_ASYNC_COMPACTION_TRIGGER_RATIO = 0.55;
/**
 * Default soft working-set ceiling (~256k). On larger windows the agent keeps a
 * bounded live history instead of filling the full advertised context.
 */
export const DEFAULT_MAX_WORKING_SET_TOKENS = 262_144;
/** Async pre-rot working-set ceiling; stays below the soft full-compact cap. */
export const DEFAULT_ASYNC_WORKING_SET_TOKENS = 220_000;
/**
 * Micro (tool-result) clearing pressure ceiling. Reversible clearing should run
 * well before async/full summarize on large windows.
 */
export const DEFAULT_MICRO_WORKING_SET_TOKENS = 140_000;
/** Pre-swarm handoff absolute ceiling (paired with {@link SWARM_HANDOFF_COMPACTION_RATIO}). */
export const DEFAULT_SWARM_HANDOFF_WORKING_SET_TOKENS = 180_000;
/**
 * Context-window size at/above which the window-aware default trigger ratios
 * apply. On large windows (e.g. 131k) the fixed 0.70 soft trigger fires
 * relatively early (~92k), so auto-compaction feels too frequent; past this
 * threshold we raise the *default* ratios so compaction starts later and less
 * often — then working-set caps still bound 1M-class windows. Explicit user
 * config (`loopControl.compactionTriggerRatio` / `compactionAsyncTriggerRatio`)
 * always wins over these defaults.
 */
const LARGE_CONTEXT_WINDOW_THRESHOLD = 128_000;
/** Soft-trigger default on large windows; kept below the hard block ceiling (0.90). */
const LARGE_WINDOW_COMPACTION_TRIGGER_RATIO = 0.8;
/** Async pre-rot default on large windows; kept below the large-window soft trigger. */
const LARGE_WINDOW_ASYNC_COMPACTION_TRIGGER_RATIO = 0.7;
/** Default number of leading messages (system + initial user) kept frozen. */
export const DEFAULT_FROZEN_ZONE_SIZE = 2;
/**
 * Cap for the quality trigger bias: the effective trigger ratio may move only
 * a small delta below the configured ratio, so backstop-heavy sessions cannot
 * ratchet compaction into a hair-trigger loop.
 */
const MAX_QUALITY_TRIGGER_BIAS = 0.02;

/**
 * Clamp a token threshold by an optional working-set ceiling.
 * `0` / missing cap means "no ceiling".
 */
export function applyWorkingSetCap(
  ratioThresholdTokens: number,
  workingSetCapTokens: number | undefined | null,
): number {
  if (
    workingSetCapTokens === undefined ||
    workingSetCapTokens === null ||
    workingSetCapTokens <= 0
  ) {
    return ratioThresholdTokens;
  }
  return Math.min(ratioThresholdTokens, workingSetCapTokens);
}

/**
 * Growth base for recompact hysteresis: prefer the soft working-set cap so
 * huge advertised windows do not inflate the min-growth floor.
 */
export function recompactGrowthBaseTokens(input: {
  readonly maxContextTokens: number;
  readonly maxWorkingSetTokens?: number | null;
}): number {
  if (input.maxContextTokens <= 0) return 0;
  const cap = input.maxWorkingSetTokens;
  if (cap === undefined || cap === null || cap <= 0) {
    return input.maxContextTokens;
  }
  return Math.min(input.maxContextTokens, cap);
}

/**
 * Window-aware default soft-trigger ratio.
 *
 * Returns the higher large-window default once `maxContextTokens` reaches
 * `LARGE_CONTEXT_WINDOW_THRESHOLD`, otherwise the small-window default. The
 * result is clamped so the default can never reach the hard block ceiling
 * (`DEFAULT_COMPACTION_BLOCK_RATIO`), preserving headroom for the compaction
 * summary call. Only used as a fallback — explicit user config always wins.
 *
 * Pair with {@link DEFAULT_MAX_WORKING_SET_TOKENS}: on 1M windows the ratio
 * alone would wait until ~800k; the working-set cap pulls soft compact back
 * to ~256k.
 */
export function defaultTriggerRatioForWindow(maxContextTokens: number): number {
  const ratio =
    maxContextTokens >= LARGE_CONTEXT_WINDOW_THRESHOLD
      ? LARGE_WINDOW_COMPACTION_TRIGGER_RATIO
      : DEFAULT_COMPACTION_TRIGGER_RATIO;
  // Never let the default reach the hard block ceiling.
  return Math.min(ratio, DEFAULT_COMPACTION_BLOCK_RATIO - 0.05);
}

/**
 * Window-aware default async (pre-rot) trigger ratio.
 *
 * Mirrors `defaultTriggerRatioForWindow`, clamped to stay below the
 * window-aware soft trigger so the blocking path can still take over once the
 * sync trigger fires. Only used as a fallback — explicit user config always wins.
 */
export function defaultAsyncTriggerRatioForWindow(maxContextTokens: number): number {
  const ratio =
    maxContextTokens >= LARGE_CONTEXT_WINDOW_THRESHOLD
      ? LARGE_WINDOW_ASYNC_COMPACTION_TRIGGER_RATIO
      : DEFAULT_ASYNC_COMPACTION_TRIGGER_RATIO;
  // Async must stay below the sync trigger for the same window.
  return Math.min(ratio, defaultTriggerRatioForWindow(maxContextTokens) - 0.05);
}

/**
 * Default soft working-set cap for a model window.
 * Returns `0` when the window is at/below the default cap (ratio-only is enough).
 */
export function defaultMaxWorkingSetTokensForWindow(maxContextTokens: number): number {
  if (maxContextTokens <= 0) return 0;
  if (maxContextTokens <= DEFAULT_MAX_WORKING_SET_TOKENS) return 0;
  return DEFAULT_MAX_WORKING_SET_TOKENS;
}

/**
 * Default async working-set cap. Disabled when the soft cap is disabled, and
 * always kept strictly below the soft cap when both apply.
 */
export function defaultAsyncWorkingSetTokensForWindow(maxContextTokens: number): number {
  const softCap = defaultMaxWorkingSetTokensForWindow(maxContextTokens);
  if (softCap <= 0) return 0;
  return Math.min(DEFAULT_ASYNC_WORKING_SET_TOKENS, softCap - 1);
}

/**
 * Default micro pressure token ceiling. Active once the window exceeds the
 * micro working-set default so 1M models clear tool dumps near ~140k, not ~400k.
 */
export function defaultMicroWorkingSetTokensForWindow(maxContextTokens: number): number {
  if (maxContextTokens <= 0) return 0;
  if (maxContextTokens <= DEFAULT_MICRO_WORKING_SET_TOKENS) return 0;
  return DEFAULT_MICRO_WORKING_SET_TOKENS;
}

/**
 * Resolve the token threshold for micro pressure from ratio + optional cap.
 */
export function microPressureThresholdTokens(input: {
  readonly maxContextTokens: number;
  readonly minContextUsageRatio: number;
  readonly maxWorkingSetTokens?: number | null;
}): number {
  if (input.maxContextTokens <= 0) return 0;
  const ratioThreshold = Math.floor(input.maxContextTokens * input.minContextUsageRatio);
  return applyWorkingSetCap(ratioThreshold, input.maxWorkingSetTokens);
}

export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  triggerRatio: DEFAULT_COMPACTION_TRIGGER_RATIO,
  blockRatio: DEFAULT_COMPACTION_BLOCK_RATIO,
  reservedContextSize: 16_000,
  maxCompactionPerTurn: Infinity,
  maxOverflowCompactionAttempts: 3,
  maxRecentMessages: 12,
  maxRecentUserMessages: Infinity,
  maxRecentSizeRatio: 0.12,
  minOverflowReductionRatio: 0.05,
  // Absolute *floor* disabled by default (historically caused thrash when used
  // as an early trigger). Use maxWorkingSetTokens as the large-window *cap*.
  absoluteTriggerTokens: 0,
  absoluteTriggerMinContextTokens: DEFAULT_ABSOLUTE_TRIGGER_MIN_CONTEXT_TOKENS,
  parallelBlockThreshold: 12_000,
  parallelBlockTarget: 6_000,
  speculativeStepBufferTokens: DEFAULT_SPECULATIVE_STEP_BUFFER_TOKENS,
  minRecompactGrowthRatio: DEFAULT_MIN_RECOMPACT_GROWTH_RATIO,
  // Soft ceilings: effective only when the model window exceeds the cap.
  maxWorkingSetTokens: DEFAULT_MAX_WORKING_SET_TOKENS,
  asyncWorkingSetTokens: DEFAULT_ASYNC_WORKING_SET_TOKENS,
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

  get workingSetBaseTokens(): number {
    if (this.trigger instanceof DefaultCompactionStrategy) {
      return this.trigger.workingSetBaseTokens;
    }
    return recompactGrowthBaseTokens({
      maxContextTokens: 0,
      maxWorkingSetTokens: DEFAULT_COMPACTION_CONFIG.maxWorkingSetTokens,
    });
  }

  get maxWorkingSetTokens(): number {
    if (this.trigger instanceof DefaultCompactionStrategy) {
      return this.trigger.maxWorkingSetTokens;
    }
    return DEFAULT_COMPACTION_CONFIG.maxWorkingSetTokens;
  }

  get asyncWorkingSetTokens(): number {
    if (this.trigger instanceof DefaultCompactionStrategy) {
      return this.trigger.asyncWorkingSetTokens;
    }
    return DEFAULT_COMPACTION_CONFIG.asyncWorkingSetTokens;
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
