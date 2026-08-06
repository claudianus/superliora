/**
 * Compaction worker loop — extracted from FullCompaction.
 */

import { APITimeoutError } from '@superliora/kosong';
import { toKimiErrorPayload } from '#/errors/index';

import { isAbortError } from '../../../loop/errors';
import { createDeadlineAbortSignal } from '../../../utils/abort';
import type {
  CompactionBeginData,
  CompactionResult,
  CompactionResultAction,
  CompactionResultRawRef,
} from '../types';
import {
  injectResumeRecheckReminder,
} from '../pipeline/assemble';
import { resolveCompactionWorkerTimeoutMs } from '../pipeline/generate-guard';
import type { FullCompactionWorkerHost } from '../pipeline/types';
import {
  runCompactionRound,
  StaleCompactionContextError,
} from '../pipeline/round';

/** Hard cap on multi-round compaction so a pathological history cannot loop forever. */
const MAX_COMPACTION_ROUNDS = 8;
/**
 * Minimum absolute reduction per round to keep multi-rounding. Below this we stop
 * rather than thrashing with near-zero progress.
 */
const MIN_ROUND_REDUCTION_TOKENS = 1_024;
/** Bound wasted summarizer calls when a live turn keeps mutating the context. */
const MAX_STALE_CONTEXT_RETRIES = 3;

export async function runCompactionWorker(
  host: FullCompactionWorkerHost,
  signal: AbortSignal,
  data: Readonly<CompactionBeginData>,
  compactedCount: number,
): Promise<void> {
  // Whole-worker wall-clock budget: even if individual generate calls hang past
  // their own deadlines (or a post-generate stage never settles), this always
  // aborts the compaction lock so the session cannot freeze permanently.
  const workerTimeoutMs = resolveCompactionWorkerTimeoutMs();
  const deadline = createDeadlineAbortSignal(signal, workerTimeoutMs);
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
    let staleContextRetries = 0;

    for (let round = 1; round <= MAX_COMPACTION_ROUNDS; round++) {
      deadline.signal.throwIfAborted();
      let result: CompactionResult | undefined;
      try {
        result = await runCompactionRound(
          host,
          round,
          deadline.signal,
          data,
          compactedCount,
        );
      } catch (error) {
        if (!(error instanceof StaleCompactionContextError)) throw error;
        staleContextRetries += 1;
        host.agent.telemetry.track('compaction_stale_context_retry', {
          retry: staleContextRetries,
          round,
        });
        if (staleContextRetries > MAX_STALE_CONTEXT_RETRIES) {
          host.agent.telemetry.track('compaction_stale_context_retry_exhausted', {
            retries: staleContextRetries,
          });
          return;
        }
        compactedCount = host.strategy.computeCompactCount(
          host.agent.context.history,
          data.source,
        );
        if (compactedCount === 0) return;
        continue;
      }
      if (!result) return;
      staleContextRetries = 0;

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

      const reduced = result.tokensBefore - result.tokensAfter;
      const stillBlocking = host.strategy.shouldBlock(result.tokensAfter);
      // Keep multi-rounding while above the soft compact trigger, not only the
      // hard block — otherwise a 2M → 1.95M pass can stop while still far over
      // the working set / real API ceiling.
      const stillOverSoft =
        host.strategy.shouldCompact(result.tokensAfter) || stillBlocking;
      if (reduced < MIN_ROUND_REDUCTION_TOKENS) {
        if (stillBlocking || stillOverSoft) {
          host.agent.telemetry.track('compaction_stalled_over_threshold', {
            tokens_after: result.tokensAfter,
            reduced,
            round,
            still_blocking: stillBlocking,
          });
        }
        break;
      }
      // A growth-only pass (summary larger than the compacted prefix, common on
      // short histories / emergency backstop) cannot reclaim more by looping.
      if (reduced <= 0) {
        host.agent.telemetry.track('compaction_round_no_reduction', {
          tokens_before: result.tokensBefore,
          tokens_after: result.tokensAfter,
          round,
        });
        break;
      }
      if (!stillOverSoft) break;
      compactedCount = host.strategy.computeCompactCount(host.agent.context.history, data.source);
      if (compactedCount === 0) break;
    }
    if (finalActions.length > 0) finalResult.actions = finalActions;
    if (finalRawRefs.length > 0) finalResult.rawRefs = finalRawRefs;
    if (finalQualityWarnings.length > 0) {
      finalResult.qualityWarnings = [...new Set(finalQualityWarnings)];
    }
    if (host.strategy.shouldBlock(finalResult.tokensAfter)) {
      // Partial win only — next beforeStep / overflow recovery must re-arm.
      // Surface in quality warnings so TUI/debug can see it was not a clean reclaim.
      const warning =
        `compaction residual still over block threshold (${String(finalResult.tokensAfter)} tokens)`;
      finalResult.qualityWarnings = [...(finalResult.qualityWarnings ?? []), warning];
      host.agent.telemetry.track('compaction_completed_still_blocking', {
        tokens_before: finalResult.tokensBefore,
        tokens_after: finalResult.tokensAfter,
        compacted_count: finalResult.compactedCount,
      });
    }
    await host.agent.injection.injectAfterCompaction();
    injectResumeRecheckReminder(host, finalResult.summary);
    host.syncCompactionBaseline();
    host.triggerPostCompactHook(data, finalResult);
    host.markCompleted();
    host.agent.emitEvent({ type: 'compaction.completed', result: finalResult });
    host.agent.turn.onCompactionFinished();
  } catch (error) {
    // Worker wall-clock timeout: surface as APITimeoutError so blocked turns
    // get a real failure instead of a silent cancel-shaped abort.
    const timedOut = deadline.timedOut();
    const effectiveError = timedOut
      ? new APITimeoutError(
          `Compaction worker timed out after ${String(workerTimeoutMs)}ms.`,
        )
      : error;
    if (timedOut) {
      host.agent.telemetry.track('compaction_worker_timeout', {
        timeout_ms: workerTimeoutMs,
      });
    }
    // Caller abort (not worker timeout) is settled by the `finally` below,
    // which releases the lock if this worker still owns it.
    if (!timedOut && isAbortError(error)) return;
    const blockedByTurn = host.compacting?.blockedByTurn === true;
    host.cancel();
    host.agent.log.error('compaction failed', { error: effectiveError });
    if (blockedByTurn) {
      throw effectiveError;
    }
    host.agent.emitEvent({
      type: 'error',
      ...toKimiErrorPayload(effectiveError),
    });
  } finally {
    deadline.clear();
    host.releaseLockIfOwned();
  }
}