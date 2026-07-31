import type { Message } from '@superliora/kosong';

import {
  buildUltraworkCompactionEnvelope,
  captureUltraworkEnvelopeSnapshot,
  extractUltraworkRunLines,
  renderUltraworkRunsMemorySection,
} from '#/mission';
import { renderTodoList, type TodoItem } from '../../../tools/builtin/state/todo-list';
import { estimateTokens } from '../../../utils/tokens';
import { extractAnchorDiff, mergeIntoAnchor, renderAnchor } from '../full/anchor';
import {
  extractNextActions,
  extractSwarmRunLines,
  factsToDetails,
  formatRawRef,
  formatStringList,
  mergeStringLists,
  uniqueHints,
} from '../plan/context-helpers';
import {
  extractFactsFromSummary,
  formatFactsAsMemoryBlock,
  mergeFactSets,
  parseStructuredCompactionMemory,
} from '../memory';
import type { CompactionPlan } from '../plan/planner';
import {
  extractSwarmRunsFromMessages,
  renderSwarmRunsMemorySection,
} from '../memory/swarm-memory-extract';
import type { CompactionPipelineContext } from './types';

export function enrichCompactionSummary(
  ctx: CompactionPipelineContext,
  input: {
    readonly summary: string;
    readonly messagesToCompact: readonly Message[];
    readonly plan: CompactionPlan;
  },
): {
  summary: string;
  ultraworkSnapshot: ReturnType<typeof captureUltraworkEnvelopeSnapshot>;
} {
  let summary = postProcessSummary(ctx, input.summary);
  summary = appendExtractedFactsAndAnchor(ctx, summary);
  summary = appendSwarmRunsSection(ctx, summary, input.messagesToCompact);
  const { summary: withUltrawork, ultraworkSnapshot } =
    appendUltraworkCompactionSections(ctx, summary);
  summary = renderStructuredV2Summary(ctx, withUltrawork, input.plan);
  return { summary, ultraworkSnapshot };
}

function appendExtractedFactsAndAnchor(ctx: CompactionPipelineContext, summary: string): string {
  const newFacts = extractFactsFromSummary(summary);
  ctx.extractedFacts = Array.from(mergeFactSets(ctx.extractedFacts, newFacts));
  const memoryBlock = formatFactsAsMemoryBlock(ctx.extractedFacts);
  let next = summary;
  if (memoryBlock.length > 0) {
    next = `${next.trim()}\n\n${memoryBlock}`;
  }
  if (ctx.anchor !== null) {
    const diff = extractAnchorDiff(next);
    ctx.anchor = mergeIntoAnchor(ctx.anchor, diff);
    const anchorText = renderAnchor(ctx.anchor);
    if (anchorText.length > 0) {
      next = `${anchorText}\n\n---\n\n${next.trim()}`;
    }
  }
  return next;
}

function appendSwarmRunsSection(
  _ctx: CompactionPipelineContext,
  summary: string,
  messagesToCompact: readonly Message[],
): string {
  const swarmSection = renderSwarmRunsMemorySection(
    extractSwarmRunsFromMessages(messagesToCompact),
  );
  if (swarmSection.length === 0) return summary;
  return `${summary.trim()}\n\n${swarmSection}`;
}

function appendUltraworkCompactionSections(
  ctx: CompactionPipelineContext,
  summary: string,
): {
  summary: string;
  ultraworkSnapshot: ReturnType<typeof captureUltraworkEnvelopeSnapshot>;
} {
  const ultraworkSnapshot = captureUltraworkEnvelopeSnapshot(ctx.agent, {
    compactionBoundary: true,
  });
  const ultraworkEnvelope =
    ultraworkSnapshot === undefined
      ? undefined
      : buildUltraworkCompactionEnvelope(ctx.agent, { compactionBoundary: true });
  if (ultraworkEnvelope === undefined) {
    return { summary, ultraworkSnapshot };
  }
  let next = `${summary.trim()}\n\n${ultraworkEnvelope}`;
  const ultraworkRunsSection = renderUltraworkRunsMemorySection(ultraworkSnapshot!);
  if (ultraworkRunsSection.length > 0) {
    next = `${next.trim()}\n\n${ultraworkRunsSection}`;
  }
  ctx.agent.telemetry.track('compaction.ultrawork_checkpoint', {
    run_id: ultraworkSnapshot!.run.id,
    stage: ultraworkSnapshot!.run.stage,
    effective_stage: ultraworkSnapshot!.effectiveStage ?? ultraworkSnapshot!.run.stage,
    pending_nodes: String(
      ultraworkSnapshot!.run.workGraph?.nodes.filter((node) => node.status !== 'done')
        .length ?? 0,
    ),
    deferred_reason: ctx.agent.ultraSwarmRun !== undefined ? 'ultra_swarm_active' : 'none',
    envelope_token_estimate: String(estimateTokens(ultraworkEnvelope)),
  });
  return { summary: next, ultraworkSnapshot };
}

