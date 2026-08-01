/**
 * Compaction worker loop — extracted from FullCompaction.
 */

import { toKimiErrorPayload } from '#/errors/index';

import { isAbortError } from '../../../loop/errors';
import type {
  CompactionBeginData,
  CompactionResult,
  CompactionResultAction,
  CompactionResultRawRef,
} from '../types';
import {
  injectResumeRecheckReminder,
} from '../pipeline/assemble';
import type { FullCompactionWorkerHost } from '../pipeline/types';
import { runCompactionRound } from '../pipeline/round';

/** Hard cap on multi-round compaction so a pathological history cannot loop forever. */
const MAX_COMPACTION_ROUNDS = 8;
/**
 * Minimum absolute reduction per round to keep multi-rounding. Below this we stop
 * rather than thrashing with near-zero progress.
 */
const MIN_ROUND_REDUCTION_TOKENS = 1_024;

export async function runCompactionWorker(
  host: FullCompactionWorkerHost,
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

    for (let round = 1; round <= MAX_COMPACTION_ROUNDS; round++) {
      const result = await runCompactionRound(host, round, signal, data, compactedCount);
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
    // Abort errors are settled by the `finally` below, which releases the
    // lock if this worker still owns it.
    if (isAbortError(error)) return;
    const blockedByTurn = host.compacting?.blockedByTurn === true;
    host.cancel();
    host.agent.log.error('compaction failed', { error });
    if (blockedByTurn) {
      throw error;
    }
    host.agent.emitEvent({
      type: 'error',
      ...toKimiErrorPayload(error),
    });
  } finally {
    host.releaseLockIfOwned();
  }
}