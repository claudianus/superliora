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

    for (let round = 1; ; round++) {
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

      if (result.tokensBefore - result.tokensAfter < 1024) break;
      if (!host.strategy.shouldBlock(result.tokensAfter)) break;
      compactedCount = host.strategy.computeCompactCount(host.agent.context.history, data.source);
      if (compactedCount === 0) break;
    }
    if (finalActions.length > 0) finalResult.actions = finalActions;
    if (finalRawRefs.length > 0) finalResult.rawRefs = finalRawRefs;
    if (finalQualityWarnings.length > 0) {
      finalResult.qualityWarnings = [...new Set(finalQualityWarnings)];
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