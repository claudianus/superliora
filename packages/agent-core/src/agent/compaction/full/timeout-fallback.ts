/**
 * Last-resort reclaim when the compaction worker wall-clock budget expires.
 * Prefer an extractive backstop over cancel→retry loops that never finish.
 */

import { estimateTokens, estimateTokensForMessages } from '../../../utils/tokens';
import { buildCompactionSummaryText } from '../micro/handoff';
import { assembleCompactionResult } from '../pipeline/assemble';
import { postProcessSummary, renderStructuredV2Summary } from '../pipeline/enrich';
import type { FullCompactionWorkerHost } from '../pipeline/types';
import type { CompactionBeginData, CompactionResult } from '../types';
import { buildEmergencyBackstopSummary } from './backstop';

export function applyTimeoutEmergencyCompaction(
  host: FullCompactionWorkerHost,
  data: Readonly<CompactionBeginData>,
  compactedCount: number,
): CompactionResult | undefined {
  try {
    const history = host.agent.context.history;
    let count = host.strategy.computeCompactCount(history, data.source);
    if (count <= 0) {
      count = Math.min(Math.max(0, compactedCount), history.length);
    }
    if (count <= 0) return undefined;

    const messagesToCompact = history.slice(0, count);
    const plan = host.planner.plan(history, count);
    const tokensBefore = estimateTokensForMessages(history);
    const emergencyRaw = buildEmergencyBackstopSummary(
      messagesToCompact,
      plan,
      data.instruction,
    );
    const summary = renderStructuredV2Summary(
      host,
      postProcessSummary(host, emergencyRaw),
      plan,
    );
    const contextSummary = buildCompactionSummaryText(summary);
    const summaryTokens = estimateTokens(contextSummary);
    const retained = history.slice(count);
    const retainedTokens = estimateTokensForMessages(retained);
    const tokensAfter = summaryTokens + retainedTokens;
    const provider = host.createCompactionProvider(
      estimateTokensForMessages(messagesToCompact),
    );
    const assembled = assembleCompactionResult(host, {
      summary,
      contextSummary,
      compactedCount: count,
      tokensBefore,
      tokensAfter,
      plan,
      quality: {
        critical: [],
        warnings: ['worker timed out; used emergency extractive backstop'],
        warningCategories: ['emergency_backstop'],
      },
      summaryTokens,
      retainedTokens,
      retainedCount: retained.length,
      parallelBlockCount: 0,
      mergeInputTokens: undefined,
      repairAttempted: false,
      usedEmergencyBackstop: true,
      source: data.source,
      provider,
    });
    return host.agent.context.applyCompaction(assembled);
  } catch {
    return undefined;
  }
}
