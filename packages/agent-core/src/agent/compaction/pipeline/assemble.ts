import { join } from 'node:path';

import type { ChatProvider, Message } from '@superliora/kosong';

import { archiveContent } from '../../../tools/builtin/context/context-archive';
import {
  countStructuredMemoryItems,
  createCompactionRecallMemories,
  evaluateContinuity,
  extractFileHints,
  inferMemoryTiers,
  selectRehydrationRawRefKinds,
  uniqueHints,
  uniqueSorted,
} from '../plan/context-helpers';
import {
  buildEmergencyBackstopActions,
  emergencyBackstopWarnings,
  formatContextManagementCapability,
  mergeQualityWarningLists,
  shouldIncludeCompactionQualitySignals,
} from '../full/full-helpers';
import { parseStructuredCompactionMemory } from '../memory';
import { groupMessages, type CompactionPlan } from '../plan/planner';
import type { CompactionQualityResult } from '../plan/quality';
import { renderMessagesToText } from '../plan/render-messages';
import { persistCompactionSidecar } from '../memory/sidecar';
import type {
  CompactionBeginData,
  CompactionContextOS,
  CompactionContextPack,
  CompactionQualitySignals,
  CompactionResult,
  CompactionResultRawRef,
  CompactionSource,
} from '../types';
import type { CompactionPipelineContext } from './types';

const MAX_INLINE_ARCHIVE_IDS = 5;

export type CompactionResultWithQualityWarnings = CompactionResult & {
  readonly qualityWarnings: readonly string[];
};

export type CompletedCompactionResult = CompactionResultWithQualityWarnings & {
  readonly contextPack: CompactionContextPack;
};

export function assembleCompactionResult(
  ctx: CompactionPipelineContext,
  input: {
    readonly summary: string;
    readonly contextSummary: string;
    readonly compactedCount: number;
    readonly tokensBefore: number;
    readonly tokensAfter: number;
    readonly plan: CompactionPlan;
    readonly quality: CompactionQualityResult;
    readonly summaryTokens: number;
    readonly retainedTokens: number;
    readonly retainedCount: number;
    readonly parallelBlockCount: number;
    readonly mergeInputTokens: number | undefined;
    readonly repairAttempted: boolean;
    readonly usedEmergencyBackstop: boolean;
    readonly source: CompactionBeginData['source'];
    readonly provider: ChatProvider;
  },
): CompletedCompactionResult {
  const compactionActions = buildEmergencyBackstopActions(
    input.plan.actions,
    input.compactedCount,
    input.usedEmergencyBackstop,
  );
  const backstopWarnings = emergencyBackstopWarnings(input.usedEmergencyBackstop);

  const resultWithoutContextPack: CompactionResultWithQualityWarnings = {
    summary: input.summary,
    contextSummary: input.contextSummary,
    compactedCount: input.compactedCount,
    tokensBefore: input.tokensBefore,
    tokensAfter: input.tokensAfter,
    algorithmVersion: input.plan.algorithmVersion,
    actions: compactionActions,
    rawRefs: input.plan.rawRefs,
    summaryTokens: input.summaryTokens,
    retainedTokens: input.retainedTokens,
    compactedTokens: input.plan.compactedTokens,
    qualityWarnings: mergeQualityWarningLists(
      input.plan.qualityWarnings,
      input.quality.warnings,
      backstopWarnings,
    ),
    qualityWarningCategories:
      input.quality.warningCategories.length > 0
        ? input.quality.warningCategories
        : undefined,
    parallelBlockCount:
      input.parallelBlockCount > 0 ? input.parallelBlockCount : undefined,
    mergeInputTokens: input.mergeInputTokens,
    repairAttempted: input.repairAttempted ? true : undefined,
  };
  const shouldIncludeQualitySignals = shouldIncludeCompactionQualitySignals({
    warningCategories: input.quality.warningCategories,
    failureSignature: input.quality.signals?.failureSignature,
  });
  return {
    ...resultWithoutContextPack,
    contextPack: buildContextPack(
      ctx,
      input.source,
      resultWithoutContextPack,
      input.retainedCount,
      input.provider,
      shouldIncludeQualitySignals ? input.quality.signals : undefined,
    ),
  };
}

