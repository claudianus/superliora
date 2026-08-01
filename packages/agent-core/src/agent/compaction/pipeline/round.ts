/**
 * One compaction round — extracted from FullCompaction.
 *
 * Summarize prefix, validate/repair quality, enrich, assemble, and apply.
 */

import { join } from 'node:path';

import {
  ErrorCodes,
  LioraError,
  isKimiError,
} from '#/errors/index';
import type { Message, TokenUsage } from '@superliora/kosong';

import { isAbortError } from '../../../loop/errors';
import { estimateTokens, estimateTokensForMessages } from '../../../utils/tokens';
import { buildEmergencyBackstopSummary } from '../full/backstop';
import { buildCompactionSummaryText } from '../micro/handoff';
import {
  compactionFinishedTelemetryProperties,
  compactionV2FinishedTelemetryProperties,
  evidenceRepairSucceeded,
  formatContextManagementCapability,
  isMissingEvidenceQualityFailure,
  mergeTokenUsage,
  stripResolvedEvidenceCriticals,
} from '../full/full-helpers';
import {
  injectMissingDurableEvidenceIds,
  mergeCompactionQualityResults,
  validateInitialCompactionSummary,
  validateRenderedCompactionSummary,
  validateUltraworkCompactionContinuity,
  type CompactionQualityResult,
} from '../plan/quality';
import { ensureStructuredHandoffScaffold } from '../plan/handoff-scaffold';
import { latestUserText } from '../plan/quality-helpers';
import type { CompactionBeginData, CompactionResult } from '../types';
import { emitCompactionProgress, fractionForMergeDone, fractionForFinalizing } from './progress';
import { summarizeCompactedPrefix } from './summarize';
import { enrichCompactionSummary } from './enrich';
import {
  assembleCompactionResult,
  archiveCompactedToolExchanges,
  persistCompactionRecall,
  type CompletedCompactionResult,
} from './assemble';
import {
  applyEvidenceSecondChanceRepair,
  repairSummaryForQuality,
  revalidateAfterEvidenceRepair,
} from './repair';
import type { FullCompactionRoundHost } from './types';
import { PROGRESS_WEIGHT_PLAN } from './types';

