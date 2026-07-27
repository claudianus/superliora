import {
  ErrorCodes,
  LioraError,
  isKimiError,
  toKimiErrorPayload,
} from '#/errors';
import {
  APIEmptyResponseError,
  createProvider,
  isRetryableGenerateError,
  type ChatProvider,
  type Message,
  type ModelCapability,
  type TokenUsage,
  type Tool,
  APIContextOverflowError,
  APIStatusError,
  createUserMessage,
} from '@superliora/kosong';

import type { Agent } from '..';
import type { ResolvedRuntimeProvider } from '../../session/provider-manager';
import { buildResponseLanguageDirective } from '../injection/response-language';
import { isAbortError } from '../../loop/errors';
import {
  retryBackoffDelays,
  sleepForRetry,
} from '../../loop/retry';
import { renderPrompt } from '../../utils/render-prompt';
import {
  estimateTokens,
  estimateTokensForMessages,
  estimateTokensForTools,
} from '../../utils/tokens';
import {
  applyCompletionBudget,
  computeCompletionBudgetCap,
  resolveCompletionBudget,
} from '../../utils/completion-budget';
import { resolveCompactionModelAlias } from '../../utils/cheap-model';
import compactionInstructionTemplate from './compaction-instruction.md?raw';
import { archiveContent } from '../../tools/builtin/context/context-archive';
import { renderMessagesToText } from './render-messages';
import { renderTodoList, type TodoItem } from '../../tools/builtin/state/todo-list';
import type {
  CompactionBeginData,
  CompactionContextOS,
  CompactionContextPack,
  CompactionQualitySignals,
  CompactionResult,
  CompactionResultAction,
  CompactionResultRawRef,
  CompactionSource,
} from './types';
import {
  DEFAULT_COMPACTION_CONFIG,
  DEFAULT_SWARM_HANDOFF_WORKING_SET_TOKENS,
  DefaultCompactionStrategy,
  defaultAsyncTriggerRatioForWindow,
  defaultTriggerRatioForWindow,
  PipelineStrategy,
  ToolCollapseStrategy,
  resolveCompactionBlockRatio,
  SWARM_MICRO_PRESSURE_RATIO,
  type CompactionStrategy,
} from './strategy';
import {
  CompactionPlanner,
  groupMessages,
  splitMessagesIntoTokenBlocks,
  type CompactionPlan,
} from './planner';
import {
  buildUltraworkCompactionEnvelope,
  captureUltraworkEnvelopeSnapshot,
  extractUltraworkRunLines,
  renderUltraworkRunsMemorySection,
} from '../../ultrawork/envelope';
import {
  injectMissingDurableEvidenceIds,
  mergeCompactionQualityResults,
  validateInitialCompactionSummary,
  validateRenderedCompactionSummary,
  validateUltraworkCompactionContinuity,
  CompactionQualityTracker,
  type CompactionQualityResult,
} from './quality';
import {
  extractFactsFromSummary,
  formatFactsAsMemoryBlock,
  mergeFactSets,
  parseStructuredCompactionMemory,
  type ExtractedFact,
} from './memory';
import {
  type AnchorDocument,
  createAnchorDocument,
  extractAnchorDiff,
  mergeIntoAnchor,
  renderAnchor,
} from './anchor';
import {
  buildEmergencyBackstopSummary,
  shouldUseClassicalCompactionFallback,
} from './backstop';
import { buildCompactionSummaryText } from './handoff';
import {
  compactionFinishedTelemetryProperties,
  compactionV2FinishedTelemetryProperties,
  buildEmergencyBackstopActions,
  emergencyBackstopWarnings,
  evidenceRepairSucceeded,
  extractCompactionSummary,
  formatContextManagementCapability,
  isMissingEvidenceQualityFailure,
  mergeQualityWarningLists,
  mergeTokenUsage,
  mergeTokenUsageOrNull,
  shouldIncludeCompactionQualitySignals,
  stripResolvedEvidenceCriticals,
} from './full-helpers';
import {
  handoffThresholdTokens,
  relaxObservedMaxContextTokens,
  resolveEffectiveMaxContextTokens,
  shouldDeferAutoCompaction as shouldDeferAutoCompactionPolicy,
  shouldRecoverFromOverflowStatus,
  shouldSkipRecompactUntilGrowth as shouldSkipRecompactUntilGrowthPolicy,
  shouldUseParallelSummarize,
} from './full-policy';
import {
  extractSwarmRunsFromMessages,
  renderSwarmRunsMemorySection,
} from './swarm-memory-extract';
import {
  blockDensity,
  countStructuredMemoryItems,
  createCompactionRecallMemories,
  evaluateContinuity,
  extractFileHints,
  extractNextActions,
  extractSwarmRunLines,
  factsToDetails,
  formatRawRef,
  formatStringList,
  inferMemoryTiers,
  mergeStringLists,
  selectRehydrationRawRefKinds,
  uniqueHints,
  uniqueSorted,
} from './context-helpers';

export const MAX_COMPACTION_RETRY_ATTEMPTS = 5;
const DEFAULT_COMPACTION_MAX_COMPLETION_TOKENS = 128 * 1024;
const COMPACTION_MIN_OUTPUT_TOKENS = 8_192;
const DEFAULT_PARALLEL_BLOCK_THRESHOLD = 12_000;
const DEFAULT_PARALLEL_BLOCK_TARGET = 6_000;
/** Cap concurrent block LLM calls so parallel compaction cannot exhaust RPS (e.g. xAI 18/s). */
const DEFAULT_PARALLEL_BLOCK_CONCURRENCY = 2;
/** Hard ceiling for adaptive concurrency — providers rarely sustain more than this. */
const MAX_PARALLEL_BLOCK_CONCURRENCY = 8;
const PARALLEL_BLOCK_RATE_LIMIT_RETRIES = 4;
/** Env override for initial parallel block concurrency (clamped 1..MAX). */
const PARALLEL_CONCURRENCY_ENV = 'SUPERLIORA_COMPACTION_PARALLEL_CONCURRENCY';

/** Progress weights within one compaction round (sum ≈ 1). */
const PROGRESS_WEIGHT_PLAN = 0.05;
const PROGRESS_WEIGHT_BLOCKS = 0.55;
const PROGRESS_WEIGHT_MERGE = 0.15;
const PROGRESS_WEIGHT_REPAIR = 0.15;
const PROGRESS_WEIGHT_FINALIZE = 0.1;
const OVERFLOW_CONTEXT_SAFETY_RATIO = 0.85;
const OVERFLOW_STATUS_RECOVERY_RATIO = 0.5;
/**
 * Each successful turn (no overflow) relaxes the observed max context by
 * this fraction of the gap toward the configured maximum, so a transient
 * false-positive overflow (e.g. one huge tool result) does not bias the
 * whole session toward premature compaction forever.
 */
const OBSERVED_MAX_DECAY_PER_TURN = 0.1;
const MAX_COMPACTION_MERGE_RETRY_ATTEMPTS = 2;

type CompactionResultWithQualityWarnings = CompactionResult & {
  readonly qualityWarnings: readonly string[];
};

type CompletedCompactionResult = CompactionResultWithQualityWarnings & {
  readonly contextPack: CompactionContextPack;
};

class CompactionTruncatedError extends Error {
  constructor() {
    super('Compaction response was truncated before producing a complete summary.');
    this.name = 'CompactionTruncatedError';
  }
}

class CompactionQualityError extends Error {
  constructor(messages: readonly string[]) {
    super(`Compaction summary failed quality checks: ${messages.join('; ')}`);
    this.name = 'CompactionQualityError';
  }
}

export class FullCompaction {
  protected compactionCountInTurn = 0;
  protected compacting: {
    abortController: AbortController;
    promise: Promise<void>;
    blockedByTurn: boolean;
  } | null = null;
  protected readonly strategy: CompactionStrategy;
  private readonly observedMaxContextTokensByModel = new Map<string, number>();
  private lastCompactedTokenCount: number | null = null;
  private consecutiveOverflowCompactions = 0;
  protected extractedFacts: ExtractedFact[] = [];
  protected anchor: AnchorDocument | null = null;
  protected readonly planner = new CompactionPlanner();
  private readonly qualityTracker = new CompactionQualityTracker();

  constructor(
    protected readonly agent: Agent,
    strategy?: CompactionStrategy,
  ) {
    const loopControl = agent.kimiConfig?.loopControl;
    const userTriggerRatio = loopControl?.compactionTriggerRatio;
    const userAsyncTriggerRatio = loopControl?.compactionAsyncTriggerRatio;
    // The context window is only known once the agent finishes constructing
    // (`agent.config` is still undefined here), so the window-aware defaults are
    // resolved lazily through the config getters below. They apply only when the
    // user has not set an explicit ratio: on large windows this raises the default
    // trigger so compaction starts later and fires less often. Explicit config
    // always wins. The hard block ratio is derived from the explicit ratio (or the
    // small-window default) so the safety ceiling never moves.
    const maxContextTokens = () => this.getEffectiveMaxContextTokens();
    const compactionBlockRatio = resolveCompactionBlockRatio(
      userTriggerRatio ?? DEFAULT_COMPACTION_CONFIG.triggerRatio,
      loopControl?.compactionBlockRatio,
    );
    const defaultTrigger = new DefaultCompactionStrategy(
      maxContextTokens,
      {
        ...DEFAULT_COMPACTION_CONFIG,
        get triggerRatio() {
          return userTriggerRatio ?? defaultTriggerRatioForWindow(maxContextTokens());
        },
        get asyncTriggerRatio() {
          return userAsyncTriggerRatio ?? defaultAsyncTriggerRatioForWindow(maxContextTokens());
        },
        // Working-set caps: keep agent live history near ~256k even on 1M windows.
        // Explicit loopControl values win (including 0 = disable cap). Absolute
        // floor still comes from compactionTriggerTokens when set.
        get maxWorkingSetTokens() {
          return (
            loopControl?.maxWorkingSetTokens ??
            DEFAULT_COMPACTION_CONFIG.maxWorkingSetTokens
          );
        },
        get asyncWorkingSetTokens() {
          return (
            loopControl?.asyncWorkingSetTokens ??
            DEFAULT_COMPACTION_CONFIG.asyncWorkingSetTokens
          );
        },
        blockRatio: compactionBlockRatio,
        reservedContextSize:
          loopControl?.reservedContextSize ??
          DEFAULT_COMPACTION_CONFIG.reservedContextSize,
        absoluteTriggerTokens:
          loopControl?.compactionTriggerTokens ??
          DEFAULT_COMPACTION_CONFIG.absoluteTriggerTokens,
        maxRecentMessages:
          loopControl?.compactionMaxRecentMessages ??
          DEFAULT_COMPACTION_CONFIG.maxRecentMessages,
        absoluteTriggerBlocks: false,
      },
    );
    // Observation masking: keep last 2 tool-call groups intact when collapsing.
    // PipelineStrategy maps ToolCollapse 0 → no constraint (safe with few groups).
    this.strategy =
      strategy ??
      new PipelineStrategy([new ToolCollapseStrategy(2)], defaultTrigger);

    const systemPrompt = agent.config?.systemPrompt?.trim();
    if (systemPrompt && systemPrompt.length > 0) {
      this.anchor = createAnchorDocument(
        systemPrompt.slice(0, 500).replaceAll(/\s+/g, ' ').trim()
      );
    }
  }

  get isCompacting(): boolean {
    return this.compacting !== null;
  }