function buildContextPack(
  ctx: CompactionPipelineContext,
  source: CompactionSource,
  result: CompactionResult,
  retainedMessageCount: number,
  provider: ChatProvider,
  qualitySignals?: CompactionQualitySignals,
): CompactionContextPack {
  const rawRefs = result.rawRefs ?? [];
  const actions = result.actions ?? [];
  const qualityWarnings = result.qualityWarnings ?? [];
  return {
    version: 'context_pack_v1',
    source,
    algorithmVersion: result.algorithmVersion,
    messageCounts: {
      summary: 1,
      compacted: result.compactedCount,
      retained: retainedMessageCount,
    },
    tokenBudget: {
      before: result.tokensBefore,
      after: result.tokensAfter,
      summary: result.summaryTokens ?? 0,
      retained: result.retainedTokens ?? 0,
      compacted: result.compactedTokens ?? 0,
    },
    evidence: {
      rawRefCount: rawRefs.length,
      rawRefKinds: uniqueSorted(rawRefs.map((ref) => ref.kind)),
      actionTypes: uniqueSorted(actions.map((action) => action.type)),
      qualityWarningCount: qualityWarnings.length,
    },
    controls: {
      parallelBlockCount: result.parallelBlockCount ?? 0,
      mergeInputTokens: result.mergeInputTokens ?? 0,
      repairAttempted: result.repairAttempted === true,
      providerContextManagement: formatContextManagementCapability(provider),
    },
    contextOS: buildContextOS(ctx, result, qualitySignals),
  };
}

function buildContextOS(
  ctx: CompactionPipelineContext,
  result: CompactionResult,
  qualitySignals?: CompactionQualitySignals,
): CompactionContextOS {
  const memory = parseStructuredCompactionMemory(result.summary);
  const rawRefs = result.rawRefs ?? [];
  const rawRefKinds = uniqueSorted(rawRefs.map((ref) => ref.kind));
  const actionTypes = uniqueSorted((result.actions ?? []).map((action) => action.type));
  const fileHints = uniqueSorted([
    ...memory.filesTouched.flatMap(extractFileHints),
    ...ctx.extractedFacts
      .filter((fact) => fact.category === 'file')
      .map((fact) => fact.subject),
  ]).slice(0, 12);
  const retrievalQueries = uniqueHints([
    memory.currentGoal,
    ...memory.nextActions,
    ...fileHints.map((file) => `file:${file}`),
    ...memory.openQuestions,
    ...memory.failedAttempts,
    ...memory.decisions,
  ]).slice(0, 8);
  const continuity = evaluateContinuity(result, memory, retrievalQueries, qualitySignals);

  return {
    version: 'context_os_v0',
    memoryTiers: inferMemoryTiers(memory, rawRefKinds, actionTypes, fileHints),
    retrievalQueries,
    fileHints,
    rehydrationRawRefKinds: selectRehydrationRawRefKinds(
      rawRefKinds,
      continuity.status,
    ),
    qualitySignals,
    retrievalSignalCounts:
      qualitySignals === undefined
        ? undefined
        : {
            retrievalQueryCount: retrievalQueries.length,
            fileHintCount: fileHints.length,
            structuredItemCount: countStructuredMemoryItems(memory),
            rawRefKindCount: rawRefKinds.length,
          },
    continuity,
  };
}

export async function persistCompactionRecall(
  ctx: CompactionPipelineContext,
  result: CompletedCompactionResult,
): Promise<number> {
  const memory = ctx.agent.memory;
  if (memory === undefined || !memory.isEnabled()) return 0;
  const inputs = createCompactionRecallMemories(result);
  if (inputs.length === 0) return 0;

  let saved = 0;
  for (const input of inputs) {
    try {
      await memory.remember(input);
      saved += 1;
    } catch (error) {
      ctx.agent.log.warn('liora recall compaction memory save failed', error);
      ctx.agent.telemetry.track('liora_recall_compaction_memory_save_failed', {
        memory_kind: input.kind,
        memory_scope: input.scope,
        subject: input.subject,
      });
    }
  }
  if (saved > 0) {
    ctx.agent.telemetry.track('liora_recall_compaction_memory_saved', {
      saved_count: saved,
      requested_count: inputs.length,
      recall_eval_score: result.contextPack.contextOS.qualitySignals?.recallEvalScore,
      evidence_id_recall_score: result.contextPack.contextOS.qualitySignals?.evidenceIdRecallScore,
      critical_fact_count: result.contextPack.contextOS.qualitySignals?.criticalFactCount,
    });
  }
  return saved;
}

