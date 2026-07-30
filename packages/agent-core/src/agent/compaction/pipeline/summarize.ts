/**
 * Summarize pipeline stage — extracted from FullCompaction.
 *
 * Contains the sequential/parallel summarize logic, block splitting,
 * merge, and the compaction instruction builder.
 */

import {
  APIContextOverflowError,
  APIEmptyResponseError,
  createUserMessage,
  isRetryableGenerateError,
  type ChatProvider,
  type Message,
  type TokenUsage,
  type Tool,
} from '@superliora/kosong';
import { ErrorCodes, isKimiError } from '#/errors/index';

import type { Agent } from '../..';
import { isAbortError } from '../../../loop/errors';
import { retryBackoffDelays, sleepForRetry } from '../../../loop/retry';
import { renderPrompt } from '../../../utils/render-prompt';
import { estimateTokensForMessages } from '../../../utils/tokens';
import { buildResponseLanguageDirective } from '../../injection/response-language';
import compactionInstructionTemplate from '../compaction-instruction.md?raw';
import {
  AdaptiveConcurrencyLimiter,
  CompactionTruncatedError,
  MAX_PARALLEL_BLOCK_CONCURRENCY,
  PARALLEL_CONCURRENCY_ENV,
  isCompactionSummarizerError,
  isRateLimitLikeError,
  mapWithConcurrency,
  parseEnvConcurrency,
} from '../adaptive-concurrency';
import {
  buildEmergencyBackstopSummary,
  shouldUseClassicalCompactionFallback,
} from '../backstop';
import { blockDensity, formatRawRef } from '../context-helpers';
import {
  extractCompactionSummary,
  mergeTokenUsage,
  mergeTokenUsageOrNull,
} from '../full-helpers';
import { shouldUseParallelSummarize } from '../full-policy';
import { splitMessagesIntoTokenBlocks, type CompactionPlan } from '../planner';
import {
  compactionStreamCallbacks,
  emitCompactionProgress,
  fractionForBlocksCompleted,
  fractionForMergeDone,
  fractionForMergeStart,
} from './progress';
import type {
  CompactionPipelineContext,
  CompactionStreamMeta,
  SummarizeInput,
  SummarizeOutput,
} from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_PARALLEL_BLOCK_THRESHOLD = 12_000;
const DEFAULT_PARALLEL_BLOCK_TARGET = 6_000;
/** Cap concurrent block LLM calls so parallel compaction cannot exhaust RPS (e.g. xAI 18/s). */
const DEFAULT_PARALLEL_BLOCK_CONCURRENCY = 2;
const PARALLEL_BLOCK_RATE_LIMIT_RETRIES = 4;
const MAX_COMPACTION_RETRY_ATTEMPTS = 5;
const MAX_COMPACTION_MERGE_RETRY_ATTEMPTS = 2;

/** Static empty tool list for compaction generate calls. */
const COMPACTION_GENERATE_TOOLS: Tool[] = [];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function compactionGenerateOptions(
  ctx: CompactionPipelineContext,
  signal: AbortSignal,
): { readonly signal: AbortSignal; readonly runtimeModelAlias?: string } {
  return {
    signal,
    runtimeModelAlias: ctx.compactionModelAlias,
  };
}

