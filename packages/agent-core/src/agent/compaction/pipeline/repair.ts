/**
 * Evidence-second-chance repair stage.
 *
 * Extracted from full.ts — when a compaction summary fails deterministic
 * quality checks due to missing evidence IDs, this module attempts a single
 * targeted repair pass and revalidates the result.
 */

import type { ChatProvider, Message, TokenUsage } from '@superliora/kosong';
import { createUserMessage } from '@superliora/kosong';

import type { CompactionPlan } from '../plan/planner';
import {
  mergeCompactionQualityResults,
  validateRenderedCompactionSummary,
  validateUltraworkCompactionContinuity,
  type CompactionQualityResult,
} from '../plan/quality';
import { CompactionTruncatedError } from '../full/adaptive-concurrency';
import {
  extractCompactionSummary,
  isMissingEvidenceQualityFailure,
  mergeTokenUsage,
} from '../full/full-helpers';
import { buildCompactionSummaryText } from '../micro/handoff';
import { isAbortError } from '../../../loop/errors';
import { estimateTokens, estimateTokensForMessages } from '../../../utils/tokens';
import { renderPrompt } from '../../../utils/render-prompt';
import { captureUltraworkEnvelopeSnapshot } from '#/mission';
import compactionInstructionTemplate from '../prompts/compaction-instruction.md?raw';

import { postProcessSummary, renderStructuredV2Summary } from './enrich';
import { runCompactionGenerate } from './generate-guard';
import { compactionInstruction } from './summarize';
import type { CompactionPipelineContext, RepairInput, RepairOutput } from './types';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function applyEvidenceSecondChanceRepair(
  ctx: CompactionPipelineContext,
  input: RepairInput,
): Promise<RepairOutput> {
  let {
    summary,
    usage,
    quality,
    contextSummary,
    summaryTokens,
    retained,
    retainedTokens,
    tokensAfter,
  } = input;
  let repairAttempted = false;

  if (
    quality.critical.length === 0 ||
    input.usedEmergencyBackstop ||
    !isMissingEvidenceQualityFailure(quality)
  ) {
    return {
      summary,
      usage,
      quality,
      repairAttempted,
      contextSummary,
      summaryTokens,
      retained,
      retainedTokens,
      tokensAfter,
    };
  }

  ctx.agent.telemetry.track('compaction_evidence_repair_started', {
    critical_count: quality.critical.length,
    warning_categories: quality.warningCategories.join(','),
    evidence_id_recall_score: quality.signals?.evidenceIdRecallScore,
  });
  const repair = await repairSummaryForQuality(
    ctx,
    input.signal,
    input.provider,
    input.messagesToCompact,
    input.plan,
    input.instruction,
    quality,
    summary,
  );
  summary = repair.summary;
  repairAttempted = true;
  if (repair.usage !== null) {
    usage = mergeTokenUsage(usage, repair.usage);
  }
  const revalidated = revalidateAfterEvidenceRepair(ctx, {
    summary: repair.summary,
    plan: input.plan,
    messagesToCompact: input.messagesToCompact,
    archiveGuidance: input.archiveGuidance,
    compactedCount: input.compactedCount,
    priorQuality: quality,
    ultraworkSnapshot: input.ultraworkSnapshot as ReturnType<typeof captureUltraworkEnvelopeSnapshot>,
  });
  ctx.agent.telemetry.track('compaction_evidence_repair_finished', {
    critical_count: revalidated.quality.critical.length,
    warning_categories: revalidated.quality.warningCategories.join(','),
    evidence_id_recall_score: revalidated.quality.signals?.evidenceIdRecallScore,
    repaired_ok: revalidated.quality.critical.length === 0,
  });

  return {
    summary: revalidated.summary,
    usage,
    quality: revalidated.quality,
    repairAttempted,
    contextSummary: revalidated.contextSummary,
    summaryTokens: revalidated.summaryTokens,
    retained: revalidated.retained,
    retainedTokens: revalidated.retainedTokens,
    tokensAfter: revalidated.tokensAfter,
  };
}