  begin(data: Readonly<CompactionBeginData>): void {
    if (this.compacting) return;
    if (data.source === 'manual') {
      this.compactionCountInTurn = 0;
    } else {
      this.compactionCountInTurn += 1;
    }
    if (this.compactionCountInTurn > this.strategy.maxCompactionPerTurn) return;
    if (this.agent.records.restoring) {
      this.agent.replayBuilder.push({
        type: 'compaction',
        instruction: data.instruction,
      });
      return;
    }
    if (data.source === 'manual' && this.agent.turn.hasActiveTurn) {
      throw new LioraError(
        ErrorCodes.COMPACTION_UNABLE,
        'Cannot compact while a turn is active. Wait for it to finish, then retry.',
      );
    }
    let compactedCount = this.strategy.computeCompactCount(this.agent.context.history, data.source);
    if (compactedCount === 0 && data.source === 'manual') {
      if (this.agent.context.prepareManualCompactionWithOpenToolExchange()) {
        compactedCount = this.strategy.computeCompactCount(this.agent.context.history, data.source);
      }
    }
    if (compactedCount === 0) {
      if (data.source === 'manual') {
        throw new LioraError(ErrorCodes.COMPACTION_UNABLE, 'No prefix that can be compacted in current history.');
      }
      return;
    }
    const ultraworkRun = this.agent.ultrawork?.getRun();
    if (ultraworkRun?.status === 'running') {
      this.agent.ultrawork.flushCheckpoint();
    }
    this.agent.records.logRecord({
      type: 'full_compaction.begin',
      ...data,
    });
    // Resolve effective summarizer early so the TUI can show which model is
    // about to write the compaction summary (cheap auto / explicit / main).
    const configuredCompactionModel = this.agent.kimiConfig?.loopControl?.compactionModel;
    const resolvedCompactionModel =
      resolveCompactionModelAlias({
        explicit: configuredCompactionModel,
        models: this.agent.kimiConfig?.models,
      }) ?? this.agent.config.modelAlias;
    this.agent.emitEvent({
      type: 'compaction.started',
      trigger: data.source,
      instruction: data.instruction,
      mode: this.agent.turn.hasActiveTurn ? 'background' : 'blocking',
      modelAlias: resolvedCompactionModel,
    });
    const abortController = new AbortController();
    this.compacting = {
      abortController,
      promise: this.compactionWorker(abortController.signal, data, compactedCount),
      blockedByTurn: false,
    };
  }

  cancel(): void {
    this.agent.replayBuilder.patchLast('compaction', {
      result: 'cancelled',
    });
    if (!this.compacting) return;
    this.agent.records.logRecord({
      type: 'full_compaction.cancel',
    });
    this.compacting.abortController.abort();
    this.compacting = null;
    this.agent.emitEvent({ type: 'compaction.cancelled' });
    this.agent.turn.onCompactionFinished();
  }

  /**
   * Release the compaction lock and finish the turn if this worker still owns
   * the lock. `cancel()` clears `compacting` synchronously before an abort it
   * initiated can reach the worker, and `markCompleted()` clears it on success,
   * so a non-null `compacting` at a worker exit means the run was aborted by
   * some other path — a provider timeout, a linked signal, or a pre/post-compact
   * hook — without any cleanup. Without this release the lock stays set forever:
   * `checkAutoCompaction()` then short-circuits on `if (this.compacting) return
   * true`, every new prompt/steer buffers in the turn, and the agent deadlocks
   * at the trigger threshold. Safe to call unconditionally from a `finally`:
   * it is a no-op once the lock is already cleared, and re-aborting an
   * already-aborted controller does nothing.
   */
  private releaseLockIfOwned(): void {
    if (this.compacting) {
      this.cancel();
    }
  }

  markCompleted() {
    this.agent.records.logRecord({
      type: 'full_compaction.complete',
    });
    this.compacting = null;
  }

  private syncCompactionBaseline(): void {
    this.lastCompactedTokenCount = this.tokenCountWithPending;
  }

  private hasCompactionSummaryInHistory(): boolean {
    return this.agent.context.history.some(
      (message) => message.origin?.kind === 'compaction_summary',
    );
  }

  private get tokenCountWithPending(): number {
    return this.agent.context.tokenCountWithPending;
  }

  estimateCurrentRequestTokens(): number {
    return this.estimateRequestTokens(this.agent.context.messages);
  }

  getEffectiveMaxContextTokens(): number {
    const configured = this.agent.config.modelCapabilities.max_context_tokens;
    const modelAlias = this.agent.config.modelAlias;
    const observed =
      modelAlias === undefined ? undefined : this.observedMaxContextTokensByModel.get(modelAlias);
    return resolveEffectiveMaxContextTokens({ configured, observed });
  }

  observeContextOverflow(estimatedRequestTokens: number): void {
    if (!Number.isFinite(estimatedRequestTokens) || estimatedRequestTokens <= 0) return;
    const modelAlias = this.agent.config.modelAlias;
    if (modelAlias === undefined) return;
    const observed = Math.max(
      1,
      Math.floor(estimatedRequestTokens * OVERFLOW_CONTEXT_SAFETY_RATIO),
    );
    const current = this.getEffectiveMaxContextTokens();
    if (current > 0 && observed >= current) return;
    this.observedMaxContextTokensByModel.set(modelAlias, observed);
  }

  private estimateRequestTokens(messages: readonly Message[]): number {
    return (
      estimateTokens(this.agent.config.systemPrompt) +
      estimateTokensForTools(this.agent.tools.loopTools) +
      estimateTokensForMessages(messages)
    );
  }

  private strategyWithQualityControls():
    | DefaultCompactionStrategy
    | PipelineStrategy
    | undefined {
    if (this.strategy instanceof DefaultCompactionStrategy) return this.strategy;
    if (this.strategy instanceof PipelineStrategy) return this.strategy;
    return undefined;
  }

  private speculativeStepBufferTokens(): number {
    const strategy = this.strategyWithQualityControls();
    if (strategy !== undefined) {
      return strategy.speculativeStepBufferTokens;
    }
    return DEFAULT_COMPACTION_CONFIG.speculativeStepBufferTokens;
  }

  private shouldSpeculativelyCompact(projectedUsedSize: number): boolean {
    const strategy = this.strategyWithQualityControls();
    if (strategy !== undefined) {
      return strategy.shouldSpeculativelyCompact(projectedUsedSize);
    }
    return this.strategy.shouldCompact(projectedUsedSize);
  }

  private recordCompactionQuality(input: {
    readonly recallEvalScore?: number | undefined;
    readonly usedEmergencyBackstop: boolean;
    readonly evidenceRepairAttempted?: boolean;
    readonly evidenceRepairSucceeded?: boolean;
  }): void {
    const trend = this.qualityTracker.record(input);
    const strategy = this.strategyWithQualityControls();
    const qualityTriggerBias =
      strategy !== undefined ? strategy.applyQualityFeedback(input) : 0;
    this.agent.telemetry.track('compaction_quality_trend', {
      sample_count: trend.sampleCount,
      rolling_average: trend.rollingAverage,
      low_quality_streak: trend.lowQualityStreak,
      emergency_backstop_count: trend.emergencyBackstopCount,
      evidence_repair_attempts: trend.evidenceRepairAttempts,
      evidence_repair_successes: trend.evidenceRepairSuccesses,
      evidence_repair_success_rate: trend.evidenceRepairSuccessRate,
      quality_trigger_bias: qualityTriggerBias,
    });
  }

  shouldRecoverFromContextOverflow(
    error: unknown,
    estimatedRequestTokens = this.estimateCurrentRequestTokens(),
  ): boolean {
    return shouldRecoverFromOverflowStatus({
      isContextOverflowError: error instanceof APIContextOverflowError,
      isStatus413: error instanceof APIStatusError && error.statusCode === 413,
      estimatedRequestTokens,
      maxContextTokens: this.getEffectiveMaxContextTokens(),
      recoveryRatio: OVERFLOW_STATUS_RECOVERY_RATIO,
    });
  }

  resetForTurn(): void {
    this.compactionCountInTurn = 0;
    this.consecutiveOverflowCompactions = 0;
    this.lastCompactedTokenCount = null;
    this.relaxObservedMaxContext();
  }

  /**
   * Nudge the observed max context back toward the configured maximum so a
   * single transient overflow does not permanently tighten compaction for the
   * rest of the session. Only applies when no overflow happened this turn
   * (`consecutiveOverflowCompactions` was just reset to 0 above). The nudge
   * is bounded — it never exceeds the configured max.
   */
  private relaxObservedMaxContext(): void {
    const modelAlias = this.agent.config.modelAlias;
    if (modelAlias === undefined) return;
    const observed = this.observedMaxContextTokensByModel.get(modelAlias);
    if (observed === undefined) return;
    const configured = this.agent.config.modelCapabilities.max_context_tokens;
    const relaxed = relaxObservedMaxContextTokens({
      observed,
      configured,
      decayPerTurn: OBSERVED_MAX_DECAY_PER_TURN,
    });
    if (relaxed !== observed) {
      this.observedMaxContextTokensByModel.set(modelAlias, relaxed);
    }
  }

  async handleOverflowError(signal: AbortSignal, error: unknown) {
    this.consecutiveOverflowCompactions += 1;
    const maxAttempts = this.strategy.maxOverflowCompactionAttempts;
    if (this.consecutiveOverflowCompactions > maxAttempts) {
      throw new LioraError(
        ErrorCodes.CONTEXT_OVERFLOW,
        `Compaction failed to bring the context under the model window after ${String(maxAttempts)} attempts.`,
        { cause: error instanceof Error ? error : undefined },
      );
    }
    const didStartCompaction = this.beginAutoCompaction();
    if (!didStartCompaction && !this.compacting) throw error;
    // Always block on overflow errors
    await this.block(signal);
  }

  async beforeStep(signal: AbortSignal): Promise<void> {
    this.checkAutoCompaction();
    if (this.compacting !== null || this.strategy.shouldBlock(this.tokenCountWithPending)) {
      await this.block(signal);
    }
  }

  /**
   * Speculative compaction before the first step of a turn: project the next
   * LLM request size plus a typical step buffer and compact early when the next
   * step would cross the trigger or block threshold.
   */
  async prepareForTurn(signal: AbortSignal): Promise<void> {
    if (this.compacting !== null) {
      await this.block(signal);
      return;
    }
    const projected = this.estimateCurrentRequestTokens() + this.speculativeStepBufferTokens();
    if (this.shouldSpeculativelyCompact(projected)) {
      this.checkAutoCompaction();
      if (this.compacting !== null) {
        await this.block(signal);
        return;
      }
    }
    // Async background compaction: start summarizing at a lower threshold
    // without blocking the turn. The worker runs concurrently; beforeStep
    // will block on it only when the synchronous threshold is reached.
    if (this.isAsyncCompactionEnabled() && this.shouldAsyncCompactNow(projected)) {
      this.beginAutoCompaction(false);
    }
    if (this.strategy.shouldBlock(this.tokenCountWithPending)) {
      this.canAutoCompact(true);
    }
  }

  async afterStep(): Promise<void> {
    this.consecutiveOverflowCompactions = 0;
    if (this.strategy.checkAfterStep) {
      this.checkAutoCompaction(false);
    }
    // Opportunistically start a background compaction when the async
    // threshold is crossed but the sync trigger hasn't fired yet.
    if (
      this.compacting === null &&
      this.isAsyncCompactionEnabled() &&
      this.shouldAsyncCompactNow(this.tokenCountWithPending)
    ) {
      this.beginAutoCompaction(false);
    }
    // Do not block after the step
  }

  private isAsyncCompactionEnabled(): boolean {
    return this.agent.experimentalFlags.enabled('async_compaction');
  }

  private shouldAsyncCompactNow(usedSize: number): boolean {
    if (this.compacting !== null) return false;
    if (this.shouldDeferAutoCompaction()) return false;
    if (this.shouldSkipRecompactUntilGrowth()) return false;
    return this.strategy.shouldAsyncCompact(usedSize);
  }

  private checkAutoCompaction(throwOnLimit: boolean = true): boolean {
    if (this.compacting) return true;
    if (this.shouldDeferAutoCompaction()) {
      this.maybeRunSwarmMicroCompaction();
      return false;
    }
    if (this.shouldSkipRecompactUntilGrowth()) return false;
    const needsCompaction =
      this.strategy.shouldCompact(this.tokenCountWithPending) ||
      this.strategy.shouldBlock(this.tokenCountWithPending);
    if (!needsCompaction) return false;
    return this.beginAutoCompaction(throwOnLimit);
  }

