/**
 * Evidence-second-chance repair stage.
 *
 * Extracted from full.ts — when a compaction summary fails deterministic
 * quality checks due to missing evidence IDs, this module attempts a single
 * targeted repair pass and revalidates the result.
 */

import type { ChatProvider, Message, TokenUsage, Tool } from '@superliora/kosong';
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
import { estimateTokens, estimateTokensForMessages } from '../../../utils/tokens';
import { renderPrompt } from '../../../utils/render-prompt';
import { captureUltraworkEnvelopeSnapshot } from '#/mission';
import compactionInstructionTemplate from '../prompts/compaction-instruction.md?raw';

import { postProcessSummary, renderStructuredV2Summary } from './enrich';
import { compactionStreamCallbacks } from './progress';
import { compactionInstruction } from './summarize';
import type { CompactionPipelineContext, RepairInput, RepairOutput } from './types';

const COMPACTION_GENERATE_TOOLS: Tool[] = [];

function compactionGenerateOptions(
  ctx: CompactionPipelineContext,
  signal: AbortSignal,
): { readonly signal: AbortSignal; readonly runtimeModelAlias?: string } {
  return {
    signal,
    runtimeModelAlias: ctx.compactionModelAlias,
  };
}

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
): Promise<{ summary: string; usage: TokenUsage | null }> {
  const repairPrompt = renderPrompt(compactionInstructionTemplate, {
    customInstruction: compactionInstruction(
      ctx,
      instruction,
      plan,
      [
        'The previous compaction summary failed deterministic quality checks.',
        `Failed checks: ${[...quality.critical, ...quality.warnings].join('; ')}`,
        quality.warningCategories.includes('missing_evidence_ids')
          ? 'Preserve every durable identifier from the compacted history: evidence_ids, WorkGraph/node ids, AC ids, and [liora-archived id=...] markers.'
          : 'Preserve durable identifiers (evidence_ids, node ids, archive markers) when they appear in the history.',
        'Produce a complete replacement summary. Keep the exact v2 section labels when you use structured memory.',
      ].join('\n\n'),
    ),
  });
  const messages = [
    ...ctx.agent.context.projectForCompaction(messagesToCompact),
    createUserMessage(repairPrompt),
  ];
  const response = await ctx.agent.generate(
    provider,
    ctx.agent.config.systemPrompt,
    COMPACTION_GENERATE_TOOLS,
    messages,
    compactionStreamCallbacks(ctx.agent, {
      phase: 'repairing',
      streamKind: 'repair',
    }),
    compactionGenerateOptions(ctx, signal),
  );
  if (response.finishReason === 'truncated') {
    throw new CompactionTruncatedError();
  }
  return {
    summary: extractCompactionSummary(response),
    usage: response.usage,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

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
