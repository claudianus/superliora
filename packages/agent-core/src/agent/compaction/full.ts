import {
  ErrorCodes,
  LioraError,
} from '#/errors';
import {
  type Message,
  APIContextOverflowError,
  APIStatusError,
} from '@superliora/kosong';

import type { Agent } from '..';
import {
  estimateTokens,
  estimateTokensForMessages,
  estimateTokensForTools,
} from '../../utils/tokens';
import { resolveCompactionModelAlias } from '../../utils/cheap-model';
import type {
  CompactionBeginData,
  CompactionResult,
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
} from './planner';
import {
  CompactionQualityTracker,
} from './quality';
import {
  type ExtractedFact,
} from './memory';
import {
  type AnchorDocument,
  createAnchorDocument,
} from './anchor';
import { createCompactionProvider as buildCompactionProvider } from './full-provider';
import { runCompactionWorker } from './full-worker';
import {
  handoffThresholdTokens,
  relaxObservedMaxContextTokens,
  resolveEffectiveMaxContextTokens,
  shouldDeferAutoCompaction as shouldDeferAutoCompactionPolicy,
  shouldRecoverFromOverflowStatus,
  shouldSkipRecompactUntilGrowth as shouldSkipRecompactUntilGrowthPolicy,
} from './full-policy';
import type { CompactionPipelineContext } from './pipeline/types';

export const MAX_COMPACTION_RETRY_ATTEMPTS = 5;
const OVERFLOW_CONTEXT_SAFETY_RATIO = 0.85;
const OVERFLOW_STATUS_RECOVERY_RATIO = 0.5;
/**
 * Each successful turn (no overflow) relaxes the observed max context by
 * this fraction of the gap toward the configured maximum, so a transient
 * false-positive overflow (e.g. one huge tool result) does not bias the
 * whole session toward premature compaction forever.
 */
const OBSERVED_MAX_DECAY_PER_TURN = 0.1;

export class FullCompaction implements CompactionPipelineContext {
  protected compactionCountInTurn = 0;
  compacting: {
    abortController: AbortController;
    promise: Promise<void>;
    blockedByTurn: boolean;
  } | null = null;
  readonly strategy: CompactionStrategy;
  private readonly observedMaxContextTokensByModel = new Map<string, number>();
  lastCompactedTokenCount: number | null = null;
  private consecutiveOverflowCompactions = 0;
  extractedFacts: ExtractedFact[] = [];
  anchor: AnchorDocument | null = null;
  readonly planner = new CompactionPlanner();
  private readonly qualityTracker = new CompactionQualityTracker();

  constructor(
    readonly agent: Agent,
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
      promise: runCompactionWorker(this, abortController.signal, data, compactedCount),
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
  releaseLockIfOwned(): void {
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

  syncCompactionBaseline(): void {
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

  recordCompactionQuality(input: {
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

  compactionModelAlias: string | undefined;

  createCompactionProvider(usedContextTokens: number) {
    return buildCompactionProvider(this, usedContextTokens);
  }

  async triggerPreCompactHook(
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

  triggerPostCompactHook(
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
}
