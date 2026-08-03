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
  /**
   * Max concurrent LLM calls for parallel block summarize. `0` / omit uses the
   * engine default (adaptive, starts at 3). Cap is always ≤ 8 so a large
   * session cannot open unbounded RPS against the provider.
   */
  parallelBlockConcurrency?: number;
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

export const DEFAULT_ABSOLUTE_TRIGGER_MIN_CONTEXT_TOKENS = 256_000;

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
/** Pre-swarm handoff ceiling: force reclaim before a swarm handoff if usage is above this ratio. */
export const SWARM_HANDOFF_COMPACTION_RATIO = 0.65;
/**
 * During swarm runs, allow micro (tool-result) clearing from this usage ratio.
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
  parallelBlockThreshold: 8_000,
  parallelBlockTarget: 5_000,
  parallelBlockConcurrency: 0,
  speculativeStepBufferTokens: DEFAULT_SPECULATIVE_STEP_BUFFER_TOKENS,
  minRecompactGrowthRatio: DEFAULT_MIN_RECOMPACT_GROWTH_RATIO,
  // Soft ceilings: effective only when the model window exceeds the cap.
  maxWorkingSetTokens: DEFAULT_MAX_WORKING_SET_TOKENS,
  asyncWorkingSetTokens: DEFAULT_ASYNC_WORKING_SET_TOKENS,
  asyncTriggerRatio: DEFAULT_ASYNC_COMPACTION_TRIGGER_RATIO,
  frozenZoneSize: DEFAULT_FROZEN_ZONE_SIZE,
};
