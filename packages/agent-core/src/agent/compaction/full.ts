import {
  ErrorCodes,
  KimiError,
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
} from '@moonshot-ai/kosong';

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
  CompactionResult,
  CompactionResultAction,
  CompactionResultRawRef,
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

export const MAX_COMPACTION_RETRY_ATTEMPTS = 5;
const DEFAULT_COMPACTION_MAX_COMPLETION_TOKENS = 128 * 1024;
const DEFAULT_PARALLEL_BLOCK_THRESHOLD = 30_000;
const DEFAULT_PARALLEL_BLOCK_TARGET = 15_000;
const OVERFLOW_CONTEXT_SAFETY_RATIO = 0.85;
const OVERFLOW_STATUS_RECOVERY_RATIO = 0.5;

class CompactionTruncatedError extends Error {
  constructor() {
    super('Compaction response was truncated before producing a complete summary.');
    this.name = 'CompactionTruncatedError';
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
    this.strategy =
      strategy ??
      new DefaultCompactionStrategy(
        () => this.getEffectiveMaxContextTokens(),
        {
          ...DEFAULT_COMPACTION_CONFIG,
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
        systemPrompt.slice(0, 500).replace(/\s+/g, ' ').trim()
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
      throw new KimiError(
        ErrorCodes.COMPACTION_UNABLE,
        'Cannot compact while a turn is active. Wait for it to finish, then retry.',
      );
    }
    const compactedCount = this.strategy.computeCompactCount(this.agent.context.history, data.source);
    if (compactedCount === 0) {
      throw new KimiError(ErrorCodes.COMPACTION_UNABLE, 'No prefix that can be compacted in current history.');
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
      throw new KimiError(
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
        throw new KimiError(ErrorCodes.CONTEXT_OVERFLOW, `Compaction limit exceeded (${String(maxCompactions)})`, {
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
      const messagesToCompact = originalHistory.slice(0, compactedCount);
      let plan = this.planner.plan(originalHistory, compactedCount);
      const compactedTokens = estimateTokensForMessages(messagesToCompact);

      const parallelThreshold = this.strategy.parallelBlockThreshold ?? DEFAULT_PARALLEL_BLOCK_THRESHOLD;
      if (compactedTokens > parallelThreshold && messagesToCompact.length > 4) {
        const blocks = this.splitIntoBlocks(messagesToCompact);
        if (blocks.length > 1) {
          const blockPrompt = renderPrompt(compactionInstructionTemplate, {
            customInstruction: this.compactionInstruction(
              data.instruction,
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
              if (response.usage !== null) {
                usage = mergeTokenUsage(usage, response.usage);
              }
              return extractCompactionSummary(response);
            })
          );
          summary = `## Summary of Compacted History\n\n${blockResults.map((s, i) => `## Block ${i + 1}\n${s.trim()}`).join('\n\n')}`;
        } else {
          const seqResult = await this.sequentialSummarize(
            signal, provider, messagesToCompact, this.compactionInstruction(data.instruction, plan), retryCount
          );
          summary = seqResult.summary;
          usage = seqResult.usage;
          compactedCount = seqResult.finalCompactedCount;
        }
      } else {
        const seqResult = await this.sequentialSummarize(
          signal, provider, messagesToCompact, this.compactionInstruction(data.instruction, plan), retryCount
        );
        summary = seqResult.summary;
        usage = seqResult.usage;
        compactedCount = seqResult.finalCompactedCount;
      }

      plan = this.planner.plan(originalHistory, compactedCount);

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

      const summaryTokens = estimateTokensForMessages([compactionSummaryMessage(summary)]);
      const retained = this.agent.context.history.slice(compactedCount);
      const retainedTokens = estimateTokensForMessages(retained);
      const tokensAfter = summaryTokens + retainedTokens;

      const result: CompactionResult = {
        summary,
        compactedCount,
        tokensBefore,
        tokensAfter,
      };
      result.algorithmVersion = plan.algorithmVersion;
      result.actions = plan.actions;
      result.rawRefs = plan.rawRefs;
      result.summaryTokens = summaryTokens;
      result.retainedTokens = retainedTokens;
      result.compactedTokens = plan.compactedTokens;
      result.qualityWarnings = plan.qualityWarnings;

      const durationMs = Date.now() - startedAt;
      this.agent.telemetry.track('compaction_finished', {
        source: data.source,
        tokens_before: result.tokensBefore,
        tokens_after: result.tokensAfter,
        duration_ms: durationMs,
        compacted_count: result.compactedCount,
        retry_count: retryCount.value,
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
        round,
        thinking_level: this.agent.config.thinkingLevel,
        action_types: result.actions?.map((action) => action.type).join(',') ?? '',
        quality_warnings: result.qualityWarnings?.join(',') ?? '',
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
      throw new KimiError(ErrorCodes.COMPACTION_FAILED, String(error), { cause: error });
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
      '# Super Kimi Context Compaction v2 Memory',
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

function formatRawRef(ref: CompactionPlan['rawRefs'][number]): string {
  const tools =
    ref.toolNames !== undefined && ref.toolNames.length > 0
      ? ` tools=${ref.toolNames.join(',')}`
      : '';
  return `${ref.kind}[${String(ref.messageStart)}-${String(ref.messageEnd)}] tokens=${String(ref.tokens)}${tools}`;
}