/**
 * Archive compacted tool-exchange groups so the model can recover their
 * original content via `liora-expand` after compaction. Returns rawRefs with
 * the resolved archive ids plus a short guidance section for the summary.
 *
 * Only tool_exchange groups are archived: they carry the command/output
 * detail the model most often needs to re-check. Plain user or assistant
 * text is summarized in place and is not worth the archive cost.
 *
 * Skipped during record replay (`records.restoring`) — on resume the archive
 * store is already populated, so re-archiving would both duplicate work and
 * write into the records stream while it is being replayed.
 */
export function archiveCompactedToolExchanges(
  ctx: CompactionPipelineContext,
  messages: readonly Message[],
  plan: CompactionPlan,
): { rawRefs: readonly CompactionResultRawRef[]; guidance: string } {
  if (ctx.agent.records.restoring !== null) {
    return { rawRefs: plan.rawRefs, guidance: '' };
  }
  const compactedToolGroups = groupMessages(messages).filter(
    (group) => group.kind === 'tool_exchange' && group.end < plan.compactedCount,
  );
  if (compactedToolGroups.length === 0) {
    return { rawRefs: plan.rawRefs, guidance: '' };
  }

  const store = ctx.agent.tools.getStore();
  const archiveIds: string[] = [];
  const refByStart = new Map(plan.rawRefs.map((ref) => [ref.messageStart, ref]));
  for (const group of compactedToolGroups) {
    const rendered = renderMessagesToText(group.messages);
    if (rendered.trim().length === 0) continue;
    const labelParts = [
      'compaction',
      ...(group.toolNames.length > 0 ? [group.toolNames.join(',')] : []),
    ];
    const archived = archiveContent({
      store,
      content: rendered,
      label: labelParts.join(':'),
    });
    archiveIds.push(archived.id);
    const existing = refByStart.get(group.start);
    if (existing !== undefined) {
      refByStart.set(group.start, { ...existing, archiveId: archived.id });
    } else {
      refByStart.set(group.start, {
        kind: group.kind,
        messageStart: group.start,
        messageEnd: group.end,
        tokens: group.tokens,
        toolCallIds: group.toolCallIds,
        toolNames: group.toolNames,
        archiveId: archived.id,
      });
    }
  }

  const rawRefs = plan.rawRefs.map((ref) => refByStart.get(ref.messageStart) ?? ref);
  let guidance = '';
  if (archiveIds.length > 0) {
    const inlineIds = archiveIds.slice(0, MAX_INLINE_ARCHIVE_IDS);
    let overflowNote = '';
    if (archiveIds.length > inlineIds.length) {
      const sidecar = persistArchiveIdSidecar(ctx, archiveIds);
      overflowNote =
        sidecar !== undefined
          ? ` Full list of ${String(archiveIds.length)} ids: ${sidecar}.`
          : ` total=${String(archiveIds.length)}.`;
    }
    guidance =
      `\n\n<compaction-archives>Tool exchanges compacted above were archived. ` +
      `Use LioraExpand(id=...) to recover a group's original content when the summary is insufficient. ` +
      `archive_ids="${inlineIds.join(',')}"${overflowNote}</compaction-archives>`;
  }
  return { rawRefs, guidance };
}

function persistArchiveIdSidecar(
  ctx: CompactionPipelineContext,
  archiveIds: readonly string[],
): string | undefined {
  const homedir = ctx.agent.homedir;
  if (homedir === undefined) return undefined;
  return persistCompactionSidecar(
    join(homedir, 'compaction'),
    'archive-ids',
    `${archiveIds.join('\n')}\n`,
  );
}

export function injectResumeRecheckReminder(
  ctx: CompactionPipelineContext,
  summary: string,
): void {
  const memory = parseStructuredCompactionMemory(summary);
  const needsRevalidation = memory.verifiedClaims.filter((claim) =>
    /needs_revalidation\s*[=:]\s*true/i.test(claim),
  );
  if (needsRevalidation.length === 0) return;
  const lines = [
    'Resume recheck (T1-5): the compacted summary carries verification claims flagged needs_revalidation.',
    'Re-run their cheap evidence (tests, typecheck, git status) before treating them as done:',
    ...needsRevalidation.slice(0, 8).map((claim) => `- ${claim}`),
  ];
  ctx.agent.context.appendSystemReminder(lines.join('\n'), {
    kind: 'injection',
    variant: 'compaction_resume_recheck',
  });
}
