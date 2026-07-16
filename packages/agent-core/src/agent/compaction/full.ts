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
  APIContextOverflowError,
  APIStatusError,
  createUserMessage,
} from '@superliora/kosong';

import type { Agent } from '..';
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
  DefaultCompactionStrategy,
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
import { buildEmergencyBackstopSummary } from './backstop';
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
const DEFAULT_PARALLEL_BLOCK_THRESHOLD = 8_000;
const DEFAULT_PARALLEL_BLOCK_TARGET = 4_000;
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
    const compactionTriggerRatio =
      loopControl?.compactionTriggerRatio ??
      DEFAULT_COMPACTION_CONFIG.triggerRatio;
    const compactionBlockRatio = resolveCompactionBlockRatio(
      compactionTriggerRatio,
      loopControl?.compactionBlockRatio,
    );
    const defaultTrigger = new DefaultCompactionStrategy(
      () => this.getEffectiveMaxContextTokens(),
      {
        ...DEFAULT_COMPACTION_CONFIG,
        triggerRatio: compactionTriggerRatio,
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
    this.agent.emitEvent({
      type: 'compaction.started',
      trigger: data.source,
      instruction: data.instruction,
      mode: this.agent.turn.hasActiveTurn ? 'background' : 'blocking',
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
    const minGrowthRatio =
      this.strategyWithQualityControls()?.minRecompactGrowthRatio ??
      DEFAULT_COMPACTION_CONFIG.minRecompactGrowthRatio;
    return shouldSkipRecompactUntilGrowthPolicy({
      lastCompactedTokenCount: this.lastCompactedTokenCount,
      tokenCountWithPending: this.tokenCountWithPending,
      minGrowthRatio,
      maxContextTokens: this.getEffectiveMaxContextTokens(),
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
          throw new CompactionQualityError(repairedQuality.critical);
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
      if (quality.critical.length > 0 && !usedEmergencyBackstop) {
        throw new CompactionQualityError(quality.critical);
      }

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

  private createCompactionProvider(usedContextTokens: number): ChatProvider {
    // When a dedicated compaction model is configured, summarize with it
    // instead of the (usually more expensive) main model. The alias is
    // resolved through the same ModelProvider so auth/routing stays consistent.
    const compactionModelAlias = this.agent.kimiConfig?.loopControl?.compactionModel;
    const resolvedCompaction =
      compactionModelAlias !== undefined
        ? this.agent.modelProvider?.resolveProviderConfig(compactionModelAlias)
        : undefined;
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
        if (!isCompactionSummarizerError(error)) throw error;
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
          [...this.agent.tools.loopTools],
          messages,
          undefined,
          { signal },
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
          throw error;
        }
        if (retryCountRef.value + 1 >= MAX_COMPACTION_RETRY_ATTEMPTS) {
          if (isCompactionSummarizerError(error)) {
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
    const blockResults = await Promise.all(
      orderedBlocks.map(async (block) => {
        const messages = [
          ...this.agent.context.projectForCompaction(block),
          createUserMessage(blockPrompt),
        ];
        const response = await this.agent.generate(
          provider,
          this.agent.config.systemPrompt,
          [...this.agent.tools.loopTools],
          messages,
          undefined,
          { signal },
        );
        if (response.finishReason === 'truncated') {
          throw new CompactionTruncatedError();
        }
        return {
          summary: extractCompactionSummary(response),
          usage: response.usage,
        };
      })
    );
    const usage = blockResults.reduce<TokenUsage | null>(
      (current, result) =>
        result.usage === null ? current : mergeTokenUsage(current, result.usage),
      null,
    );
    const mergeResult = await this.mergeBlockSummaries(
      signal,
      provider,
      blockResults.map((result) => result.summary),
      plan,
      instruction,
      retryCountRef,
    );
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
          [...this.agent.tools.loopTools],
          messages,
          undefined,
          { signal },
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
      [...this.agent.tools.loopTools],
      messages,
      undefined,
      { signal },
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

    const lines = [
      instruction?.trim(),
      blockNote,
      'CONTEXT COMPACTION V2 OUTPUT CONTRACT:',
      'Preserve task continuity over compression ratio. Use the exact sections: current_goal, last_known_state, decisions, files_touched, failed_attempts, open_questions, next_actions, raw_refs.',
      'Mention uncertain facts as uncertain. Do not invent file paths, test results, or decisions.',
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

function isCompactionSummarizerError(error: unknown): boolean {
  return (
    error instanceof APIEmptyResponseError ||
    error instanceof CompactionTruncatedError ||
    error instanceof APIContextOverflowError ||
    error instanceof CompactionQualityError
  );
}
