import {
  ErrorCodes,
  LioraError,
  isKimiError,
  toKimiErrorPayload,
} from '#/errors';
import {
  APIEmptyResponseError,
  inputTotal,
  isRetryableGenerateError,
  type ChatProvider,
  type GenerateResult,
  type Message,
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
  resolveCompletionBudget,
} from '../../utils/completion-budget';
import compactionInstructionTemplate from './compaction-instruction.md?raw';
import { renderTodoList, type TodoItem } from '../../tools/builtin/state/todo-list';
import type {
  CompactionBeginData,
  CompactionContextMemoryTier,
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
  type CompactionStrategy,
} from './strategy';
import {
  CompactionPlanner,
  splitMessagesIntoTokenBlocks,
  type CompactionPlan,
} from './planner';
import {
  mergeCompactionQualityResults,
  validateInitialCompactionSummary,
  validateRenderedCompactionSummary,
  type CompactionQualityResult,
} from './quality';
import {
  extractFactsFromSummary,
  formatFactsAsMemoryBlock,
  isPromptControlCompactionMemoryItem,
  isUsefulCompactionMemoryItem,
  mergeFactSets,
  parseStructuredCompactionMemory,
  type ExtractedFact,
} from './memory';
import type { MemoryCreateInput, MemoryKind, MemoryScope } from '../../memory';
import {
  type AnchorDocument,
  createAnchorDocument,
  extractAnchorDiff,
  mergeIntoAnchor,
  renderAnchor,
} from './anchor';
import { buildCompactionSummaryText } from './handoff';