  private shouldSkipRecompactUntilGrowth(): boolean {
    const quality = this.strategyWithQualityControls();
    const minGrowthRatio =
      quality?.minRecompactGrowthRatio ??
      DEFAULT_COMPACTION_CONFIG.minRecompactGrowthRatio;
    const maxWorkingSetTokens =
      quality?.maxWorkingSetTokens ?? DEFAULT_COMPACTION_CONFIG.maxWorkingSetTokens;
    return shouldSkipRecompactUntilGrowthPolicy({
      lastCompactedTokenCount: this.lastCompactedTokenCount,
      tokenCountWithPending: this.tokenCountWithPending,
      minGrowthRatio,
      maxContextTokens: this.getEffectiveMaxContextTokens(),
      maxWorkingSetTokens,
    });
  }

  private shouldDeferAutoCompaction(): boolean {
    return shouldDeferAutoCompactionPolicy({
      ultraSwarmActive: this.agent.ultraSwarmRun !== undefined,
      shouldBlock: this.strategy.shouldBlock(this.tokenCountWithPending),
      hasActiveForegroundChildren:
        this.agent.subagentHost?.hasActiveForegroundChildren?.() === true,
    });
  }

  private maybeRunSwarmMicroCompaction(): void {
    if (this.agent.ultraSwarmRun === undefined) return;
    if (this.strategy.shouldBlock(this.tokenCountWithPending)) return;
    this.agent.microCompaction.detectUnderSwarmPressure(SWARM_MICRO_PRESSURE_RATIO);
  }

  async ensureBelowHandoffThreshold(
    signal: AbortSignal,
    handoffRatio?: number,
  ): Promise<void> {
    const triggerRatio =
      handoffRatio ??
      this.agent.kimiConfig?.loopControl?.compactionTriggerRatio ??
      DEFAULT_COMPACTION_CONFIG.triggerRatio;
    const threshold = handoffThresholdTokens({
      maxTokens: this.agent.config.modelCapabilities.max_context_tokens,
      triggerRatio,
      // Cap pre-swarm reclaim near the agent working set, not the full 1M window.
      maxWorkingSetTokens: DEFAULT_SWARM_HANDOFF_WORKING_SET_TOKENS,
    });
    if (threshold === undefined || this.tokenCountWithPending <= threshold) return;
    this.checkAutoCompaction(false);
    if (this.compacting !== null) {
      await this.block(signal);
    }
  }

  private beginAutoCompaction(throwOnLimit: boolean = true): boolean {
    if (this.compacting) return true;
    const maxCompactions = this.strategy.maxCompactionPerTurn;
    if (this.compactionCountInTurn >= maxCompactions) {
      if (throwOnLimit) {
        throw new LioraError(ErrorCodes.CONTEXT_OVERFLOW, `Compaction limit exceeded (${String(maxCompactions)})`, {
          details: { maxCompactions },
        });
      }
      return false;
    }
    if (!this.canAutoCompact(throwOnLimit)) {
      return false;
    }
    this.begin({ source: 'auto', instruction: undefined });
    if (this.compacting === null) {
      return false;
    }
    return true;
  }

  /**
   * Returns false when auto compaction cannot proceed and the caller should not
   * start a worker. Throws only when the context is over the block threshold
   * and neither structural compaction nor ephemeral reclaim can recover.
   */
  private canAutoCompact(throwOnLimit: boolean): boolean {
    let compactedCount = this.strategy.computeCompactCount(this.agent.context.history, 'auto');
    if (
      compactedCount === 0 &&
      this.hasCompactionSummaryInHistory() &&
      this.agent.context.reclaimEphemeralUserMessages() > 0
    ) {
      compactedCount = this.strategy.computeCompactCount(this.agent.context.history, 'auto');
    }
    if (compactedCount > 0) {
      return true;
    }
    if (!this.strategy.shouldBlock(this.tokenCountWithPending)) {
      return false;
    }
    if (throwOnLimit) {
      throw new LioraError(
        ErrorCodes.CONTEXT_OVERFLOW,
        'Context is over the model window and no further compaction prefix is available.',
      );
    }
    return false;
  }

  private async block(signal: AbortSignal): Promise<void> {
    const active = this.compacting;
    if (active) {
      active.blockedByTurn = true;
      signal.addEventListener('abort', () => {
        if (this.compacting === active) {
          this.cancel();
        }
      });
      this.agent.emitEvent({
        type: 'compaction.blocked',
        turnId: this.agent.turn.currentId,
      });
      await active.promise;
    }
  }

  private async compactionWorker(
    signal: AbortSignal,
    data: Readonly<CompactionBeginData>,
    compactedCount: number,
  ): Promise<void> {
    try {
      const finalActions: CompactionResultAction[] = [];
      const finalRawRefs: CompactionResultRawRef[] = [];
      const finalQualityWarnings: string[] = [];
      const finalResult: CompactionResult = {
        summary: '',
        compactedCount: 1,
        tokensBefore: 0,
        tokensAfter: 0,
      };

      for (let round = 1; ; round++) {
        const result = await this.compactionRound(round, signal, data, compactedCount);
        if (!result) return;

        finalResult.summary = result.summary;
        finalResult.compactedCount += result.compactedCount - 1;
        finalResult.tokensBefore += result.tokensBefore - finalResult.tokensAfter;
        finalResult.tokensAfter = result.tokensAfter;
        finalResult.algorithmVersion = result.algorithmVersion;
        finalResult.summaryTokens = result.summaryTokens;
        finalResult.retainedTokens = result.retainedTokens;
        finalResult.compactedTokens = result.compactedTokens;
        if (result.parallelBlockCount !== undefined) {
          finalResult.parallelBlockCount =
            (finalResult.parallelBlockCount ?? 0) + result.parallelBlockCount;
        }
        if (result.mergeInputTokens !== undefined) {
          finalResult.mergeInputTokens =
            (finalResult.mergeInputTokens ?? 0) + result.mergeInputTokens;
        }
        if (result.repairAttempted === true) {
          finalResult.repairAttempted = true;
        }
        if (result.actions !== undefined) finalActions.push(...result.actions);
        if (result.rawRefs !== undefined) finalRawRefs.push(...result.rawRefs);
        if (result.qualityWarnings !== undefined) {
          finalQualityWarnings.push(...result.qualityWarnings);
        }
        finalResult.keptUserMessageCount = result.keptUserMessageCount;
        finalResult.keptHeadUserMessageCount = result.keptHeadUserMessageCount;

        if (result.tokensBefore - result.tokensAfter < 1024) break;
        if (!this.strategy.shouldBlock(result.tokensAfter)) break;
        compactedCount = this.strategy.computeCompactCount(this.agent.context.history, data.source);
        if (compactedCount === 0) break;
      }
      if (finalActions.length > 0) finalResult.actions = finalActions;
      if (finalRawRefs.length > 0) finalResult.rawRefs = finalRawRefs;
      if (finalQualityWarnings.length > 0) {
        finalResult.qualityWarnings = [...new Set(finalQualityWarnings)];
      }
      await this.agent.injection.injectAfterCompaction();
      this.syncCompactionBaseline();
      this.triggerPostCompactHook(data, finalResult);
      this.markCompleted();
      this.agent.emitEvent({ type: 'compaction.completed', result: finalResult });
      this.agent.turn.onCompactionFinished();
    } catch (error) {
      // Abort errors are settled by the `finally` below, which releases the
      // lock if this worker still owns it.
      if (isAbortError(error)) return;
      const blockedByTurn = this.compacting?.blockedByTurn === true;
      this.cancel();
      this.agent.log.error('compaction failed', { error });
      if (blockedByTurn) {
        throw error;
      }
      this.agent.emitEvent({
        type: 'error',
        ...toKimiErrorPayload(error),
      });
    } finally {
      this.releaseLockIfOwned();
    }
  }

