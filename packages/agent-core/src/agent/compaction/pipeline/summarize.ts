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
} from '@superliora/kosong';
import { ErrorCodes, isKimiError } from '#/errors/index';

import { isAbortError } from '../../../loop/errors';
import { retryBackoffDelays, sleepForRetry } from '../../../loop/retry';
import { renderPrompt } from '../../../utils/render-prompt';
import { estimateTokensForMessages } from '../../../utils/tokens';
import { buildResponseLanguageDirective } from '../../injection/response-language';
import compactionInstructionTemplate from '../prompts/compaction-instruction.md?raw';
import {
  AdaptiveConcurrencyLimiter,
  CompactionTruncatedError,
  DEFAULT_PARALLEL_BLOCK_CONCURRENCY,
  MAX_PARALLEL_BLOCK_CONCURRENCY,
  PARALLEL_CONCURRENCY_ENV,
  isCompactionSummarizerError,
  isRateLimitLikeError,
  mapWithConcurrency,
  parseEnvConcurrency,
} from '../full/adaptive-concurrency';
import {
  buildEmergencyBackstopSummary,
  shouldFallbackAfterCompactionRetries,
  shouldUseClassicalCompactionFallback,
} from '../full/backstop';
import { blockDensity, formatRawRef } from '../plan/context-helpers';
import {
  extractCompactionSummary,
  mergeTokenUsage,
  mergeTokenUsageOrNull,
} from '../full/full-helpers';
import { shouldUseParallelSummarize } from '../full/full-policy';
import { splitMessagesIntoTokenBlocks, type CompactionPlan } from '../plan/planner';
import { runCompactionGenerate } from './generate-guard';
import {
  emitCompactionProgress,
  fractionForBlocksCompleted,
  fractionForMergeDone,
  fractionForMergeStart,
} from './progress';
import type {
  CompactionPipelineContext,
  SummarizeInput,
  SummarizeOutput,
} from './types';
import { tryMergeStructuredBlockSummaries } from './merge-structured';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Parallelize earlier so medium sessions avoid one huge sequential summarize. */
const DEFAULT_PARALLEL_BLOCK_THRESHOLD = 8_000;
const DEFAULT_PARALLEL_BLOCK_TARGET = 5_000;
/**
 * Cap parallel block fan-out. A 5k-token target on a ~500k prefix yields 100+
 * blocks; that cannot finish inside the worker deadline and restart-loops as
 * cancel. Grow the target until we stay within this budget.
 */
export const MAX_PARALLEL_SUMMARY_BLOCKS = 24;
// Concurrent block LLM default lives in adaptive-concurrency (DEFAULT_PARALLEL_BLOCK_CONCURRENCY=3).
const PARALLEL_BLOCK_RATE_LIMIT_RETRIES = 4;
const MAX_COMPACTION_RETRY_ATTEMPTS = 5;
const MAX_COMPACTION_MERGE_RETRY_ATTEMPTS = 2;

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