function resolveParallelBlockConcurrency(
  ctx: CompactionPipelineContext,
  blockCount: number,
): number {
  const fromConfig = ctx.strategy.parallelBlockConcurrency ?? 0;
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

function splitIntoBlocks(
  ctx: CompactionPipelineContext,
  messages: readonly Message[],
): readonly (readonly Message[])[] {
  const target = ctx.strategy.parallelBlockTarget ?? DEFAULT_PARALLEL_BLOCK_TARGET;
  return splitMessagesIntoTokenBlocks(messages, target);
}

// ---------------------------------------------------------------------------
// generateCompactionBlockWithRetry
// ---------------------------------------------------------------------------

/**
 * Single block generate with dedicated rate-limit / transient retries.
 * Parallel blocks share retryCountRef only for telemetry; each block has its own attempt budget.
 */
async function generateCompactionBlockWithRetry(
  ctx: CompactionPipelineContext,
  input: {
    readonly signal: AbortSignal;
    readonly provider: ChatProvider;
    readonly messages: Message[];
    readonly streamCallbacks: ReturnType<typeof compactionStreamCallbacks>;
    readonly retryCountRef: { value: number };
    readonly onRateLimit?: () => void;
  },
): Promise<Awaited<ReturnType<Agent['generate']>>> {
  const delays = retryBackoffDelays(PARALLEL_BLOCK_RATE_LIMIT_RETRIES);
  let attempt = 0;
  while (true) {
    try {
      return await ctx.agent.generate(
        input.provider,
        ctx.agent.config.systemPrompt,
        COMPACTION_GENERATE_TOOLS,
        input.messages,
        input.streamCallbacks,
        compactionGenerateOptions(ctx, input.signal),
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

// ---------------------------------------------------------------------------
// sequentialSummarize
// ---------------------------------------------------------------------------

async function sequentialSummarize(
  ctx: CompactionPipelineContext,
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
      ...ctx.agent.context.projectForCompaction(currentPrefix),
      createUserMessage(renderPrompt(compactionInstructionTemplate, { customInstruction: instruction })),
    ];
    try {
      const response = await ctx.agent.generate(
        provider,
        ctx.agent.config.systemPrompt,
        COMPACTION_GENERATE_TOOLS,
        messages,
        compactionStreamCallbacks(ctx.agent, {
          phase: 'summarizing',
          streamKind: 'summary',
        }),
        compactionGenerateOptions(ctx, signal),
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
        compactedCount = ctx.strategy.reduceCompactOnOverflow(currentPrefix);
      } else if (!isRetryableGenerateError(error)) {
        // Non-retryable provider/model failures (e.g. 400 unsupported params,
        // permanent auth) must not hard-stall the turn — fall back to the
        // deterministic extractive summary (OpenHands-style classical condenser
        // / Claude Code micro-compact philosophy: keep working set without LLM).
        if (shouldUseClassicalCompactionFallback(error)) {
          ctx.agent.telemetry.track('compaction_classical_fallback', {
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
          ctx.agent.telemetry.track('compaction_classical_fallback', {
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

// ---------------------------------------------------------------------------
// mergeBlockSummaries
// ---------------------------------------------------------------------------

async function mergeBlockSummaries(
  ctx: CompactionPipelineContext,
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
    customInstruction: compactionInstruction(
      ctx,
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
      const response = await ctx.agent.generate(
        provider,
        ctx.agent.config.systemPrompt,
        COMPACTION_GENERATE_TOOLS,
        messages,
        compactionStreamCallbacks(ctx.agent, {
          phase: 'summarizing',
          streamKind: 'merge',
        }),
        compactionGenerateOptions(ctx, signal),
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

// ---------------------------------------------------------------------------
// parallelSummarize
// ---------------------------------------------------------------------------

async function parallelSummarize(
  ctx: CompactionPipelineContext,
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
    customInstruction: compactionInstruction(
      ctx,
      instruction,
      plan,
      'This is one block of a larger conversation. Summarize only the events in this block.',
    ),
  });
  const blockCount = orderedBlocks.length;
  const initialConcurrency = resolveParallelBlockConcurrency(ctx, blockCount);
  const limiter = new AdaptiveConcurrencyLimiter(initialConcurrency);
  let blocksCompleted = 0;

  emitCompactionProgress(ctx.agent, {
    phase: 'summarizing',
    streamKind: 'block',
    blockIndex: 0,
    blockCount,
    blocksCompleted: 0,
    fraction: fractionForBlocksCompleted(0, blockCount),
  });

  const blockResults = await mapWithConcurrency(
    orderedBlocks,
    limiter,
    async (block, index) => {
      const startedAt = performance.now();
      const messages = [
        ...ctx.agent.context.projectForCompaction(block),
        createUserMessage(blockPrompt),
      ];
      try {
        const response = await generateCompactionBlockWithRetry(ctx, {
          signal,
          provider,
          messages,
          streamCallbacks: compactionStreamCallbacks(ctx.agent, {
            phase: 'summarizing',
            streamKind: 'block',
            blockIndex: index + 1,
            blockCount,
            // Live getters, not snapshots: under concurrency a captured
            // count goes stale the moment another block finishes, and this
            // block's next delta would rewind the TUI's "block n/N" counter.
            blocksCompleted: () => blocksCompleted,
            fraction: () => fractionForBlocksCompleted(blocksCompleted, blockCount),
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
        emitCompactionProgress(ctx.agent, {
          phase: 'summarizing',
          streamKind: 'block',
          blockIndex: index + 1,
          blockCount,
          blocksCompleted,
          fraction: fractionForBlocksCompleted(blocksCompleted, blockCount),
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
  emitCompactionProgress(ctx.agent, {
    phase: 'summarizing',
    streamKind: 'merge',
    blockCount,
    blocksCompleted: blockCount,
    fraction: fractionForMergeStart(blockCount),
  });
  const mergeResult = await mergeBlockSummaries(
    ctx,
    signal,
    provider,
    blockResults.map((result) => result.summary),
    plan,
    instruction,
    retryCountRef,
  );
  emitCompactionProgress(ctx.agent, {
    phase: 'summarizing',
    streamKind: 'merge',
    blockCount,
    blocksCompleted: blockCount,
    fraction: fractionForMergeDone(),
  });
  return {
    summary: mergeResult.summary,
    usage: mergeTokenUsageOrNull(usage, mergeResult.usage),
    parallelBlockCount: blocks.length,
    mergeInputTokens: mergeResult.mergeInputTokens,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function summarizeCompactedPrefix(
  ctx: CompactionPipelineContext,
  input: SummarizeInput,
): Promise<SummarizeOutput> {
  let summary: string;
  let usage: TokenUsage | null = null;
  let parallelBlockCount = 0;
  let compactedCount = input.compactedCount;
  let messagesToCompact = input.messagesToCompact;
  let usedEmergencyBackstop = false;

  const compactedTokens = estimateTokensForMessages(messagesToCompact);
  const parallelThreshold = ctx.strategy.parallelBlockThreshold ?? DEFAULT_PARALLEL_BLOCK_THRESHOLD;
  const shouldParallel = shouldUseParallelSummarize({
    compactedTokens,
    messageCount: messagesToCompact.length,
    parallelThreshold,
  });
  const blocks = shouldParallel ? splitIntoBlocks(ctx, messagesToCompact) : [];

  if (shouldParallel && blocks.length > 1) {
    try {
      const parallelResult = await parallelSummarize(
        ctx,
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
      ctx.agent.telemetry.track('compaction_parallel_fallback_sequential', {
        error_type: error instanceof Error ? error.name : 'Unknown',
      });
    }
  }

  const seqResult = await sequentialSummarize(
    ctx,
    input.signal,
    input.provider,
    messagesToCompact,
    input.plan,
    compactionInstruction(ctx, input.instruction, input.plan),
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

export function compactionInstruction(
  ctx: CompactionPipelineContext,
  instruction: string | undefined,
  plan: CompactionPlan | undefined,
  blockNote?: string,
): string {
  if (plan === undefined) return instruction ?? '';

  const preference = ctx.agent.getResponseLanguagePreference();
  const languageDirective =
    preference === undefined
      ? undefined
      : buildResponseLanguageDirective(preference, { wrapped: false });

  const lines = [
    instruction?.trim(),
    blockNote,
    'CONTEXT COMPACTION V2 OUTPUT CONTRACT:',
    'Preserve task continuity over compression ratio. Use the exact sections: current_goal, last_known_state, decisions, files_touched, failed_attempts, open_questions, next_actions, verified_claims, raw_refs.',
    'For verified_claims, tag each done/verified item as: claim | evidence=<test id, log path, or command> | needs_revalidation=true|false. Anything not re-verified in this session is needs_revalidation=true.',
    'Mention uncertain facts as uncertain. Do not invent file paths, test results, or decisions.',
    languageDirective,
    `Compacted tokens: ${String(plan.compactedTokens)}. Retained recent tokens: ${String(plan.retainedTokens)}.`,
    `Raw refs available after compaction: ${plan.rawRefs.map(formatRawRef).join('; ') || 'none'}.`,
  ];
  return lines.filter((line): line is string => line !== undefined && line.length > 0).join('\n\n');
}