  private async compactionRound(
    round: number,
    signal: AbortSignal,
    data: Readonly<CompactionBeginData>,
    initialCompactedCount: number,
  ) {
    const startedAt = Date.now();
    const originalHistory = [...this.agent.context.history];
    const tokensBefore = estimateTokensForMessages(originalHistory);
    const retryCount = { value: 0 };
    try {
      let compactedCount = initialCompactedCount;

      await this.triggerPreCompactHook(data, tokensBefore, signal);

      const model = this.agent.config.model;
      let summary: string;
      let usage: TokenUsage | null = null;
      let parallelBlockCount = 0;
      let mergeInputTokens: number | undefined;
      let repairAttempted = false;
      let usedEmergencyBackstop = false;
      let messagesToCompact: readonly Message[] = originalHistory.slice(0, compactedCount);
      let plan = this.planner.plan(originalHistory, compactedCount);
      const provider = this.createCompactionProvider(
        estimateTokensForMessages(messagesToCompact),
      );
      // Volatile phase signal so live clients can render phase-aware progress.
      this.emitCompactionProgress({
        phase: 'summarizing',
        streamKind: 'summary',
        fraction: PROGRESS_WEIGHT_PLAN,
      });
      const summarized = await this.summarizeCompactedPrefix({
        signal,
        provider,
        messagesToCompact,
        plan,
        instruction: data.instruction,
        retryCount,
        originalHistory,
        compactedCount,
      });
      summary = summarized.summary;
      usage = summarized.usage;
      parallelBlockCount = summarized.parallelBlockCount;
      mergeInputTokens = summarized.mergeInputTokens;
      compactedCount = summarized.compactedCount;
      messagesToCompact = summarized.messagesToCompact;
      usedEmergencyBackstop = summarized.usedEmergencyBackstop;
      plan = this.planner.plan(originalHistory, compactedCount);

      // Archive compacted tool-exchange groups so their original content stays
      // recoverable via liora-expand after the prefix is summarized away.
      const { rawRefs: archivedRawRefs, guidance: archiveGuidance } =
        this.archiveCompactedToolExchanges(originalHistory, plan);
      if (archivedRawRefs !== plan.rawRefs) {
        plan = { ...plan, rawRefs: archivedRawRefs as typeof plan.rawRefs };
      }

      // Volatile phase signal: summary validation / repair begins.
      this.emitCompactionProgress({
        phase: 'repairing',
        streamKind: 'repair',
        fraction: this.fractionForMergeDone(),
      });
      const initialQuality = validateInitialCompactionSummary(summary, plan, messagesToCompact);
      let quality: CompactionQualityResult = initialQuality;
      if (initialQuality.critical.length > 0 && !usedEmergencyBackstop) {
        const repair = await this.repairSummaryForQuality(
          signal,
          provider,
          messagesToCompact,
          plan,
          data.instruction,
          initialQuality,
        );
        summary = repair.summary;
        repairAttempted = true;
        if (repair.usage !== null) {
          usage = mergeTokenUsage(usage, repair.usage);
        }
        const repairedQuality = validateInitialCompactionSummary(summary, plan, messagesToCompact);
        // The initial summary was replaced by the repair, so its critical errors no longer
        // apply to the current artifact. Carry forward only warnings (for telemetry) and
        // treat the repaired summary as the source of truth for critical checks.
        const merged = mergeCompactionQualityResults(initialQuality, repairedQuality);
        quality = {
          critical: repairedQuality.critical,
          warnings: merged.warnings,
          warningCategories: merged.warningCategories,
          signals: repairedQuality.signals ?? initialQuality.signals,
        };
        if (repairedQuality.critical.length > 0) {
          const evidenceOnly =
            isMissingEvidenceQualityFailure(repairedQuality) &&
            repairedQuality.critical.every((item) => item.includes('durable evidence'));
          if (!evidenceOnly) {
            // Surviving non-evidence criticals are deliberately NOT thrown here:
            // throwing would hard-stall the turn. They propagate to the final
            // quality gate below, which swaps in the deterministic backstop and
            // lets the turn resume on a well-formed summary.
            this.agent.telemetry.track('compaction_qc_repair_unresolved', {
              critical_count: repairedQuality.critical.length,
            });
          }
          // Evidence-id gaps are recovered deterministically after enrichment.
        }
      }

      if (usage !== null) {
        this.agent.usage.record(model, usage);
      }

      const newHistory = this.agent.context.history;
      for (let i = 0; i < originalHistory.length; i++) {
        if (newHistory[i] !== originalHistory[i]) {
          // History changed during compaction, likely due to undo
          this.cancel();
          return undefined;
        }
      }

      const enrichment = this.enrichCompactionSummary({
        summary,
        messagesToCompact,
        plan,
      });
      summary = enrichment.summary;
      const ultraworkSnapshot = enrichment.ultraworkSnapshot;
      if (archiveGuidance.length > 0) {
        summary = `${summary.trimEnd()}${archiveGuidance}`;
      }
      let contextSummary = buildCompactionSummaryText(summary);
      let summaryTokens = estimateTokens(contextSummary);
      let retained: readonly Message[] = this.agent.context.history.slice(compactedCount);
      let retainedTokens = estimateTokensForMessages(retained);
      let tokensAfter = summaryTokens + retainedTokens;
      let renderedQuality = validateRenderedCompactionSummary(
        summary,
        plan,
        messagesToCompact,
        tokensAfter,
      );
      quality = mergeCompactionQualityResults(quality, renderedQuality);
      if (ultraworkSnapshot !== undefined) {
        const ultraworkQuality = validateUltraworkCompactionContinuity(summary, ultraworkSnapshot);
        quality = mergeCompactionQualityResults(quality, ultraworkQuality);
      }
      const evidenceRepair = await this.applyEvidenceSecondChanceRepair({
        signal,
        provider,
        messagesToCompact,
        plan,
        instruction: data.instruction,
        quality,
        summary,
        usage,
        archiveGuidance,
        compactedCount,
        ultraworkSnapshot,
        usedEmergencyBackstop,
        contextSummary,
        summaryTokens,
        retained,
        retainedTokens,
        tokensAfter,
      });
      summary = evidenceRepair.summary;
      usage = evidenceRepair.usage;
      quality = evidenceRepair.quality;
      repairAttempted = repairAttempted || evidenceRepair.repairAttempted;
      contextSummary = evidenceRepair.contextSummary;
      summaryTokens = evidenceRepair.summaryTokens;
      retained = evidenceRepair.retained;
      retainedTokens = evidenceRepair.retainedTokens;
      tokensAfter = evidenceRepair.tokensAfter;

      // Last-resort: splice missing durable IDs from the compacted history into the
      // summary. Hard-failing auto-compaction here freezes long sessions forever.
      if (
        quality.critical.length > 0 &&
        !usedEmergencyBackstop &&
        isMissingEvidenceQualityFailure(quality)
      ) {
        const injected = injectMissingDurableEvidenceIds(summary, messagesToCompact);
        if (injected.injectedIds.length > 0) {
          this.agent.telemetry.track('compaction_evidence_ids_injected', {
            injected_count: injected.injectedIds.length,
            injected_ids: injected.injectedIds.join(','),
          });
          const revalidated = this.revalidateAfterEvidenceRepair({
            summary: injected.summary,
            plan,
            messagesToCompact,
            archiveGuidance,
            compactedCount,
            priorQuality: quality,
            ultraworkSnapshot,
          });
          summary = revalidated.summary;
          quality = stripResolvedEvidenceCriticals(
            revalidated.quality,
          ) as CompactionQualityResult;
          contextSummary = revalidated.contextSummary;
          summaryTokens = revalidated.summaryTokens;
          retained = revalidated.retained;
          retainedTokens = revalidated.retainedTokens;
          tokensAfter = revalidated.tokensAfter;
          repairAttempted = true;
        }
      }

      if (quality.critical.length > 0 && !usedEmergencyBackstop) {
        // Criticals that survive every repair pass must not hard-stall the turn:
        // swap in the deterministic extractive backstop and continue assembling so
        // the session keeps a well-formed summary instead of freezing.
        summary = buildEmergencyBackstopSummary(messagesToCompact, plan, data.instruction);
        usedEmergencyBackstop = true;
        contextSummary = buildCompactionSummaryText(summary);
        summaryTokens = estimateTokens(contextSummary);
        tokensAfter = summaryTokens + retainedTokens;
        this.agent.telemetry.track('compaction_qc_fallback_backstop', {
          critical_count: quality.critical.length,
        });
      }

      // Volatile phase signal: assembly / context rebuild begins.
      this.emitCompactionProgress({
        phase: 'finalizing',
        fraction: this.fractionForFinalizing(),
      });
      const result = this.assembleCompactionResult({
        summary,
        contextSummary,
        compactedCount,
        tokensBefore,
        tokensAfter,
        plan,
        quality,
        summaryTokens,
        retainedTokens,
        retainedCount: retained.length,
        parallelBlockCount,
        mergeInputTokens,
        repairAttempted,
        usedEmergencyBackstop,
        source: data.source,
        provider,
      });
      const recallMemorySavedCount = await this.persistCompactionRecall(result);
      const qualitySignals = quality.signals;
      const qualityWarningCategories = result.qualityWarningCategories ?? [];

      const durationMs = Date.now() - startedAt;
      const finishedTelemetry = {
        source: data.source,
        tokensBefore: result.tokensBefore,
        tokensAfter: result.tokensAfter,
        summaryTokens: result.summaryTokens,
        retainedTokens: result.retainedTokens,
        compactedTokens: result.compactedTokens,
        durationMs,
        compactedCount: result.compactedCount,
        retryCount: retryCount.value,
        parallelBlockCount,
        qualityWarningCount: result.qualityWarnings.length,
        qualityWarningCategories,
        repairAttempted,
        emergencyBackstopUsed: usedEmergencyBackstop,
        mergeInputTokens: mergeInputTokens ?? 0,
        providerContextManagement: formatContextManagementCapability(provider),
        contextPackVersion: result.contextPack.version,
        contextPackRawRefCount: result.contextPack.evidence.rawRefCount,
        contextPackActionCount: result.contextPack.evidence.actionTypes.length,
        contextPackRetainedMessageCount: result.contextPack.messageCounts.retained,
        contextOsStatus: result.contextPack.contextOS.continuity.status,
        contextOsScore: result.contextPack.contextOS.continuity.score,
        contextOsTierCount: result.contextPack.contextOS.memoryTiers.length,
        contextOsRehydrationKindCount: result.contextPack.contextOS.rehydrationRawRefKinds.length,
        recallEvalScore: qualitySignals?.recallEvalScore,
        evidenceIdRecallScore: qualitySignals?.evidenceIdRecallScore,
        criticalFactCount: qualitySignals?.criticalFactCount,
        placeholderItemCount: qualitySignals?.placeholderItemCount,
        tokensSavedRatio: qualitySignals?.tokensSavedRatio,
        failureSignature: qualitySignals?.failureSignature,
        recallMemorySavedCount,
        round,
        thinkingLevel: this.agent.config.thinkingLevel,
        usage,
        actionTypes: result.actions?.map((action) => action.type).join(',') ?? '',
        qualityWarnings: result.qualityWarnings?.join(',') ?? '',
      };
      this.agent.telemetry.track(
        'compaction_finished',
        compactionFinishedTelemetryProperties(finishedTelemetry),
      );
      this.agent.telemetry.track(
        'compaction_v2_finished',
        compactionV2FinishedTelemetryProperties(finishedTelemetry),
      );
      this.recordCompactionQuality({
        recallEvalScore: qualitySignals?.recallEvalScore,
        usedEmergencyBackstop,
        evidenceRepairAttempted: repairAttempted,
        evidenceRepairSucceeded: evidenceRepairSucceeded({
          repairAttempted,
          evidenceIdRecallScore: qualitySignals?.evidenceIdRecallScore,
          qualityWarningCategories: result.qualityWarningCategories ?? [],
        }),
      });
      const applied = this.agent.context.applyCompaction(result);
      this.lastCompactedTokenCount = applied.tokensAfter;
      return applied;
    } catch (error) {
      if (isAbortError(error)) return;
      this.agent.telemetry.track('compaction_failed', {
        source: data.source,
        tokens_before: tokensBefore,
        duration_ms: Date.now() - startedAt,
        round,
        retry_count: retryCount.value,
        thinking_level: this.agent.config.thinkingLevel,
        error_type: error instanceof Error ? error.name : 'Unknown',
      });
      if (isKimiError(error) && error.code === ErrorCodes.AUTH_LOGIN_REQUIRED) throw error;
      throw new LioraError(ErrorCodes.COMPACTION_FAILED, String(error), { cause: error });
    }
  }

  /**
   * Compaction is a logic-only summarizer slice (not a Subagent): no tools,
   * thinking off, cost-aware model when configured.
   */
  /** Summaries never need tool schemas — empty list keeps capacity pressure down. */
  private static readonly COMPACTION_GENERATE_TOOLS: Tool[] = [];

  private compactionModelAlias: string | undefined;

  private createCompactionProvider(usedContextTokens: number): ChatProvider {
    // When a dedicated compaction model is configured, summarize with it
    // instead of the (usually more expensive) main model. Without an explicit
    // alias, pick the lowest local models.*.cost (then name-heuristic cheap
    // tier) so routine compaction does not spend main-model tokens. The alias
    // is resolved through the same ModelProvider so auth/routing stays consistent.
    const configuredCompactionModel = this.agent.kimiConfig?.loopControl?.compactionModel;
    const compactionModelAlias = resolveCompactionModelAlias({
      explicit: configuredCompactionModel,
      models: this.agent.kimiConfig?.models,
      minContextTokens: usedContextTokens > 0 ? usedContextTokens : undefined,
    });
    this.compactionModelAlias =
      compactionModelAlias !== undefined && compactionModelAlias.length > 0
        ? compactionModelAlias
        : this.agent.config.modelAlias;
    let resolvedCompaction: ResolvedRuntimeProvider | undefined;
    if (compactionModelAlias !== undefined) {
      try {
        resolvedCompaction = this.agent.modelProvider?.resolveProviderConfig(compactionModelAlias);
      } catch (error) {
        // A misconfigured explicit compactionModel keeps surfacing; a merely
        // inferred alias falls back to the main model instead of failing
        // compaction.
        if (configuredCompactionModel !== undefined) throw error;
        this.agent.log.warn('inferred cheap compaction model did not resolve', error);
        resolvedCompaction = undefined;
        this.compactionModelAlias = this.agent.config.modelAlias;
      }
    }
    const capability: ModelCapability = resolvedCompaction?.modelCapabilities
      ?? this.agent.config.modelCapabilities;
    const maxContextTokens = capability.max_context_tokens;
    const defaultCompactionCap =
      maxContextTokens > 0
        ? Math.min(maxContextTokens, DEFAULT_COMPACTION_MAX_COMPLETION_TOKENS)
        : undefined;
    const budget = resolveCompletionBudget({
      maxOutputSize: this.agent.config.maxOutputSize ?? defaultCompactionCap,
      reservedContextSize: this.agent.kimiConfig?.loopControl?.reservedContextSize,
    });
    // Compaction must emit visible summary text. Thinking models can spend the
    // entire output budget on reasoning alone, which kosong surfaces as
    // APIEmptyResponseError — the root cause of compaction.failed in production.
    const baseProvider =
      resolvedCompaction !== undefined
        ? createProvider(resolvedCompaction.provider)
        : this.agent.config.provider;
    const withoutThinking = baseProvider.withThinking('off');
    let provider = applyCompletionBudget({
      provider: withoutThinking,
      budget,
      capability,
      usedContextTokens,
    });
    if (provider.withMaxCompletionTokens !== undefined) {
      const configuredCap = computeCompletionBudgetCap({
        budget: budget ?? { fallback: COMPACTION_MIN_OUTPUT_TOKENS },
        capability,
      });
      provider = provider.withMaxCompletionTokens(
        Math.max(COMPACTION_MIN_OUTPUT_TOKENS, configuredCap),
        {
          usedContextTokens,
          maxContextTokens,
        },
      );
    }
    return provider;
  }