export function postProcessSummary(ctx: CompactionPipelineContext, summary: string): string {
  const storeData = ctx.agent.tools.storeData();
  const todos = (storeData['todo'] as readonly TodoItem[] | undefined) ?? [];
  if (todos.length === 0) {
    return summary;
  }
  const todoMarkdown = renderTodoList(todos, '## TODO List');
  return `${summary.trim()}\n\n${todoMarkdown}`;
}

export function renderStructuredV2Summary(
  ctx: CompactionPipelineContext,
  summary: string,
  plan: CompactionPlan,
): string {
  const structuredMemory = parseStructuredCompactionMemory(summary);
  const filesTouched = ctx.extractedFacts.filter((fact) => fact.category === 'file');
  const decisions = ctx.extractedFacts.filter((fact) => fact.category === 'decision');
  const failures = ctx.extractedFacts.filter((fact) => fact.category === 'error');
  const nextActions = mergeStringLists(structuredMemory.nextActions, extractNextActions(summary));
  const currentGoal = structuredMemory.currentGoal ?? 'Continue the active user task from the compacted state.';
  const lastKnownState = mergeStringLists(structuredMemory.lastKnownState, [
    `${String(plan.compactedCount)} old messages were compacted; ${String(plan.retainedTokens)} estimated tokens remain in the recent live context.`,
  ]);
  const decisionItems = mergeStringLists(structuredMemory.decisions, factsToDetails(decisions));
  const fileItems = mergeStringLists(structuredMemory.filesTouched, factsToDetails(filesTouched));
  const failureItems = mergeStringLists(structuredMemory.failedAttempts, factsToDetails(failures));
  const rawRefItems = mergeStringLists(structuredMemory.rawRefs, plan.rawRefs.map(formatRawRef));
  const swarmRunItems = mergeStringLists(structuredMemory.swarmRuns, extractSwarmRunLines(summary));
  const ultraworkRunItems = mergeStringLists(
    structuredMemory.ultraworkRuns,
    extractUltraworkRunLines(summary),
  );

  return [
    '# SuperLiora Context Compaction v2 Memory',
    '',
    '## Resume Preflight',
    `- current_goal: ${currentGoal}`,
    '- last_known_state: Use the retained recent messages plus the structured memory below before taking the next action.',
    `- next_action: ${nextActions[0] ?? 'Inspect the retained recent context, then continue the pending implementation or verification step.'}`,
    '',
    '## Structured Working Memory',
    'current_goal:',
    `- ${currentGoal}`,
    'last_known_state:',
    formatStringList(lastKnownState),
    'decisions:',
    formatStringList(decisionItems),
    'files_touched:',
    formatStringList(fileItems),
    'failed_attempts:',
    formatStringList(failureItems),
    'open_questions:',
    formatStringList(structuredMemory.openQuestions),
    'next_actions:',
    formatStringList(nextActions),
    ...(structuredMemory.verifiedClaims.length > 0
      ? ['verified_claims:', formatStringList(structuredMemory.verifiedClaims)]
      : []),
    'raw_refs:',
    formatStringList(rawRefItems),
    'swarm_runs:',
    formatStringList(swarmRunItems),
    'ultrawork_runs:',
    formatStringList(ultraworkRunItems),
    '',
    '## Compacted Narrative',
    summary.trim(),
  ].join('\n');
}