export function splitIntoBlocks(
  ctx: CompactionPipelineContext,
  messages: readonly Message[],
): readonly (readonly Message[])[] {
  const configuredTarget = ctx.strategy.parallelBlockTarget ?? DEFAULT_PARALLEL_BLOCK_TARGET;
  let target = Math.max(1, configuredTarget);
  let blocks = splitMessagesIntoTokenBlocks(messages, target);
  if (blocks.length <= MAX_PARALLEL_SUMMARY_BLOCKS) return blocks;

  const totalTokens = Math.max(1, estimateTokensForMessages(messages));
  // Aim for at most MAX blocks; keep doubling until the split fits or the
  // target covers the whole prefix (single-block → sequential path).
  while (blocks.length > MAX_PARALLEL_SUMMARY_BLOCKS && target < totalTokens) {
    const fitted = Math.ceil(totalTokens / MAX_PARALLEL_SUMMARY_BLOCKS);
    target = Math.max(target * 2, fitted);
    blocks = splitMessagesIntoTokenBlocks(messages, target);
  }
  return blocks;
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
    readonly streamMeta: {
      readonly phase: 'summarizing';
      readonly streamKind: 'block';
      readonly blockIndex: number;
      readonly blockCount: number;
      readonly blocksCompleted: () => number;
      readonly fraction: () => number;
    };
    readonly retryCountRef: { value: number };
    readonly onRateLimit?: () => void;
  },
): Promise<Awaited<ReturnType<typeof runCompactionGenerate>>> {
  const delays = retryBackoffDelays(PARALLEL_BLOCK_RATE_LIMIT_RETRIES);
  let attempt = 0;
  while (true) {
    try {
      return await runCompactionGenerate(ctx, input.signal, {
        provider: input.provider,
        messages: input.messages,
        streamMeta: input.streamMeta,
      });
    } catch (error) {
      if (isRateLimitLikeError(error)) {
        input.onRateLimit?.();
      }
      if (!isRetryableGenerateError(error) || attempt + 1 >= PARALLEL_BLOCK_RATE_LIMIT_RETRIES) {
        throw error;
      }
      input.retryCountRef.value += 1;
      await sleepForRetry(delays[attempt] ?? delays.at(-1)!, input.signal);
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
      const response = await runCompactionGenerate(ctx, signal, {
        provider,
        messages,
        streamMeta: {
          phase: 'summarizing',
          streamKind: 'summary',
        },
      });
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
      if (isAbortError(error)) throw error;
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
        // After the retry budget, prefer classical extractive resume over
        // stranding the session — only abort/auth must still surface.
        if (
          isCompactionSummarizerError(error) ||
          shouldUseClassicalCompactionFallback(error) ||
          shouldFallbackAfterCompactionRetries(error)
        ) {
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
  // Fast path: all blocks already structured → deterministic list merge (no LLM RTT).
  const structuredMerge = tryMergeStructuredBlockSummaries(blockSummaries);
  if (structuredMerge !== undefined) {
    ctx.agent.telemetry.track('compaction_merge_deterministic', {
      block_count: blockSummaries.length,
      summary_chars: structuredMerge.length,
    });
    return {
      summary: structuredMerge,
      usage: null,
      mergeInputTokens: 0,
    };
  }

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
      const response = await runCompactionGenerate(ctx, signal, {
        provider,
        messages,
        streamMeta: {
          phase: 'summarizing',
          streamKind: 'merge',
        },
      });
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
      if (isAbortError(error)) throw error;
      if (
        attempt + 1 >= MAX_COMPACTION_MERGE_RETRY_ATTEMPTS ||
        !(
          error instanceof CompactionTruncatedError ||
          error instanceof APIEmptyResponseError ||
          isRetryableGenerateError(error)
        )
      ) {
        // Merge is a quality optimization. When the LLM merge fails (timeout,
        // 5xx, empty body…), concatenate structured/prose block summaries so
        // the session still gets a usable handoff instead of hard-failing.
        if (
          shouldUseClassicalCompactionFallback(error) ||
          shouldFallbackAfterCompactionRetries(error)
        ) {
          ctx.agent.telemetry.track('compaction_merge_fallback_concat', {
            error_type: error instanceof Error ? error.name : 'Unknown',
            block_count: blockSummaries.length,
          });
          return {
            summary: concatenateBlockSummaries(blockSummaries),
            usage: null,
            mergeInputTokens,
          };
        }
        throw error;
      }
      await sleepForRetry(delays[attempt]!, signal);
      retryCountRef.value += 1;
    }
  }

  throw lastError;
}

function concatenateBlockSummaries(blockSummaries: readonly string[]): string {
  return blockSummaries
    .map((summary, index) => {
      const body = summary.trim();
      if (body.length === 0) return '';
      return `## Block ${String(index + 1)}\n${body}`;
    })
    .filter((part) => part.length > 0)
    .join('\n\n');
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
  const orderedBlocks = [...blocks].toSorted(
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
          streamMeta: {
            phase: 'summarizing',
            streamKind: 'block',
            blockIndex: index + 1,
            blockCount,
            // Live getters, not snapshots: under concurrency a captured
            // count goes stale the moment another block finishes, and this
            // block's next delta would rewind the TUI's "block n/N" counter.
            blocksCompleted: () => blocksCompleted,
            fraction: () => fractionForBlocksCompleted(blocksCompleted, blockCount),
          },
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
    'CONTEXT COMPACTION V2 OUTPUT CONTRACT (required labels):',
    'Preserve task continuity over compression ratio. Use exact section labels:',
    'current_goal: (Objective — governing latest user ask)',
    'last_known_state: (Work State — measured facts now)',
    'decisions: (settled choices still in force)',
    'files_touched: (Relevant Files — exact paths)',
    'failed_attempts: (errors that still constrain next steps)',
    'open_questions: (unknowns that change the next action)',
    'next_actions: (Next Move — ordered; first item is immediate)',
    'verified_claims: claim | evidence=<id|path|command> | needs_revalidation=true|false',
    'raw_refs: durable ids only (node/AC/evidence/archive/plan/goal)',
    'Anything not re-verified this session is needs_revalidation=true. Mention uncertain facts as uncertain. Do not invent paths, test results, or decisions.',
    languageDirective,
    `Compacted tokens: ${String(plan.compactedTokens)}. Retained recent tokens: ${String(plan.retainedTokens)}.`,
    `Raw refs available after compaction: ${plan.rawRefs.map(formatRawRef).join('; ') || 'none'}.`,
  ];
  return lines.filter((line): line is string => line !== undefined && line.length > 0).join('\n\n');
}