  private compactionGenerateOptions(signal: AbortSignal): {
    readonly signal: AbortSignal;
    readonly runtimeModelAlias?: string;
  } {
    return {
      signal,
      runtimeModelAlias: this.compactionModelAlias,
    };
  }

  /**
   * Stream every compaction LLM call into `compaction.progress` so TUI can
   * show live summary text (main, parallel blocks, merge, and repair).
   *
   * `blocksCompleted` and `fraction` accept getters because parallel blocks
   * run concurrently: a snapshot taken when the callback is created goes stale
   * the moment another block finishes, and the slow block's next delta would
   * rewind the TUI's "block n/N" counter. Getters are resolved at emit time,
   * so every delta carries the live count.
   */
  private compactionStreamCallbacks(meta: {
    readonly phase: 'summarizing' | 'repairing' | 'finalizing';
    readonly streamKind: 'summary' | 'block' | 'merge' | 'repair';
    readonly blockIndex?: number;
    readonly blockCount?: number;
    readonly blocksCompleted?: number | (() => number);
    readonly fraction?: number | (() => number);
  }): {
    readonly onMessagePart: (part: {
      readonly type: string;
      readonly text?: string;
    }) => void;
  } {
    return {
      onMessagePart: (part) => {
        if (part.type !== 'text') return;
        const text = part.text ?? '';
        if (text.length === 0) return;
        this.agent.emitEvent({
          type: 'compaction.progress',
          phase: meta.phase,
          streamKind: meta.streamKind,
          blockIndex: meta.blockIndex,
          blockCount: meta.blockCount,
          blocksCompleted:
            typeof meta.blocksCompleted === 'function'
              ? meta.blocksCompleted()
              : meta.blocksCompleted,
          fraction: typeof meta.fraction === 'function' ? meta.fraction() : meta.fraction,
          delta: text,
        });
      },
    };
  }

  /** Emit a non-stream progress tick (phase / block completion / fraction). */
  private emitCompactionProgress(meta: {
    readonly phase: 'summarizing' | 'repairing' | 'finalizing';
    readonly streamKind?: 'summary' | 'block' | 'merge' | 'repair';
    readonly blockIndex?: number;
    readonly blockCount?: number;
    readonly blocksCompleted?: number;
    readonly fraction?: number;
    readonly blockDurationMs?: number;
    readonly blockTokens?: TokenUsage;
  }): void {
    this.agent.emitEvent({
      type: 'compaction.progress',
      phase: meta.phase,
      streamKind: meta.streamKind,
      blockIndex: meta.blockIndex,
      blockCount: meta.blockCount,
      blocksCompleted: meta.blocksCompleted,
      fraction: meta.fraction,
      blockDurationMs: meta.blockDurationMs,
      blockTokens: meta.blockTokens,
    });
  }

  /**
   * Map parallel-block completion into the summarizing band of overall progress.
   * plan(5%) + blocks(55% * done/N) — merge/repair/finalize advance later.
   */
  private fractionForBlocksCompleted(blocksCompleted: number, blockCount: number): number {
    if (blockCount <= 0) return PROGRESS_WEIGHT_PLAN;
    const done = Math.max(0, Math.min(blocksCompleted, blockCount));
    return PROGRESS_WEIGHT_PLAN + PROGRESS_WEIGHT_BLOCKS * (done / blockCount);
  }

  private fractionForMergeStart(blockCount: number): number {
    return this.fractionForBlocksCompleted(blockCount, blockCount);
  }

  private fractionForMergeDone(): number {
    return PROGRESS_WEIGHT_PLAN + PROGRESS_WEIGHT_BLOCKS + PROGRESS_WEIGHT_MERGE;
  }

  private fractionForRepairDone(): number {
    return this.fractionForMergeDone() + PROGRESS_WEIGHT_REPAIR;
  }

  private fractionForFinalizing(): number {
    return this.fractionForRepairDone() + PROGRESS_WEIGHT_FINALIZE * 0.5;
  }

  /**
   * Resolve initial parallel concurrency: config > env > default(2), clamped.
   * Adaptive controller may raise toward MAX on clean successes and drop on 429.
   */
  private resolveParallelBlockConcurrency(blockCount: number): number {
    const fromConfig = this.strategy.parallelBlockConcurrency ?? 0;
    const fromEnv = parseEnvConcurrency(process.env[PARALLEL_CONCURRENCY_ENV]);
    const requested =
      fromConfig > 0 ? fromConfig : fromEnv > 0 ? fromEnv : DEFAULT_PARALLEL_BLOCK_CONCURRENCY;
    // Scale slightly with block count: 2 blocks → 2; many blocks → up to max.
    const scaled =
      blockCount <= 2
        ? Math.min(requested, 2)
        : blockCount <= 4
          ? Math.min(requested, 3)
          : Math.min(requested, MAX_PARALLEL_BLOCK_CONCURRENCY);
    return Math.max(1, Math.min(MAX_PARALLEL_BLOCK_CONCURRENCY, scaled, blockCount));
  }





  private assembleCompactionResult(input: {
    readonly summary: string;
    readonly contextSummary: string;
    readonly compactedCount: number;
    readonly tokensBefore: number;
    readonly tokensAfter: number;
    readonly plan: CompactionPlan;
    readonly quality: CompactionQualityResult;
    readonly summaryTokens: number;
    readonly retainedTokens: number;
    readonly retainedCount: number;
    readonly parallelBlockCount: number;
    readonly mergeInputTokens: number | undefined;
    readonly repairAttempted: boolean;
    readonly usedEmergencyBackstop: boolean;
    readonly source: CompactionBeginData['source'];
    readonly provider: ChatProvider;
  }): CompletedCompactionResult {
    const compactionActions = buildEmergencyBackstopActions(
      input.plan.actions,
      input.compactedCount,
      input.usedEmergencyBackstop,
    );
    const backstopWarnings = emergencyBackstopWarnings(input.usedEmergencyBackstop);

    const resultWithoutContextPack: CompactionResultWithQualityWarnings = {
      summary: input.summary,
      contextSummary: input.contextSummary,
      compactedCount: input.compactedCount,
      tokensBefore: input.tokensBefore,
      tokensAfter: input.tokensAfter,
      algorithmVersion: input.plan.algorithmVersion,
      actions: compactionActions,
      rawRefs: input.plan.rawRefs,
      summaryTokens: input.summaryTokens,
      retainedTokens: input.retainedTokens,
      compactedTokens: input.plan.compactedTokens,
      qualityWarnings: mergeQualityWarningLists(
        input.plan.qualityWarnings,
        input.quality.warnings,
        backstopWarnings,
      ),
      qualityWarningCategories:
        input.quality.warningCategories.length > 0
          ? input.quality.warningCategories
          : undefined,
      parallelBlockCount:
        input.parallelBlockCount > 0 ? input.parallelBlockCount : undefined,
      mergeInputTokens: input.mergeInputTokens,
      repairAttempted: input.repairAttempted ? true : undefined,
    };
    const shouldIncludeQualitySignals = shouldIncludeCompactionQualitySignals({
      warningCategories: input.quality.warningCategories,
      failureSignature: input.quality.signals?.failureSignature,
    });
    return {
      ...resultWithoutContextPack,
      contextPack: this.buildContextPack(
        input.source,
        resultWithoutContextPack,
        input.retainedCount,
        input.provider,
        shouldIncludeQualitySignals ? input.quality.signals : undefined,
      ),
    };
  }

  private async applyEvidenceSecondChanceRepair(input: {
    readonly signal: AbortSignal;
    readonly provider: ChatProvider;
    readonly messagesToCompact: readonly Message[];
    readonly plan: CompactionPlan;
    readonly instruction: string | undefined;
    readonly quality: CompactionQualityResult;
    readonly summary: string;
    readonly usage: TokenUsage | null;
    readonly archiveGuidance: string;
    readonly compactedCount: number;
    readonly ultraworkSnapshot: ReturnType<typeof captureUltraworkEnvelopeSnapshot>;
    readonly usedEmergencyBackstop: boolean;
    readonly contextSummary: string;
    readonly summaryTokens: number;
    readonly retained: readonly Message[];
    readonly retainedTokens: number;
    readonly tokensAfter: number;
  }): Promise<{
    summary: string;
    usage: TokenUsage | null;
    quality: CompactionQualityResult;
    repairAttempted: boolean;
    contextSummary: string;
    summaryTokens: number;
    retained: readonly Message[];
    retainedTokens: number;
    tokensAfter: number;
  }> {
    let {
      summary,
      usage,
      quality,
      contextSummary,
      summaryTokens,
      retained,
      retainedTokens,
      tokensAfter,
    } = input;
    let repairAttempted = false;

    if (
      quality.critical.length === 0 ||
      input.usedEmergencyBackstop ||
      !isMissingEvidenceQualityFailure(quality)
    ) {
      return {
        summary,
        usage,
        quality,
        repairAttempted,
        contextSummary,
        summaryTokens,
        retained,
        retainedTokens,
        tokensAfter,
      };
    }

    this.agent.telemetry.track('compaction_evidence_repair_started', {
      critical_count: quality.critical.length,
      warning_categories: quality.warningCategories.join(','),
      evidence_id_recall_score: quality.signals?.evidenceIdRecallScore,
    });
    const repair = await this.repairSummaryForQuality(
      input.signal,
      input.provider,
      input.messagesToCompact,
      input.plan,
      input.instruction,
      quality,
    );
    summary = repair.summary;
    repairAttempted = true;
    if (repair.usage !== null) {
      usage = mergeTokenUsage(usage, repair.usage);
    }
    const revalidated = this.revalidateAfterEvidenceRepair({
      summary: repair.summary,
      plan: input.plan,
      messagesToCompact: input.messagesToCompact,
      archiveGuidance: input.archiveGuidance,
      compactedCount: input.compactedCount,
      priorQuality: quality,
      ultraworkSnapshot: input.ultraworkSnapshot,
    });
    this.agent.telemetry.track('compaction_evidence_repair_finished', {
      critical_count: revalidated.quality.critical.length,
      warning_categories: revalidated.quality.warningCategories.join(','),
      evidence_id_recall_score: revalidated.quality.signals?.evidenceIdRecallScore,
      repaired_ok: revalidated.quality.critical.length === 0,
    });

    return {
      summary: revalidated.summary,
      usage,
      quality: revalidated.quality,
      repairAttempted,
      contextSummary: revalidated.contextSummary,
      summaryTokens: revalidated.summaryTokens,
      retained: revalidated.retained,
      retainedTokens: revalidated.retainedTokens,
      tokensAfter: revalidated.tokensAfter,
    };
  }

  private revalidateAfterEvidenceRepair(input: {
    readonly summary: string;
    readonly plan: CompactionPlan;
    readonly messagesToCompact: readonly Message[];
    readonly archiveGuidance: string;
    readonly compactedCount: number;
    readonly priorQuality: CompactionQualityResult;
    readonly ultraworkSnapshot: ReturnType<typeof captureUltraworkEnvelopeSnapshot>;
  }): {
    summary: string;
    quality: CompactionQualityResult;
    contextSummary: string;
    summaryTokens: number;
    retained: readonly Message[];
    retainedTokens: number;
    tokensAfter: number;
  } {
    let summary = this.postProcessSummary(input.summary);
    summary = this.renderStructuredV2Summary(summary, input.plan);
    if (input.archiveGuidance.length > 0) {
      summary = `${summary.trimEnd()}${input.archiveGuidance}`;
    }
    const contextSummary = buildCompactionSummaryText(summary);
    const summaryTokens = estimateTokens(contextSummary);
    const retained = this.agent.context.history.slice(input.compactedCount);
    const retainedTokens = estimateTokensForMessages(retained);
    const tokensAfter = summaryTokens + retainedTokens;
    const renderedQuality = validateRenderedCompactionSummary(
      summary,
      input.plan,
      input.messagesToCompact,
      tokensAfter,
    );
    let quality: CompactionQualityResult = {
      critical: renderedQuality.critical,
      warnings: mergeCompactionQualityResults(input.priorQuality, renderedQuality).warnings,
      warningCategories: mergeCompactionQualityResults(input.priorQuality, renderedQuality)
        .warningCategories,
      signals: renderedQuality.signals ?? input.priorQuality.signals,
    };
    if (input.ultraworkSnapshot !== undefined) {
      quality = mergeCompactionQualityResults(
        quality,
        validateUltraworkCompactionContinuity(summary, input.ultraworkSnapshot),
      );
    }
    return {
      summary,
      quality,
      contextSummary,
      summaryTokens,
      retained,
      retainedTokens,
      tokensAfter,
    };
  }