export const MAX_COMPACTION_RETRY_ATTEMPTS = 5;
const DEFAULT_COMPACTION_MAX_COMPLETION_TOKENS = 128 * 1024;
const DEFAULT_PARALLEL_BLOCK_THRESHOLD = 30_000;
const DEFAULT_PARALLEL_BLOCK_TARGET = 15_000;
const OVERFLOW_CONTEXT_SAFETY_RATIO = 0.85;
const OVERFLOW_STATUS_RECOVERY_RATIO = 0.5;
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

  constructor(
    protected readonly agent: Agent,
    strategy?: CompactionStrategy,
  ) {
    const loopControl = agent.kimiConfig?.loopControl;
    const compactionTriggerRatio =
      loopControl?.compactionTriggerRatio ??
      DEFAULT_COMPACTION_CONFIG.triggerRatio;
    this.strategy =
      strategy ??
      new DefaultCompactionStrategy(
        () => this.getEffectiveMaxContextTokens(),
        {
          ...DEFAULT_COMPACTION_CONFIG,
          triggerRatio: compactionTriggerRatio,
          blockRatio: compactionTriggerRatio,
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
        }
      );

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
    const compactedCount = this.strategy.computeCompactCount(this.agent.context.history, data.source);
    if (compactedCount === 0) {
      throw new LioraError(ErrorCodes.COMPACTION_UNABLE, 'No prefix that can be compacted in current history.');
    }
    this.agent.records.logRecord({
      type: 'full_compaction.begin',
      ...data,
    });
    this.agent.emitEvent({
      type: 'compaction.started',
      trigger: data.source,
      instruction: data.instruction,
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
    if (observed === undefined) return configured;
    if (configured <= 0) return observed;
    return Math.min(configured, observed);
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

  shouldRecoverFromContextOverflow(
    error: unknown,
    estimatedRequestTokens = this.estimateCurrentRequestTokens(),
  ): boolean {
    if (error instanceof APIContextOverflowError) return true;
    if (!(error instanceof APIStatusError) || error.statusCode !== 413) return false;
    const maxContextTokens = this.getEffectiveMaxContextTokens();
    return (
      maxContextTokens > 0 &&
      estimatedRequestTokens >= maxContextTokens * OVERFLOW_STATUS_RECOVERY_RATIO
    );
  }

  resetForTurn(): void {
    this.compactionCountInTurn = 0;
    this.consecutiveOverflowCompactions = 0;
    this.lastCompactedTokenCount = null;
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
    if (this.strategy.shouldBlock(this.tokenCountWithPending)) {
      await this.block(signal);
    }
  }

  async afterStep(): Promise<void> {
    this.consecutiveOverflowCompactions = 0;
    if (this.strategy.checkAfterStep) {
      this.checkAutoCompaction(false);
    }
    // Do not block after the step
  }

  private checkAutoCompaction(throwOnLimit: boolean = true): boolean {
    if (this.compacting) return true;
    if (
      this.lastCompactedTokenCount !== null &&
      this.tokenCountWithPending <= this.lastCompactedTokenCount
    ) {
      return false;
    }
    if (!this.strategy.shouldCompact(this.tokenCountWithPending)) return false;
    return this.beginAutoCompaction(throwOnLimit);
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
    this.begin({ source: 'auto', instruction: undefined });
    return this.compacting !== null;
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
      const capability = this.agent.config.modelCapabilities;
      const maxContextTokens = capability.max_context_tokens;
      const defaultCompactionCap =
        maxContextTokens > 0
          ? Math.min(maxContextTokens, DEFAULT_COMPACTION_MAX_COMPLETION_TOKENS)
          : undefined;
      const provider = applyCompletionBudget({
        provider: this.agent.config.provider,
        budget: resolveCompletionBudget({
          maxOutputSize: this.agent.config.maxOutputSize ?? defaultCompactionCap,
          reservedContextSize: this.agent.kimiConfig?.loopControl?.reservedContextSize,
        }),
        capability,
      });

      let summary: string;
      let usage: TokenUsage | null = null;
      let parallelBlockCount = 0;
      let mergeInputTokens: number | undefined;
      let repairAttempted = false;
      let messagesToCompact = originalHistory.slice(0, compactedCount);
      let plan = this.planner.plan(originalHistory, compactedCount);
      const compactedTokens = estimateTokensForMessages(messagesToCompact);

      const parallelThreshold = this.strategy.parallelBlockThreshold ?? DEFAULT_PARALLEL_BLOCK_THRESHOLD;
      if (compactedTokens > parallelThreshold && messagesToCompact.length > 4) {
        const blocks = this.splitIntoBlocks(messagesToCompact);
        if (blocks.length > 1) {
          const parallelResult = await this.parallelSummarize(
            signal,
            provider,
            blocks,
            plan,
            data.instruction,
            retryCount,
          );
          summary = parallelResult.summary;
          usage = parallelResult.usage;
          parallelBlockCount = parallelResult.parallelBlockCount;
          mergeInputTokens = parallelResult.mergeInputTokens;
        } else {
          const seqResult = await this.sequentialSummarize(
            signal, provider, messagesToCompact, this.compactionInstruction(data.instruction, plan), retryCount
          );
          summary = seqResult.summary;
          usage = seqResult.usage;
          compactedCount = seqResult.finalCompactedCount;
          messagesToCompact = originalHistory.slice(0, compactedCount);
        }
      } else {
        const seqResult = await this.sequentialSummarize(
          signal, provider, messagesToCompact, this.compactionInstruction(data.instruction, plan), retryCount
        );
        summary = seqResult.summary;
        usage = seqResult.usage;
        compactedCount = seqResult.finalCompactedCount;
        messagesToCompact = originalHistory.slice(0, compactedCount);
      }

      plan = this.planner.plan(originalHistory, compactedCount);

      const initialQuality = validateInitialCompactionSummary(summary, plan, messagesToCompact);
      let quality: CompactionQualityResult = initialQuality;
      if (initialQuality.critical.length > 0) {
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
        quality = mergeCompactionQualityResults(initialQuality, repairedQuality);
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

      summary = this.postProcessSummary(summary);

      const newFacts = extractFactsFromSummary(summary);
      this.extractedFacts = Array.from(mergeFactSets(this.extractedFacts, newFacts));
      const memoryBlock = formatFactsAsMemoryBlock(this.extractedFacts);
      if (memoryBlock.length > 0) {
        summary = `${summary.trim()}\n\n${memoryBlock}`;
      }

      if (this.anchor !== null) {
        const diff = extractAnchorDiff(summary);
        this.anchor = mergeIntoAnchor(this.anchor, diff);
        const anchorText = renderAnchor(this.anchor);
        if (anchorText.length > 0) {
          summary = `${anchorText}\n\n---\n\n${summary.trim()}`;
        }
      }

      summary = this.renderStructuredV2Summary(summary, plan);
      const contextSummary = buildCompactionSummaryText(summary);
      const summaryTokens = estimateTokens(contextSummary);
      const retained = this.agent.context.history.slice(compactedCount);
      const retainedTokens = estimateTokensForMessages(retained);
      const tokensAfter = summaryTokens + retainedTokens;
      const renderedQuality = validateRenderedCompactionSummary(
        summary,
        plan,
        messagesToCompact,
        tokensAfter,
      );
      quality = mergeCompactionQualityResults(quality, renderedQuality);
      if (renderedQuality.critical.length > 0) {
        throw new CompactionQualityError(renderedQuality.critical);
      }

      const resultWithoutContextPack: CompactionResultWithQualityWarnings = {
        summary,
        contextSummary,
        compactedCount,
        tokensBefore,
        tokensAfter,
        algorithmVersion: plan.algorithmVersion,
        actions: plan.actions,
        rawRefs: plan.rawRefs,
        summaryTokens,
        retainedTokens,
        compactedTokens: plan.compactedTokens,
        qualityWarnings: mergeStringLists(plan.qualityWarnings, quality.warnings),
        qualityWarningCategories:
          quality.warningCategories.length > 0 ? quality.warningCategories : undefined,
        parallelBlockCount: parallelBlockCount > 0 ? parallelBlockCount : undefined,
        mergeInputTokens,
        repairAttempted: repairAttempted ? true : undefined,
      };
      const shouldIncludeQualitySignals =
        quality.warningCategories.length > 0 || quality.signals?.failureSignature !== undefined;
      const result: CompletedCompactionResult = {
        ...resultWithoutContextPack,
        contextPack: this.buildContextPack(
          data.source,
          resultWithoutContextPack,
          retained.length,
          provider,
          shouldIncludeQualitySignals ? quality.signals : undefined,
        ),
      };
      const recallMemorySavedCount = await this.persistCompactionRecall(result);
      const qualitySignals = quality.signals;
      const qualityWarningCategories = result.qualityWarningCategories ?? [];

      const durationMs = Date.now() - startedAt;
      this.agent.telemetry.track('compaction_finished', {
        source: data.source,
        tokens_before: result.tokensBefore,
        tokens_after: result.tokensAfter,
        duration_ms: durationMs,
        compacted_count: result.compactedCount,
        retry_count: retryCount.value,
        parallel_block_count: parallelBlockCount,
        quality_warning_count: result.qualityWarnings.length,
        quality_warning_categories: qualityWarningCategories.join(','),
        repair_attempted: repairAttempted,
        merge_input_tokens: mergeInputTokens ?? 0,
        provider_context_management: formatContextManagementCapability(provider),
        context_pack_version: result.contextPack.version,
        context_pack_raw_ref_count: result.contextPack.evidence.rawRefCount,
        context_pack_action_count: result.contextPack.evidence.actionTypes.length,
        context_pack_retained_message_count: result.contextPack.messageCounts.retained,
        context_os_status: result.contextPack.contextOS.continuity.status,
        context_os_score: result.contextPack.contextOS.continuity.score,
        context_os_tier_count: result.contextPack.contextOS.memoryTiers.length,
        context_os_rehydration_kind_count:
          result.contextPack.contextOS.rehydrationRawRefKinds.length,
        recall_eval_score: qualitySignals?.recallEvalScore,
        critical_fact_count: qualitySignals?.criticalFactCount,
        placeholder_item_count: qualitySignals?.placeholderItemCount,
        tokens_saved_ratio: qualitySignals?.tokensSavedRatio,
        failure_signature: qualitySignals?.failureSignature,
        recall_memory_saved_count: recallMemorySavedCount,
        round,
        thinking_level: this.agent.config.thinkingLevel,
        ...usageTelemetryProperties(usage),
      });
      this.agent.telemetry.track('compaction_v2_finished', {
        source: data.source,
        tokens_before: result.tokensBefore,
        tokens_after: result.tokensAfter,
        summary_tokens: result.summaryTokens,
        retained_tokens: result.retainedTokens,
        compacted_tokens: result.compactedTokens,
        duration_ms: durationMs,
        compacted_count: result.compactedCount,
        retry_count: retryCount.value,
        parallel_block_count: parallelBlockCount,
        quality_warning_count: result.qualityWarnings.length,
        quality_warning_category_count: qualityWarningCategories.length,
        repair_attempted: repairAttempted,
        merge_input_tokens: mergeInputTokens ?? 0,
        provider_context_management: formatContextManagementCapability(provider),
        context_pack_version: result.contextPack.version,
        context_pack_raw_ref_count: result.contextPack.evidence.rawRefCount,
        context_pack_action_count: result.contextPack.evidence.actionTypes.length,
        context_pack_retained_message_count: result.contextPack.messageCounts.retained,
        context_os_status: result.contextPack.contextOS.continuity.status,
        context_os_score: result.contextPack.contextOS.continuity.score,
        context_os_tier_count: result.contextPack.contextOS.memoryTiers.length,
        context_os_rehydration_kind_count:
          result.contextPack.contextOS.rehydrationRawRefKinds.length,
        recall_eval_score: qualitySignals?.recallEvalScore,
        critical_fact_count: qualitySignals?.criticalFactCount,
        placeholder_item_count: qualitySignals?.placeholderItemCount,
        tokens_saved_ratio: qualitySignals?.tokensSavedRatio,
        failure_signature: qualitySignals?.failureSignature,
        recall_memory_saved_count: recallMemorySavedCount,
        round,
        thinking_level: this.agent.config.thinkingLevel,
        action_types: result.actions?.map((action) => action.type).join(',') ?? '',
        quality_warnings: result.qualityWarnings?.join(',') ?? '',
        quality_warning_categories: qualityWarningCategories.join(','),
        ...usageTelemetryProperties(usage),
      });
      this.agent.context.applyCompaction(result);
      this.lastCompactedTokenCount = result.tokensAfter;
      return result;
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

  private async sequentialSummarize(
    signal: AbortSignal,
    provider: ChatProvider,
    messagesToCompact: readonly Message[],
    instruction: string,
    retryCountRef: { value: number },
  ): Promise<{ summary: string; usage: TokenUsage | null; finalCompactedCount: number }> {
    const delays = retryBackoffDelays(MAX_COMPACTION_RETRY_ATTEMPTS);
    let compactedCount = messagesToCompact.length;
    let usage: TokenUsage | null = null;

    while (true) {
      const currentPrefix = messagesToCompact.slice(0, compactedCount);
      const messages = [
        ...this.agent.context.project(currentPrefix),
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
        return { summary: extractCompactionSummary(response), usage, finalCompactedCount: compactedCount };
      } catch (error) {
        if (
          error instanceof APIContextOverflowError ||
          error instanceof CompactionTruncatedError ||
          error instanceof APIEmptyResponseError
        ) {
          compactedCount = this.strategy.reduceCompactOnOverflow(currentPrefix);
        }
        else if (!isRetryableGenerateError(error)) {
          throw error;
        }
        if (retryCountRef.value + 1 >= MAX_COMPACTION_RETRY_ATTEMPTS) {
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
    const blockPrompt = renderPrompt(compactionInstructionTemplate, {
      customInstruction: this.compactionInstruction(
        instruction,
        plan,
        'This is one block of a larger conversation. Summarize only the events in this block.',
      ),
    });
    const blockResults = await Promise.all(
      blocks.map(async (block) => {
        const messages = [
          ...this.agent.context.project(block),
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
          `Failed checks: ${quality.critical.join('; ')}`,
          'Produce a complete replacement summary. Keep the exact v2 section labels when you use structured memory.',
        ].join('\n\n'),
      ),
    });
    const messages = [
      ...this.agent.context.project(messagesToCompact),
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
    const continuity = evaluateContinuity(result, memory, retrievalQueries);

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
        critical_fact_count: result.contextPack.contextOS.qualitySignals?.criticalFactCount,
      });
    }
    return saved;
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
      '',
      '## Compacted Narrative',
      summary.trim(),
    ].join('\n');
  }
}

function extractCompactionSummary(response: GenerateResult): string {
  const summary =
    typeof response.message.content === 'string'
      ? response.message.content
      : response.message.content.map((part) => (part.type === 'text' ? part.text : '')).join('');

  if (summary.trim().length === 0) {
    throw new APIEmptyResponseError(
      'The compaction response did not contain a non-empty summary.',
    );
  }
  return summary;
}

function mergeTokenUsage(current: TokenUsage | null, next: TokenUsage): TokenUsage {
  if (current === null) return next;
  return {
    inputOther: current.inputOther + next.inputOther,
    output: current.output + next.output,
    inputCacheRead: current.inputCacheRead + next.inputCacheRead,
    inputCacheCreation: current.inputCacheCreation + next.inputCacheCreation,
  };
}

function mergeTokenUsageOrNull(
  current: TokenUsage | null,
  next: TokenUsage | null,
): TokenUsage | null {
  if (next === null) return current;
  return mergeTokenUsage(current, next);
}

function compactionSummaryMessage(summary: string): Message {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: summary }],
    toolCalls: [],
  };
}

function usageTelemetryProperties(
  usage: TokenUsage | null,
): { input_tokens?: number; output_tokens?: number } {
  if (usage === null) return {};
  return {
    input_tokens: inputTotal(usage),
    output_tokens: usage.output,
  };
}

function formatContextManagementCapability(provider: ChatProvider): string {
  const capability = provider.contextManagementCapability;
  if (capability === undefined) return 'none';
  const names = [
    capability.serverSideCompaction === true ? 'server_side_compaction' : undefined,
    capability.toolResultClearing === true ? 'tool_result_clearing' : undefined,
    capability.thinkingBlockClearing === true ? 'thinking_block_clearing' : undefined,
  ].filter((name): name is string => name !== undefined);
  return names.length === 0 ? 'none' : names.join(',');
}

function createCompactionRecallMemories(result: CompletedCompactionResult): readonly MemoryCreateInput[] {
  const memory = parseStructuredCompactionMemory(result.summary);
  const currentGoal = usefulRecallItems([memory.currentGoal]).at(0);
  const decisions = usefulRecallItems(memory.decisions);
  const filesTouched = usefulRecallItems(memory.filesTouched);
  const failedAttempts = usefulRecallItems(memory.failedAttempts);
  const nextActions = usefulRecallItems(memory.nextActions);
  const records: MemoryCreateInput[] = [];

  const workspaceSections = formatRecallSections([
    ['Current goal', currentGoal === undefined ? [] : [currentGoal]],
    ['Decisions', decisions],
    ['Files touched', filesTouched],
    ['Failed attempts', failedAttempts],
  ]);
  if (workspaceSections.length > 0) {
    records.push({
      kind: 'semantic' satisfies MemoryKind,
      scope: 'workspace' satisfies MemoryScope,
      subject: recallSubject('Compaction working memory', currentGoal ?? decisions[0] ?? filesTouched[0]),
      content: workspaceSections,
      tags: recallTags(['compaction', 'context-os', 'workspace'], [
        decisions.length > 0 ? 'decision' : undefined,
        filesTouched.length > 0 ? 'file' : undefined,
        failedAttempts.length > 0 ? 'failure' : undefined,
      ]),
      confidence: 0.82,
      importance: result.contextPack.contextOS.qualitySignals?.criticalFactCount
        ? 0.82
        : 0.68,
      source: { kind: 'auto', excerpt: 'compaction structured working memory' },
      metadata: {
        source: 'compaction',
        algorithmVersion: result.algorithmVersion,
        recallEvalScore: result.contextPack.contextOS.qualitySignals?.recallEvalScore,
        contextOSStatus: result.contextPack.contextOS.continuity.status,
      },
    });
  }

  const prospectiveSections = formatRecallSections([
    ['Current goal', currentGoal === undefined ? [] : [currentGoal]],
    ['Next actions', nextActions],
  ]);
  if (nextActions.length > 0 && prospectiveSections.length > 0) {
    records.push({
      kind: 'prospective' satisfies MemoryKind,
      scope: 'session' satisfies MemoryScope,
      subject: recallSubject('Compaction next actions', currentGoal ?? nextActions[0]),
      content: prospectiveSections,
      tags: recallTags(['compaction', 'next-actions', 'session'], []),
      confidence: 0.86,
      importance: 0.84,
      source: { kind: 'auto', excerpt: 'compaction next actions' },
      metadata: {
        source: 'compaction',
        algorithmVersion: result.algorithmVersion,
        recallEvalScore: result.contextPack.contextOS.qualitySignals?.recallEvalScore,
        contextOSStatus: result.contextPack.contextOS.continuity.status,
      },
    });
  }

  return records;
}

function usefulRecallItems(items: readonly (string | undefined)[]): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    if (item === undefined) continue;
    const normalized = item.replaceAll(/\s+/g, ' ').trim();
    if (!isUsefulCompactionMemoryItem(normalized)) continue;
    if (isPromptControlCompactionMemoryItem(normalized)) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result.slice(0, 8);
}

