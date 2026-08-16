import { renderTodoList, type TodoItem } from '../../../tools/builtin/state/todo-list';
import { estimateTokens } from '../../../utils/tokens';
import { extractAnchorDiff, mergeIntoAnchor, renderAnchor } from '../full/anchor';
import {
  extractNextActions,
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
import type { CompactionPipelineContext } from './types';

export function enrichCompactionSummary(
  ctx: CompactionPipelineContext,
  input: {
    readonly summary: string;
    readonly plan: CompactionPlan;
  },
): string {
  let summary = postProcessSummary(ctx, input.summary);
  summary = appendExtractedFactsAndAnchor(ctx, summary);
  return renderStructuredV2Summary(ctx, summary, input.plan);
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

  const openQuestions = structuredMemory.openQuestions;
  return [
    '# SuperLiora Context Compaction v2 Memory',
    '',
    '## Resume Preflight',
    // OpenCode-style Objective / Work State / Next Move / Relevant Files at a glance.
    `- Objective (current_goal): ${currentGoal}`,
    `- Work State: ${lastKnownState[0] ?? 'Use retained recent messages plus structured memory below.'}`,
    `- Next Move: ${nextActions[0] ?? 'Inspect the retained recent context, then continue the pending implementation or verification step.'}`,
    `- Relevant Files: ${fileItems[0] ?? 'See files_touched below (or re-discover from the latest user ask).'}`,
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
    formatStringList(openQuestions),
    'next_actions:',
    formatStringList(nextActions),
    ...(structuredMemory.verifiedClaims.length > 0
      ? ['verified_claims:', formatStringList(structuredMemory.verifiedClaims)]
      : []),
    'raw_refs:',
    formatStringList(rawRefItems),
    '',
    '## Compacted Narrative',
    stripEmergencyExtractiveDump(summary.trim()),
  ].join('\n');
}

/** Fail-open backstop must never re-inject a full extractive transcript. */
function stripEmergencyExtractiveDump(summary: string): string {
  const marker = '## Emergency extractive transcript';
  const idx = summary.indexOf(marker);
  if (idx < 0) return summary;
  return summary.slice(0, idx).trimEnd();
}