export async function repairSummaryForQuality(
  ctx: CompactionPipelineContext,
  signal: AbortSignal,
  provider: ChatProvider,
  messagesToCompact: readonly Message[],
  plan: CompactionPlan,
  instruction: string | undefined,
  quality: CompactionQualityResult,
  previousSummary = '',
): Promise<{ summary: string; usage: TokenUsage | null }> {
  const repairPrompt = renderPrompt(compactionInstructionTemplate, {
    customInstruction: compactionInstruction(
      ctx,
      instruction,
      plan,
      [
        'The previous compaction summary failed deterministic quality checks.',
        `Failed checks: ${[...quality.critical, ...quality.warnings].join('; ')}`,
        quality.warningCategories.includes('unstructured_summary')
          ? 'Rewrite as structured v2 labels only: current_goal, last_known_state, decisions, files_touched, failed_attempts, open_questions, next_actions, verified_claims, raw_refs. Do not return free-form prose alone.'
          : 'Keep the exact v2 section labels (current_goal, last_known_state, next_actions, …).',
        quality.warningCategories.includes('missing_evidence_ids')
          ? 'Preserve every durable identifier from the compacted history: evidence_ids, WorkGraph/node ids, AC ids, and [liora-archived id=...] markers.'
          : 'Preserve durable identifiers (evidence_ids, node ids, archive markers) when they appear in the history.',
        'Produce a complete replacement summary.',
      ].join('\n\n'),
    ),
  });
  const projected = repairProjection(ctx, messagesToCompact, repairPrompt, previousSummary);
  const messages = [...projected.messages, createUserMessage(projected.prompt)];
  try {
    const response = await runCompactionGenerate(ctx, signal, {
      provider,
      messages,
      streamMeta: {
        phase: 'repairing',
        streamKind: 'repair',
      },
    });
    if (response.finishReason === 'truncated') {
      throw new CompactionTruncatedError();
    }
    return {
      summary: extractCompactionSummary(response),
      usage: response.usage,
    };
  } catch (error) {
    // Repair is best-effort. Surface user abort so cancel stays responsive;
    // every other failure keeps the pre-repair summary so the round can still
    // assemble (or swap to the extractive backstop at the final QC gate).
    if (isAbortError(error)) throw error;
    ctx.agent.telemetry.track('compaction_repair_soft_fail', {
      error_type: error instanceof Error ? error.name : 'Unknown',
    });
    return {
      summary: previousSummary,
      usage: null,
    };
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Token cap for the raw prefix re-sent during a repair round. */
const REPAIR_PREFIX_MAX_TOKENS = 64_000;

/**
 * Build the repair LLM input. The full prefix is re-sent only up to the
 * budget; the most recent messages win because the previous draft (attached
 * to the prompt) still covers the elided older material. This bounds repair
 * input tokens instead of re-transmitting the entire prefix per attempt.
 */
function repairProjection(
  ctx: CompactionPipelineContext,
  messagesToCompact: readonly Message[],
  repairPrompt: string,
  previousSummary: string,
): { messages: readonly Message[]; prompt: string } {
  let projected = ctx.agent.context.projectForCompaction(messagesToCompact);
  let elidedNote = '';
  if (estimateTokensForMessages(projected) > REPAIR_PREFIX_MAX_TOKENS) {
    let keptFrom = 0;
    let tokens = 0;
    for (let i = projected.length - 1; i >= 0; i--) {
      const messageTokens = estimateTokensForMessages([projected[i]!]);
      if (tokens + messageTokens > REPAIR_PREFIX_MAX_TOKENS) break;
      tokens += messageTokens;
      keptFrom = i;
    }
    if (keptFrom > 0) {
      projected = projected.slice(keptFrom);
      elidedNote = `\n\nNote: the oldest ${keptFrom} messages of the compacted prefix were elided to fit the repair budget; for that older material rely on the previous draft below.`;
      ctx.agent.telemetry.track('compaction_repair_prefix_elided', {
        dropped_messages: keptFrom,
      });
    }
  }
  const draft = previousSummary.trim();
  const prompt =
    draft.length === 0
      ? `${repairPrompt}${elidedNote}`
      : `${repairPrompt}${elidedNote}\n\nPrevious draft (fix its failed checks; keep what is already correct):\n${draft}`;
  return { messages: projected, prompt };
}

export function revalidateAfterEvidenceRepair(
  ctx: CompactionPipelineContext,
  input: {
    readonly summary: string;
    readonly plan: CompactionPlan;
    readonly messagesToCompact: readonly Message[];
    readonly archiveGuidance: string;
    readonly compactedCount: number;
    readonly priorQuality: CompactionQualityResult;
    readonly ultraworkSnapshot: ReturnType<typeof captureUltraworkEnvelopeSnapshot>;
  },
): {
  summary: string;
  quality: CompactionQualityResult;
  contextSummary: string;
  summaryTokens: number;
  retained: readonly Message[];
  retainedTokens: number;
  tokensAfter: number;
} {
  let summary = postProcessSummary(ctx, input.summary);
  summary = renderStructuredV2Summary(ctx, summary, input.plan);
  if (input.archiveGuidance.length > 0) {
    summary = `${summary.trimEnd()}${input.archiveGuidance}`;
  }
  const contextSummary = buildCompactionSummaryText(summary);
  const summaryTokens = estimateTokens(contextSummary);
  const retained = ctx.agent.context.history.slice(input.compactedCount);
  const retainedTokens = estimateTokensForMessages(retained);
  const tokensAfter = summaryTokens + retainedTokens;
  const renderedQuality = validateRenderedCompactionSummary(
    summary,
    input.plan,
    input.messagesToCompact,
    tokensAfter,
  );
  let quality: CompactionQualityResult = {
    critical: renderedQuality.critical,
    warnings: mergeCompactionQualityResults(input.priorQuality, renderedQuality).warnings,
    warningCategories: mergeCompactionQualityResults(input.priorQuality, renderedQuality)
      .warningCategories,
    signals: renderedQuality.signals ?? input.priorQuality.signals,
  };
  if (input.ultraworkSnapshot !== undefined) {
    quality = mergeCompactionQualityResults(
      quality,
      validateUltraworkCompactionContinuity(summary, input.ultraworkSnapshot),
    );
  }
  return {
    summary,
    quality,
    contextSummary,
    summaryTokens,
    retained,
    retainedTokens,
    tokensAfter,
  };
}