function formatRecallSections(
  sections: readonly [title: string, items: readonly string[]][],
): string {
  const lines: string[] = [];
  for (const [title, items] of sections) {
    if (items.length === 0) continue;
    lines.push(`## ${title}`);
    for (const item of items.slice(0, 8)) {
      lines.push(`- ${item}`);
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}

function recallSubject(prefix: string, detail: string | undefined): string {
  if (detail === undefined) return prefix;
  const compact = detail.replaceAll(/[`*_#]/g, '').replaceAll(/\s+/g, ' ').trim();
  if (compact.length === 0) return prefix;
  return `${prefix}: ${compact.slice(0, 80)}`;
}

function recallTags(
  base: readonly string[],
  optional: readonly (string | undefined)[],
): readonly string[] {
  return [...new Set([...base, ...optional.filter((tag): tag is string => tag !== undefined)])];
}

function formatStringList(items: readonly string[]): string {
  if (items.length === 0) return '- None captured during compaction.';
  return items.slice(0, 12).map((item) => `- ${item}`).join('\n');
}

function factsToDetails(facts: readonly ExtractedFact[]): readonly string[] {
  return facts.map((fact) => fact.detail);
}

function mergeStringLists(
  primary: readonly string[],
  fallback: readonly string[],
): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of [...primary, ...fallback]) {
    const normalized = item.trim();
    if (normalized.length === 0) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function extractNextActions(summary: string): readonly string[] {
  const lines = summary.split('\n');
  const result: string[] = [];
  let inNextSection = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^#{1,4}\s*(next steps?|todo|pending|active issues)/i.test(trimmed)) {
      inNextSection = true;
      continue;
    }
    if (inNextSection && /^#{1,4}\s+/.test(trimmed)) break;
    if (!inNextSection) continue;
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      result.push(trimmed.slice(2));
    }
  }
  return result;
}

function uniqueSorted(items: readonly string[]): readonly string[] {
  return [...new Set(items.filter((item) => item.length > 0))].toSorted();
}

function uniqueHints(items: readonly (string | undefined)[]): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    if (item === undefined) continue;
    const normalized = normalizeHint(item);
    if (normalized.length === 0) continue;
    if (!isUsefulHint(normalized)) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function normalizeHint(item: string): string {
  return item
    .replaceAll(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

function isUsefulHint(item: string): boolean {
  const lower = item.toLowerCase();
  if (lower === 'none captured during compaction.') return false;
  if (/^#{1,6}\s+/.test(item)) return false;
  if (/^\*\*(?:file|decision|error|state|config|dependency|api)\*\*:\s*$/i.test(item)) {
    return false;
  }
  return true;
}

function extractFileHints(item: string): readonly string[] {
  const matches = item.matchAll(
    /`([^`]+\.(?:ts|js|tsx|jsx|py|rs|go|java|kt|swift|md|json|yaml|yml|toml|html|css|scss|sql))`|([A-Za-z0-9_./-]+\.(?:ts|js|tsx|jsx|py|rs|go|java|kt|swift|md|json|yaml|yml|toml|html|css|scss|sql))/gi,
  );
  const files: string[] = [];
  for (const match of matches) {
    files.push((match[1] ?? match[2] ?? '').trim());
  }
  return uniqueSorted(files);
}

function inferMemoryTiers(
  memory: ReturnType<typeof parseStructuredCompactionMemory>,
  rawRefKinds: readonly string[],
  actionTypes: readonly string[],
  fileHints: readonly string[],
): readonly CompactionContextMemoryTier[] {
  const tiers = new Set<CompactionContextMemoryTier>(['working']);
  if (rawRefKinds.length > 0) tiers.add('episodic');
  if (
    memory.currentGoal !== undefined ||
    memory.decisions.length > 0 ||
    memory.openQuestions.length > 0 ||
    fileHints.length > 0
  ) {
    tiers.add('semantic');
  }
  if (
    memory.nextActions.length > 0 ||
    memory.failedAttempts.length > 0 ||
    actionTypes.length > 0
  ) {
    tiers.add('procedural');
  }
  return Array.from(tiers);
}

function countStructuredMemoryItems(
  memory: ReturnType<typeof parseStructuredCompactionMemory>,
): number {
  return [
    memory.currentGoal,
    ...memory.lastKnownState,
    ...memory.decisions,
    ...memory.filesTouched,
    ...memory.failedAttempts,
    ...memory.openQuestions,
    ...memory.nextActions,
    ...memory.rawRefs,
  ]
    .filter((item): item is string => item !== undefined)
    .filter(isUsefulCompactionMemoryItem).length;
}

function evaluateContinuity(
  result: CompactionResult,
  memory: ReturnType<typeof parseStructuredCompactionMemory>,
  retrievalQueries: readonly string[],
): CompactionContextOS['continuity'] {
  let score = 1;
  const reasons: string[] = [];

  if (memory.currentGoal === undefined) {
    score -= 0.2;
    reasons.push('missing_current_goal');
  }
  if (uniqueHints(memory.nextActions).length === 0) {
    score -= 0.2;
    reasons.push('missing_next_actions');
  }
  if ((result.rawRefs?.length ?? 0) === 0 || memory.rawRefs.length === 0) {
    score -= 0.15;
    reasons.push('missing_raw_refs');
  }
  if ((result.qualityWarnings?.length ?? 0) > 0) {
    score -= 0.15;
    reasons.push('quality_warnings_present');
  }
  if (result.repairAttempted === true) {
    score -= 0.1;
    reasons.push('summary_repaired');
  }
  if (retrievalQueries.length === 0) {
    score -= 0.1;
    reasons.push('empty_retrieval_queries');
  }

  const boundedScore = Math.max(0, Math.min(1, Number(score.toFixed(2))));
  return {
    status: boundedScore >= 0.85 ? 'ready' : boundedScore >= 0.55 ? 'needs_rehydration' : 'at_risk',
    score: boundedScore,
    reasons: reasons.length > 0 ? reasons : ['core_continuity_signals_present'],
  };
}

function selectRehydrationRawRefKinds(
  rawRefKinds: readonly string[],
  status: CompactionContextOS['continuity']['status'],
): readonly string[] {
  if (status !== 'ready') return rawRefKinds;
  return rawRefKinds.filter((kind) => kind.includes('tool'));
}

function formatRawRef(ref: CompactionPlan['rawRefs'][number]): string {
  const tools =
    ref.toolNames !== undefined && ref.toolNames.length > 0
      ? ` tools=${ref.toolNames.join(',')}`
      : '';
  return `${ref.kind}[${String(ref.messageStart)}-${String(ref.messageEnd)}] tokens=${String(ref.tokens)}${tools}`;
}