  private enrichCompactionSummary(input: {
    readonly summary: string;
    readonly messagesToCompact: readonly Message[];
    readonly plan: CompactionPlan;
  }): {
    summary: string;
    ultraworkSnapshot: ReturnType<typeof captureUltraworkEnvelopeSnapshot>;
  } {
    let summary = this.postProcessSummary(input.summary);
    summary = this.appendExtractedFactsAndAnchor(summary);
    summary = this.appendSwarmRunsSection(summary, input.messagesToCompact);
    const { summary: withUltrawork, ultraworkSnapshot } =
      this.appendUltraworkCompactionSections(summary);
    summary = this.renderStructuredV2Summary(withUltrawork, input.plan);
    return { summary, ultraworkSnapshot };
  }

  private appendExtractedFactsAndAnchor(summary: string): string {
    const newFacts = extractFactsFromSummary(summary);
    this.extractedFacts = Array.from(mergeFactSets(this.extractedFacts, newFacts));
    const memoryBlock = formatFactsAsMemoryBlock(this.extractedFacts);
    let next = summary;
    if (memoryBlock.length > 0) {
      next = `${next.trim()}\n\n${memoryBlock}`;
    }
    if (this.anchor !== null) {
      const diff = extractAnchorDiff(next);
      this.anchor = mergeIntoAnchor(this.anchor, diff);
      const anchorText = renderAnchor(this.anchor);
      if (anchorText.length > 0) {
        next = `${anchorText}\n\n---\n\n${next.trim()}`;
      }
    }
    return next;
  }

  private appendSwarmRunsSection(
    summary: string,
    messagesToCompact: readonly Message[],
  ): string {
    const swarmSection = renderSwarmRunsMemorySection(
      extractSwarmRunsFromMessages(messagesToCompact),
    );
    if (swarmSection.length === 0) return summary;
    return `${summary.trim()}\n\n${swarmSection}`;
  }

  private appendUltraworkCompactionSections(summary: string): {
    summary: string;
    ultraworkSnapshot: ReturnType<typeof captureUltraworkEnvelopeSnapshot>;
  } {
    const ultraworkSnapshot = captureUltraworkEnvelopeSnapshot(this.agent, {
      compactionBoundary: true,
    });
    const ultraworkEnvelope =
      ultraworkSnapshot === undefined
        ? undefined
        : buildUltraworkCompactionEnvelope(this.agent, { compactionBoundary: true });
    if (ultraworkEnvelope === undefined) {
      return { summary, ultraworkSnapshot };
    }
    let next = `${summary.trim()}\n\n${ultraworkEnvelope}`;
    const ultraworkRunsSection = renderUltraworkRunsMemorySection(ultraworkSnapshot!);
    if (ultraworkRunsSection.length > 0) {
      next = `${next.trim()}\n\n${ultraworkRunsSection}`;
    }
    this.agent.telemetry.track('compaction.ultrawork_checkpoint', {
      run_id: ultraworkSnapshot!.run.id,
      stage: ultraworkSnapshot!.run.stage,
      effective_stage: ultraworkSnapshot!.effectiveStage ?? ultraworkSnapshot!.run.stage,
      pending_nodes: String(
        ultraworkSnapshot!.run.workGraph?.nodes.filter((node) => node.status !== 'done')
          .length ?? 0,
      ),
      deferred_reason: this.agent.ultraSwarmRun !== undefined ? 'ultra_swarm_active' : 'none',
      envelope_token_estimate: String(estimateTokens(ultraworkEnvelope)),
    });
    return { summary: next, ultraworkSnapshot };
  }

  private async summarizeCompactedPrefix(input: {
    readonly signal: AbortSignal;
    readonly provider: ChatProvider;
    readonly messagesToCompact: readonly Message[];
    readonly plan: CompactionPlan;
    readonly instruction: string | undefined;
    readonly retryCount: { value: number };
    readonly originalHistory: readonly Message[];
    readonly compactedCount: number;
  }): Promise<{
    summary: string;
    usage: TokenUsage | null;
    parallelBlockCount: number;
    mergeInputTokens: number | undefined;
    compactedCount: number;
    messagesToCompact: readonly Message[];
    usedEmergencyBackstop: boolean;
  }> {
    let summary: string;
    let usage: TokenUsage | null = null;
    let parallelBlockCount = 0;
    let compactedCount = input.compactedCount;
    let messagesToCompact = input.messagesToCompact;
    let usedEmergencyBackstop = false;

    const compactedTokens = estimateTokensForMessages(messagesToCompact);
    const parallelThreshold = this.strategy.parallelBlockThreshold ?? DEFAULT_PARALLEL_BLOCK_THRESHOLD;
    const shouldParallel = shouldUseParallelSummarize({
      compactedTokens,
      messageCount: messagesToCompact.length,
      parallelThreshold,
    });
    const blocks = shouldParallel ? this.splitIntoBlocks(messagesToCompact) : [];

    if (shouldParallel && blocks.length > 1) {
      try {
        const parallelResult = await this.parallelSummarize(
          input.signal,
          input.provider,
          blocks,
          input.plan,
          input.instruction,
          input.retryCount,
        );
        return {
          summary: parallelResult.summary,
          usage: parallelResult.usage,
          parallelBlockCount: parallelResult.parallelBlockCount,
          mergeInputTokens: parallelResult.mergeInputTokens,
          compactedCount,
          messagesToCompact,
          usedEmergencyBackstop,
        };
      } catch (error) {
        // Parallel path failed: fall through to sequential (which has classical
        // backstop). Only rethrow aborts / auth that must surface to the user.
        if (isAbortError(error)) throw error;
        if (isKimiError(error) && error.code === ErrorCodes.AUTH_LOGIN_REQUIRED) throw error;
        if (!isCompactionSummarizerError(error) && !shouldUseClassicalCompactionFallback(error)) {
          throw error;
        }
        this.agent.telemetry.track('compaction_parallel_fallback_sequential', {
          error_type: error instanceof Error ? error.name : 'Unknown',
        });
      }
    }

    const seqResult = await this.sequentialSummarize(
      input.signal,
      input.provider,
      messagesToCompact,
      input.plan,
      this.compactionInstruction(input.instruction, input.plan),
      input.retryCount,
    );
    summary = seqResult.summary;
    usage = seqResult.usage;
    compactedCount = seqResult.finalCompactedCount;
    messagesToCompact = input.originalHistory.slice(0, compactedCount);
    usedEmergencyBackstop = seqResult.usedEmergencyBackstop;
    return {
      summary,
      usage,
      parallelBlockCount,
      mergeInputTokens: undefined,
      compactedCount,
      messagesToCompact,
      usedEmergencyBackstop,
    };
  }

  private async sequentialSummarize(
    signal: AbortSignal,
    provider: ChatProvider,
    messagesToCompact: readonly Message[],
    plan: CompactionPlan,
    instruction: string,
    retryCountRef: { value: number },
  ): Promise<{
    summary: string;
    usage: TokenUsage | null;
    finalCompactedCount: number;
    usedEmergencyBackstop: boolean;
  }> {
    const delays = retryBackoffDelays(MAX_COMPACTION_RETRY_ATTEMPTS);
    let compactedCount = messagesToCompact.length;
    let usage: TokenUsage | null = null;

    while (true) {
      const currentPrefix = messagesToCompact.slice(0, compactedCount);
      const messages = [
        ...this.agent.context.projectForCompaction(currentPrefix),
        createUserMessage(renderPrompt(compactionInstructionTemplate, { customInstruction: instruction })),
      ];
      try {
        const response = await this.agent.generate(
          provider,
          this.agent.config.systemPrompt,
          FullCompaction.COMPACTION_GENERATE_TOOLS,
          messages,
          this.compactionStreamCallbacks({
            phase: 'summarizing',
            streamKind: 'summary',
          }),
          this.compactionGenerateOptions(signal),
        );
        if (response.finishReason === 'truncated') {
          throw new CompactionTruncatedError();
        }
        usage = response.usage;
        return {
          summary: extractCompactionSummary(response),
          usage,
          finalCompactedCount: compactedCount,
          usedEmergencyBackstop: false,
        };
      } catch (error) {
        if (
          error instanceof APIContextOverflowError ||
          error instanceof CompactionTruncatedError ||
          error instanceof APIEmptyResponseError
        ) {
          compactedCount = this.strategy.reduceCompactOnOverflow(currentPrefix);
        } else if (!isRetryableGenerateError(error)) {
          // Non-retryable provider/model failures (e.g. 400 unsupported params,
          // permanent auth) must not hard-stall the turn — fall back to the
          // deterministic extractive summary (OpenHands-style classical condenser
          // / Claude Code micro-compact philosophy: keep working set without LLM).
          if (shouldUseClassicalCompactionFallback(error)) {
            this.agent.telemetry.track('compaction_classical_fallback', {
              reason: 'non_retryable_generate',
              error_type: error instanceof Error ? error.name : 'Unknown',
            });
            return {
              summary: buildEmergencyBackstopSummary(currentPrefix, plan, instruction),
              usage,
              finalCompactedCount: compactedCount,
              usedEmergencyBackstop: true,
            };
          }
          throw error;
        }
        if (retryCountRef.value + 1 >= MAX_COMPACTION_RETRY_ATTEMPTS) {
          if (isCompactionSummarizerError(error) || shouldUseClassicalCompactionFallback(error)) {
            this.agent.telemetry.track('compaction_classical_fallback', {
              reason: 'retry_exhausted',
              error_type: error instanceof Error ? error.name : 'Unknown',
            });
            return {
              summary: buildEmergencyBackstopSummary(currentPrefix, plan, instruction),
              usage,
              finalCompactedCount: compactedCount,
              usedEmergencyBackstop: true,
            };
          }
          throw error;
        }
        await sleepForRetry(delays[retryCountRef.value]!, signal);
        retryCountRef.value += 1;
      }
    }
  }

  /**
   * Single block generate with dedicated rate-limit / transient retries.
   * Parallel blocks share retryCountRef only for telemetry; each block has its own attempt budget.
   */
  private async generateCompactionBlockWithRetry(input: {
    readonly signal: AbortSignal;
    readonly provider: ChatProvider;
    readonly messages: Message[];
    readonly streamCallbacks: ReturnType<FullCompaction['compactionStreamCallbacks']>;
    readonly retryCountRef: { value: number };
    readonly onRateLimit?: () => void;
  }): Promise<Awaited<ReturnType<Agent['generate']>>> {
    const delays = retryBackoffDelays(PARALLEL_BLOCK_RATE_LIMIT_RETRIES);
    let attempt = 0;
    while (true) {
      try {
        return await this.agent.generate(
          input.provider,
          this.agent.config.systemPrompt,
          FullCompaction.COMPACTION_GENERATE_TOOLS,
          input.messages,
          input.streamCallbacks,
          this.compactionGenerateOptions(input.signal),
        );
      } catch (error) {
        if (isRateLimitLikeError(error)) {
          input.onRateLimit?.();
        }
        if (!isRetryableGenerateError(error) || attempt + 1 >= PARALLEL_BLOCK_RATE_LIMIT_RETRIES) {
          throw error;
        }
        input.retryCountRef.value += 1;
        await sleepForRetry(delays[attempt] ?? delays[delays.length - 1]!, input.signal);
        attempt += 1;
      }
    }
  }