export async function runCompactionRound(
  host: FullCompactionRoundHost,
  round: number,
  signal: AbortSignal,
  data: Readonly<CompactionBeginData>,
  initialCompactedCount: number,
): Promise<CompactionResult | undefined> {
  const startedAt = Date.now();
  const originalHistory = [...host.agent.context.history];
  const tokensBefore = estimateTokensForMessages(originalHistory);
  const retryCount = { value: 0 };
  try {
    let compactedCount = initialCompactedCount;

    await host.triggerPreCompactHook(data, tokensBefore, signal);

    const model = host.agent.config.model;
    let summary: string;
    let usage: TokenUsage | null = null;
    let parallelBlockCount = 0;
    let mergeInputTokens: number | undefined;
    let repairAttempted = false;
    let usedEmergencyBackstop = false;
    let messagesToCompact: readonly Message[] = originalHistory.slice(0, compactedCount);
    let plan = host.planner.plan(originalHistory, compactedCount);
    const provider = host.createCompactionProvider(
      estimateTokensForMessages(messagesToCompact),
    );
    // Volatile phase signal so live clients can render phase-aware progress.
    emitCompactionProgress(host.agent, {
      phase: 'summarizing',
      streamKind: 'summary',
      fraction: PROGRESS_WEIGHT_PLAN,
    });
    const summarized = await summarizeCompactedPrefix(host, {
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
    plan = host.planner.plan(originalHistory, compactedCount);

    // Archive compacted tool-exchange groups so their original content stays
    // recoverable via liora-expand after the prefix is summarized away.
    const { rawRefs: archivedRawRefs, guidance: archiveGuidance } =
      archiveCompactedToolExchanges(host, originalHistory, plan);
    if (archivedRawRefs !== plan.rawRefs) {
      plan = { ...plan, rawRefs: archivedRawRefs as typeof plan.rawRefs };
    }

    // Volatile phase signal: summary validation / repair begins.
    emitCompactionProgress(host.agent, {
      phase: 'repairing',
      streamKind: 'repair',
      fraction: fractionForMergeDone(),
    });
    // Provider-agnostic: free-form prose → structured v2 scaffold before QC.
    // Repair still runs if critical gaps remain (e.g. missing durable evidence).
    summary = ensureStructuredHandoffScaffold(summary, {
      latestUserRequest: latestUserText(messagesToCompact),
    });
    const initialQuality = validateInitialCompactionSummary(summary, plan, messagesToCompact);
    let quality: CompactionQualityResult = initialQuality;
    if (initialQuality.critical.length > 0 && !usedEmergencyBackstop) {
      // Evidence-id gaps are recovered deterministically after enrichment —
      // skip an extra LLM repair RTT when that is the only critical failure.
      const evidenceOnly =
        isMissingEvidenceQualityFailure(initialQuality) &&
        initialQuality.critical.every((item) => item.includes('durable evidence'));
      if (evidenceOnly) {
        host.agent.telemetry.track('compaction_qc_repair_skipped_evidence_only', {
          critical_count: initialQuality.critical.length,
        });
      } else {
        const repair = await repairSummaryForQuality(
          host,
          signal,
          provider,
          messagesToCompact,
          plan,
          data.instruction,
          initialQuality,
        );
        summary = repair.summary;
        // Re-scaffold in case repair returned free-form prose.
        summary = ensureStructuredHandoffScaffold(summary, {
          latestUserRequest: latestUserText(messagesToCompact),
        });
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
          const repairedEvidenceOnly =
            isMissingEvidenceQualityFailure(repairedQuality) &&
            repairedQuality.critical.every((item) => item.includes('durable evidence'));
          if (!repairedEvidenceOnly) {
            // Surviving non-evidence criticals are deliberately NOT thrown here:
            // throwing would hard-stall the turn. They propagate to the final
            // quality gate below, which swaps in the deterministic backstop and
            // lets the turn resume on a well-formed summary.
            host.agent.telemetry.track('compaction_qc_repair_unresolved', {
              critical_count: repairedQuality.critical.length,
            });
          }
        }
      }
    }

    if (usage !== null) {
      host.agent.usage.record(model, usage);
    }

    const newHistory = host.agent.context.history;
    for (let i = 0; i < originalHistory.length; i++) {
      if (newHistory[i] !== originalHistory[i]) {
        // History changed during compaction, likely due to undo
        host.cancel();
        return undefined;
      }
    }

    const enrichment = enrichCompactionSummary(host, {
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
    let retained: readonly Message[] = host.agent.context.history.slice(compactedCount);
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
    const evidenceRepair = await applyEvidenceSecondChanceRepair(host, {
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

    // Last-resort: splice missing durable IDs from the compacted history into the
    // summary. Hard-failing auto-compaction here freezes long sessions forever.
    if (
      quality.critical.length > 0 &&
      !usedEmergencyBackstop &&
      isMissingEvidenceQualityFailure(quality)
    ) {
      const injected = injectMissingDurableEvidenceIds(
        summary,
        messagesToCompact,
        host.agent.homedir !== undefined ? join(host.agent.homedir, 'compaction') : undefined,
      );
      if (injected.injectedIds.length > 0) {
        host.agent.telemetry.track('compaction_evidence_ids_injected', {
          injected_count: injected.injectedIds.length,
          injected_ids: injected.injectedIds.join(','),
        });
        const revalidated = revalidateAfterEvidenceRepair(host, {
          summary: injected.summary,
          plan,
          messagesToCompact,
          archiveGuidance,
          compactedCount,
          priorQuality: quality,
          ultraworkSnapshot,
        });
        summary = revalidated.summary;
        quality = stripResolvedEvidenceCriticals(
          revalidated.quality,
        ) as CompactionQualityResult;
        contextSummary = revalidated.contextSummary;
        summaryTokens = revalidated.summaryTokens;
        retained = revalidated.retained;
        retainedTokens = revalidated.retainedTokens;
        tokensAfter = revalidated.tokensAfter;
        repairAttempted = true;
      }
    }

    if (quality.critical.length > 0 && !usedEmergencyBackstop) {
      // Criticals that survive every repair pass must not hard-stall the turn:
      // swap in the deterministic extractive backstop and continue assembling so
      // the session keeps a well-formed summary instead of freezing.
      summary = buildEmergencyBackstopSummary(messagesToCompact, plan, data.instruction);
      usedEmergencyBackstop = true;
      contextSummary = buildCompactionSummaryText(summary);
      summaryTokens = estimateTokens(contextSummary);
      tokensAfter = summaryTokens + retainedTokens;
      host.agent.telemetry.track('compaction_qc_fallback_backstop', {
        critical_count: quality.critical.length,
      });
    }

    // Volatile phase signal: assembly / context rebuild begins.
    emitCompactionProgress(host.agent, {
      phase: 'finalizing',
      fraction: fractionForFinalizing(),
    });
    const result = assembleCompactionResult(host, {
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
    const recallMemorySavedCount = await persistCompactionRecall(host, result);
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
      thinkingLevel: host.agent.config.thinkingLevel,
      usage,
      actionTypes: result.actions?.map((action) => action.type).join(',') ?? '',
      qualityWarnings: result.qualityWarnings?.join(',') ?? '',
    };
    host.agent.telemetry.track(
      'compaction_finished',
      compactionFinishedTelemetryProperties(finishedTelemetry),
    );
    host.agent.telemetry.track(
      'compaction_v2_finished',
      compactionV2FinishedTelemetryProperties(finishedTelemetry),
    );
    host.recordCompactionQuality({
      recallEvalScore: qualitySignals?.recallEvalScore,
      usedEmergencyBackstop,
      evidenceRepairAttempted: repairAttempted,
      evidenceRepairSucceeded: evidenceRepairSucceeded({
        repairAttempted,
        evidenceIdRecallScore: qualitySignals?.evidenceIdRecallScore,
        qualityWarningCategories: result.qualityWarningCategories ?? [],
      }),
    });
    const applied = host.agent.context.applyCompaction(result);
    host.lastCompactedTokenCount = applied.tokensAfter;
    return applied;
  } catch (error) {
    if (isAbortError(error)) return;
    host.agent.telemetry.track('compaction_failed', {
      source: data.source,
      tokens_before: tokensBefore,
      duration_ms: Date.now() - startedAt,
      round,
      retry_count: retryCount.value,
      thinking_level: host.agent.config.thinkingLevel,
      error_type: error instanceof Error ? error.name : 'Unknown',
    });
    if (isKimiError(error) && error.code === ErrorCodes.AUTH_LOGIN_REQUIRED) throw error;
    throw new LioraError(ErrorCodes.COMPACTION_FAILED, String(error), { cause: error });
  }
}