  private async parallelSummarize(
    signal: AbortSignal,
    provider: ChatProvider,
    blocks: readonly (readonly Message[])[],
    plan: CompactionPlan,
    instruction: string | undefined,
    retryCountRef: { value: number },
  ): Promise<{
    summary: string;
    usage: TokenUsage | null;
    parallelBlockCount: number;
    mergeInputTokens: number;
  }> {
    // Order blocks by density (highest surprise first) so the merge pass
    // prioritizes detail from novel, information-dense regions over sparse
    // boilerplate when fitting the merged summary.
    const orderedBlocks = [...blocks].sort(
      (a, b) => blockDensity(b) - blockDensity(a),
    );
    const blockPrompt = renderPrompt(compactionInstructionTemplate, {
      customInstruction: this.compactionInstruction(
        instruction,
        plan,
        'This is one block of a larger conversation. Summarize only the events in this block.',
      ),
    });
    const blockCount = orderedBlocks.length;
    const initialConcurrency = this.resolveParallelBlockConcurrency(blockCount);
    const limiter = new AdaptiveConcurrencyLimiter(initialConcurrency);
    let blocksCompleted = 0;

    this.emitCompactionProgress({
      phase: 'summarizing',
      streamKind: 'block',
      blockIndex: 0,
      blockCount,
      blocksCompleted: 0,
      fraction: this.fractionForBlocksCompleted(0, blockCount),
    });

    const blockResults = await mapWithConcurrency(
      orderedBlocks,
      limiter,
      async (block, index) => {
        const startedAt = performance.now();
        const messages = [
          ...this.agent.context.projectForCompaction(block),
          createUserMessage(blockPrompt),
        ];
        try {
          const response = await this.generateCompactionBlockWithRetry({
            signal,
            provider,
            messages,
            streamCallbacks: this.compactionStreamCallbacks({
              phase: 'summarizing',
              streamKind: 'block',
              blockIndex: index + 1,
              blockCount,
              // Live getters, not snapshots: under concurrency a captured
              // count goes stale the moment another block finishes, and this
              // block's next delta would rewind the TUI's "block n/N" counter.
              blocksCompleted: () => blocksCompleted,
              fraction: () => this.fractionForBlocksCompleted(blocksCompleted, blockCount),
            }),
            retryCountRef,
            onRateLimit: () => {
              limiter.noteRateLimit();
            },
          });
          if (response.finishReason === 'truncated') {
            throw new CompactionTruncatedError();
          }
          limiter.noteSuccess();
          blocksCompleted += 1;
          this.emitCompactionProgress({
            phase: 'summarizing',
            streamKind: 'block',
            blockIndex: index + 1,
            blockCount,
            blocksCompleted,
            fraction: this.fractionForBlocksCompleted(blocksCompleted, blockCount),
            // Per-block observability: only this completion tick carries the
            // block's own latency and usage. `blocksCompleted`/`fraction`
            // stay live values (read at emit time above) so the monotonic
            // getter design is preserved under concurrency.
            blockDurationMs: performance.now() - startedAt,
            blockTokens: response.usage ?? undefined,
          });
          return {
            summary: extractCompactionSummary(response),
            usage: response.usage,
          };
        } catch (error) {
          if (isRateLimitLikeError(error)) {
            limiter.noteRateLimit();
          }
          throw error;
        }
      },
    );
    const usage = blockResults.reduce<TokenUsage | null>(
      (current, result) =>
        result.usage === null ? current : mergeTokenUsage(current, result.usage),
      null,
    );
    this.emitCompactionProgress({
      phase: 'summarizing',
      streamKind: 'merge',
      blockCount,
      blocksCompleted: blockCount,
      fraction: this.fractionForMergeStart(blockCount),
    });
    const mergeResult = await this.mergeBlockSummaries(
      signal,
      provider,
      blockResults.map((result) => result.summary),
      plan,
      instruction,
      retryCountRef,
    );
    this.emitCompactionProgress({
      phase: 'summarizing',
      streamKind: 'merge',
      blockCount,
      blocksCompleted: blockCount,
      fraction: this.fractionForMergeDone(),
    });
    return {
      summary: mergeResult.summary,
      usage: mergeTokenUsageOrNull(usage, mergeResult.usage),
      parallelBlockCount: blocks.length,
      mergeInputTokens: mergeResult.mergeInputTokens,
    };
  }

  private async mergeBlockSummaries(
    signal: AbortSignal,
    provider: ChatProvider,
    blockSummaries: readonly string[],
    plan: CompactionPlan,
    instruction: string | undefined,
    retryCountRef: { value: number },
  ): Promise<{ summary: string; usage: TokenUsage | null; mergeInputTokens: number }> {
    const blockText = blockSummaries
      .map((summary, index) => `## Block ${String(index + 1)}\n${summary.trim()}`)
      .join('\n\n');
    const mergePrompt = renderPrompt(compactionInstructionTemplate, {
      customInstruction: this.compactionInstruction(
        instruction,
        plan,
        [
          'Merge these block-level compaction summaries into one coherent replacement summary.',
          'Resolve duplicates and contradictions conservatively. Preserve cross-block next actions and raw refs.',
          blockText,
        ].join('\n\n'),
      ),
    });
    const messages = [createUserMessage(mergePrompt)];
    const mergeInputTokens = estimateTokensForMessages(messages);
    const delays = retryBackoffDelays(MAX_COMPACTION_MERGE_RETRY_ATTEMPTS);
    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_COMPACTION_MERGE_RETRY_ATTEMPTS; attempt++) {
      try {
        const response = await this.agent.generate(
          provider,
          this.agent.config.systemPrompt,
          FullCompaction.COMPACTION_GENERATE_TOOLS,
          messages,
          this.compactionStreamCallbacks({
            phase: 'summarizing',
            streamKind: 'merge',
          }),
          this.compactionGenerateOptions(signal),
        );
        if (response.finishReason === 'truncated') {
          throw new CompactionTruncatedError();
        }
        return {
          summary: extractCompactionSummary(response),
          usage: response.usage,
          mergeInputTokens,
        };
      } catch (error) {
        lastError = error;
        if (
          attempt + 1 >= MAX_COMPACTION_MERGE_RETRY_ATTEMPTS ||
          !(
            error instanceof CompactionTruncatedError ||
            error instanceof APIEmptyResponseError ||
            isRetryableGenerateError(error)
          )
        ) {
          throw error;
        }
        await sleepForRetry(delays[attempt]!, signal);
        retryCountRef.value += 1;
      }
    }

    throw lastError;
  }

  private async repairSummaryForQuality(
    signal: AbortSignal,
    provider: ChatProvider,
    messagesToCompact: readonly Message[],
    plan: CompactionPlan,
    instruction: string | undefined,
    quality: CompactionQualityResult,
  ): Promise<{ summary: string; usage: TokenUsage | null }> {
    const repairPrompt = renderPrompt(compactionInstructionTemplate, {
      customInstruction: this.compactionInstruction(
        instruction,
        plan,
        [
          'The previous compaction summary failed deterministic quality checks.',
          `Failed checks: ${[...quality.critical, ...quality.warnings].join('; ')}`,
          quality.warningCategories.includes('missing_evidence_ids')
            ? 'Preserve every durable identifier from the compacted history: evidence_ids, WorkGraph/node ids, AC ids, and [liora-archived id=...] markers.'
            : 'Preserve durable identifiers (evidence_ids, node ids, archive markers) when they appear in the history.',
          'Produce a complete replacement summary. Keep the exact v2 section labels when you use structured memory.',
        ].join('\n\n'),
      ),
    });
    const messages = [
      ...this.agent.context.projectForCompaction(messagesToCompact),
      createUserMessage(repairPrompt),
    ];
    const response = await this.agent.generate(
      provider,
      this.agent.config.systemPrompt,
      FullCompaction.COMPACTION_GENERATE_TOOLS,
      messages,
      this.compactionStreamCallbacks({
        phase: 'repairing',
        streamKind: 'repair',
      }),
      this.compactionGenerateOptions(signal),
    );
    if (response.finishReason === 'truncated') {
      throw new CompactionTruncatedError();
    }
    return {
      summary: extractCompactionSummary(response),
      usage: response.usage,
    };
  }

  private splitIntoBlocks(messages: readonly Message[]): readonly (readonly Message[])[] {
    const target = this.strategy.parallelBlockTarget ?? DEFAULT_PARALLEL_BLOCK_TARGET;
    return splitMessagesIntoTokenBlocks(messages, target);
  }

  private async triggerPreCompactHook(
    data: Readonly<CompactionBeginData>,
    tokenCount: number,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted();
    await this.agent.hooks?.trigger('PreCompact', {
      matcherValue: data.source,
      signal,
      inputData: {
        trigger: data.source,
        tokenCount,
      },
    });
    signal.throwIfAborted();
  }

  private triggerPostCompactHook(
    data: Readonly<CompactionBeginData>,
    result: CompactionResult,
  ): void {
    void this.agent.hooks?.fireAndForgetTrigger('PostCompact', {
      matcherValue: data.source,
      inputData: {
        trigger: data.source,
        estimatedTokenCount: result.tokensAfter,
      },
    });
  }

  private buildContextPack(
    source: CompactionSource,
    result: CompactionResult,
    retainedMessageCount: number,
    provider: ChatProvider,
    qualitySignals?: CompactionQualitySignals,
  ): CompactionContextPack {
    const rawRefs = result.rawRefs ?? [];
    const actions = result.actions ?? [];
    const qualityWarnings = result.qualityWarnings ?? [];
    return {
      version: 'context_pack_v1',
      source,
      algorithmVersion: result.algorithmVersion,
      messageCounts: {
        summary: 1,
        compacted: result.compactedCount,
        retained: retainedMessageCount,
      },
      tokenBudget: {
        before: result.tokensBefore,
        after: result.tokensAfter,
        summary: result.summaryTokens ?? 0,
        retained: result.retainedTokens ?? 0,
        compacted: result.compactedTokens ?? 0,
      },
      evidence: {
        rawRefCount: rawRefs.length,
        rawRefKinds: uniqueSorted(rawRefs.map((ref) => ref.kind)),
        actionTypes: uniqueSorted(actions.map((action) => action.type)),
        qualityWarningCount: qualityWarnings.length,
      },
      controls: {
        parallelBlockCount: result.parallelBlockCount ?? 0,
        mergeInputTokens: result.mergeInputTokens ?? 0,
        repairAttempted: result.repairAttempted === true,
        providerContextManagement: formatContextManagementCapability(provider),
      },
      contextOS: this.buildContextOS(result, qualitySignals),
    };
  }

  private buildContextOS(
    result: CompactionResult,
    qualitySignals?: CompactionQualitySignals,
  ): CompactionContextOS {
    const memory = parseStructuredCompactionMemory(result.summary);
    const rawRefs = result.rawRefs ?? [];
    const rawRefKinds = uniqueSorted(rawRefs.map((ref) => ref.kind));
    const actionTypes = uniqueSorted((result.actions ?? []).map((action) => action.type));
    const fileHints = uniqueSorted([
      ...memory.filesTouched.flatMap(extractFileHints),
      ...this.extractedFacts
        .filter((fact) => fact.category === 'file')
        .map((fact) => fact.subject),
    ]).slice(0, 12);
    const retrievalQueries = uniqueHints([
      memory.currentGoal,
      ...memory.nextActions,
      ...fileHints.map((file) => `file:${file}`),
      ...memory.openQuestions,
      ...memory.failedAttempts,
      ...memory.decisions,
    ]).slice(0, 8);
    const continuity = evaluateContinuity(result, memory, retrievalQueries, qualitySignals);

    return {
      version: 'context_os_v0',
      memoryTiers: inferMemoryTiers(memory, rawRefKinds, actionTypes, fileHints),
      retrievalQueries,
      fileHints,
      rehydrationRawRefKinds: selectRehydrationRawRefKinds(
        rawRefKinds,
        continuity.status,
      ),
      qualitySignals,
      retrievalSignalCounts:
        qualitySignals === undefined
          ? undefined
          : {
              retrievalQueryCount: retrievalQueries.length,
              fileHintCount: fileHints.length,
              structuredItemCount: countStructuredMemoryItems(memory),
              rawRefKindCount: rawRefKinds.length,
            },
      continuity,
    };
  }

  private async persistCompactionRecall(result: CompletedCompactionResult): Promise<number> {
    const memory = this.agent.memory;
    if (memory === undefined || !memory.isEnabled()) return 0;
    const inputs = createCompactionRecallMemories(result);
    if (inputs.length === 0) return 0;

    let saved = 0;
    for (const input of inputs) {
      try {
        await memory.remember(input);
        saved += 1;
      } catch (error) {
        this.agent.log.warn('liora recall compaction memory save failed', error);
        this.agent.telemetry.track('liora_recall_compaction_memory_save_failed', {
          memory_kind: input.kind,
          memory_scope: input.scope,
          subject: input.subject,
        });
      }
    }
    if (saved > 0) {
      this.agent.telemetry.track('liora_recall_compaction_memory_saved', {
        saved_count: saved,
        requested_count: inputs.length,
        recall_eval_score: result.contextPack.contextOS.qualitySignals?.recallEvalScore,
        evidence_id_recall_score: result.contextPack.contextOS.qualitySignals?.evidenceIdRecallScore,
        critical_fact_count: result.contextPack.contextOS.qualitySignals?.criticalFactCount,
      });
    }
    return saved;
  }

  /**
   * Archive compacted tool-exchange groups so the model can recover their
   * original content via `liora-expand` after compaction. Returns rawRefs with
   * the resolved archive ids plus a short guidance section for the summary.
   *
   * Only tool_exchange groups are archived: they carry the command/output
   * detail the model most often needs to re-check. Plain user or assistant
   * text is summarized in place and is not worth the archive cost.
   *
   * Skipped during record replay (`records.restoring`) — on resume the archive
   * store is already populated, so re-archiving would both duplicate work and
   * write into the records stream while it is being replayed.
   */
  private archiveCompactedToolExchanges(
    messages: readonly Message[],
    plan: CompactionPlan,
  ): { rawRefs: readonly CompactionResultRawRef[]; guidance: string } {
    if (this.agent.records.restoring !== null) {
      return { rawRefs: plan.rawRefs, guidance: '' };
    }
    const compactedToolGroups = groupMessages(messages).filter(
      (group) => group.kind === 'tool_exchange' && group.end < plan.compactedCount,
    );
    if (compactedToolGroups.length === 0) {
      return { rawRefs: plan.rawRefs, guidance: '' };
    }

    const store = this.agent.tools.getStore();
    const archiveIds: string[] = [];
    const refByStart = new Map(plan.rawRefs.map((ref) => [ref.messageStart, ref]));
    for (const group of compactedToolGroups) {
      const rendered = renderMessagesToText(group.messages);
      if (rendered.trim().length === 0) continue;
      const labelParts = [
        'compaction',
        ...(group.toolNames.length > 0 ? [group.toolNames.join(',')] : []),
      ];
      const archived = archiveContent({
        store,
        content: rendered,
        label: labelParts.join(':'),
      });
      archiveIds.push(archived.id);
      const existing = refByStart.get(group.start);
      if (existing !== undefined) {
        refByStart.set(group.start, { ...existing, archiveId: archived.id });
      } else {
        refByStart.set(group.start, {
          kind: group.kind,
          messageStart: group.start,
          messageEnd: group.end,
          tokens: group.tokens,
          toolCallIds: group.toolCallIds,
          toolNames: group.toolNames,
          archiveId: archived.id,
        });
      }
    }

    const rawRefs = plan.rawRefs.map((ref) => refByStart.get(ref.messageStart) ?? ref);
    const guidance =
      archiveIds.length === 0
        ? ''
        : `\n\n<compaction-archives>Tool exchanges compacted above were archived. ` +
          `Use LioraExpand(id=...) to recover a group's original content when the summary is insufficient. ` +
          `archive_ids="${archiveIds.join(',')}"</compaction-archives>`;
    return { rawRefs, guidance };
  }

  private postProcessSummary(summary: string): string {
    const storeData = this.agent.tools.storeData();
    const todos = (storeData['todo'] as readonly TodoItem[] | undefined) ?? [];
    if (todos.length === 0) {
      return summary;
    }
    const todoMarkdown = renderTodoList(todos, '## TODO List');
    return `${summary.trim()}\n\n${todoMarkdown}`;
  }

  private compactionInstruction(
    instruction: string | undefined,
    plan: CompactionPlan | undefined,
    blockNote?: string,
  ): string {
    if (plan === undefined) return instruction ?? '';

    const preference = this.agent.getResponseLanguagePreference();
    const languageDirective =
      preference === undefined
        ? undefined
        : buildResponseLanguageDirective(preference, { wrapped: false });

    const lines = [
      instruction?.trim(),
      blockNote,
      'CONTEXT COMPACTION V2 OUTPUT CONTRACT:',
      'Preserve task continuity over compression ratio. Use the exact sections: current_goal, last_known_state, decisions, files_touched, failed_attempts, open_questions, next_actions, raw_refs.',
      'Mention uncertain facts as uncertain. Do not invent file paths, test results, or decisions.',
      languageDirective,
      `Compacted tokens: ${String(plan.compactedTokens)}. Retained recent tokens: ${String(plan.retainedTokens)}.`,
      `Raw refs available after compaction: ${plan.rawRefs.map(formatRawRef).join('; ') || 'none'}.`,
    ];
    return lines.filter((line): line is string => line !== undefined && line.length > 0).join('\n\n');
  }

  private renderStructuredV2Summary(summary: string, plan: CompactionPlan): string {
    const structuredMemory = parseStructuredCompactionMemory(summary);
    const filesTouched = this.extractedFacts.filter((fact) => fact.category === 'file');
    const decisions = this.extractedFacts.filter((fact) => fact.category === 'decision');
    const failures = this.extractedFacts.filter((fact) => fact.category === 'error');
    const nextActions = mergeStringLists(structuredMemory.nextActions, extractNextActions(summary));
    const currentGoal = structuredMemory.currentGoal ?? 'Continue the active user task from the compacted state.';
    const lastKnownState = mergeStringLists(structuredMemory.lastKnownState, [
      `${String(plan.compactedCount)} old messages were compacted; ${String(plan.retainedTokens)} estimated tokens remain in the recent live context.`,
    ]);
    const decisionItems = mergeStringLists(structuredMemory.decisions, factsToDetails(decisions));
    const fileItems = mergeStringLists(structuredMemory.filesTouched, factsToDetails(filesTouched));
    const failureItems = mergeStringLists(structuredMemory.failedAttempts, factsToDetails(failures));
    const rawRefItems = mergeStringLists(structuredMemory.rawRefs, plan.rawRefs.map(formatRawRef));
    const swarmRunItems = mergeStringLists(structuredMemory.swarmRuns, extractSwarmRunLines(summary));
    const ultraworkRunItems = mergeStringLists(
      structuredMemory.ultraworkRuns,
      extractUltraworkRunLines(summary),
    );

    return [
      '# SuperLiora Context Compaction v2 Memory',
      '',
      '## Resume Preflight',
      `- current_goal: ${currentGoal}`,
      '- last_known_state: Use the retained recent messages plus the structured memory below before taking the next action.',
      `- next_action: ${nextActions[0] ?? 'Inspect the retained recent context, then continue the pending implementation or verification step.'}`,
      '',
      '## Structured Working Memory',
      'current_goal:',
      `- ${currentGoal}`,
      'last_known_state:',
      formatStringList(lastKnownState),
      'decisions:',
      formatStringList(decisionItems),
      'files_touched:',
      formatStringList(fileItems),
      'failed_attempts:',
      formatStringList(failureItems),
      'open_questions:',
      formatStringList(structuredMemory.openQuestions),
      'next_actions:',
      formatStringList(nextActions),
      'raw_refs:',
      formatStringList(rawRefItems),
      'swarm_runs:',
      formatStringList(swarmRunItems),
      'ultrawork_runs:',
      formatStringList(ultraworkRunItems),
      '',
      '## Compacted Narrative',
      summary.trim(),
    ].join('\n');
  }
}

/**
 * Run async work with a fixed or adaptive concurrency limit.
 * Adaptive path polls the limiter so 429s can shrink in-flight fan-out without
 * restarting the whole parallel summarize pass.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number | AdaptiveConcurrencyLimiter,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  let active = 0;
  let settled = 0;
  let fatal: unknown;
  let wake: (() => void) | undefined;

  const notify = (): void => {
    wake?.();
    wake = undefined;
  };

  const waitSlot = async (): Promise<void> => {
    await new Promise<void>((resolve) => {
      wake = resolve;
    });
  };

  const currentLimit = (): number => {
    if (typeof concurrency === 'number') {
      return Math.max(1, Math.min(concurrency, items.length));
    }
    return Math.max(1, Math.min(concurrency.limit, items.length));
  };

  const runners: Promise<void>[] = [];

  const launch = (index: number, item: T): void => {
    active += 1;
    const run = (async () => {
      try {
        if (fatal !== undefined) return;
        results[index] = await worker(item, index);
      } catch (error) {
        if (fatal === undefined) fatal = error;
      } finally {
        active -= 1;
        settled += 1;
        notify();
      }
    })();
    runners.push(run);
  };

  while (settled < items.length) {
    if (fatal !== undefined) break;
    while (active < currentLimit() && nextIndex < items.length && fatal === undefined) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      if (item === undefined) break;
      launch(index, item);
    }
    if (settled >= items.length || fatal !== undefined) break;
    if (active >= currentLimit() || nextIndex >= items.length) {
      await waitSlot();
    }
  }

  await Promise.all(runners);
  if (fatal !== undefined) {
    // oxlint-disable-next-line typescript-eslint/only-throw-error
    throw fatal;
  }
  return results;
}

/**
 * Adaptive concurrency controller for parallel block summarize.
 * Starts at `initial`, drops on rate-limit, gently climbs after clean successes.
 */
class AdaptiveConcurrencyLimiter {
  private current: number;
  private successesSinceRaise = 0;

  constructor(initial: number) {
    this.current = Math.max(1, Math.min(MAX_PARALLEL_BLOCK_CONCURRENCY, initial));
  }

  get limit(): number {
    return this.current;
  }

  noteSuccess(): void {
    this.successesSinceRaise += 1;
    // Raise only after a short clean streak so we do not thrash the limit.
    if (this.successesSinceRaise >= 2 && this.current < MAX_PARALLEL_BLOCK_CONCURRENCY) {
      this.current += 1;
      this.successesSinceRaise = 0;
    }
  }

  noteRateLimit(): void {
    this.successesSinceRaise = 0;
    this.current = Math.max(1, Math.floor(this.current / 2));
  }
}

function parseEnvConcurrency(raw: string | undefined): number {
  if (raw === undefined || raw.trim().length === 0) return 0;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(MAX_PARALLEL_BLOCK_CONCURRENCY, n);
}

function isRateLimitLikeError(error: unknown): boolean {
  if (error instanceof APIStatusError && error.statusCode === 429) return true;
  if (error instanceof Error && /rate.?limit|too many requests|429/i.test(error.message)) {
    return true;
  }
  return false;
}

function isCompactionSummarizerError(error: unknown): boolean {
  return (
    error instanceof APIEmptyResponseError ||
    error instanceof CompactionTruncatedError ||
    error instanceof APIContextOverflowError ||
    error instanceof CompactionQualityError
  );
}
