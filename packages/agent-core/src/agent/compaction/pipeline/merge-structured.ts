/**
 * Deterministic merge of already-structured block summaries.
 *
 * When every parallel block already used v2 labels, a second LLM merge call is
 * mostly list-concatenation. Doing it here saves one full model RTT without
 * dropping required handoff fields.
 */

import {
  isUsefulCompactionMemoryItem,
  parseStructuredCompactionMemory,
  type StructuredCompactionMemory,
} from '../memory';
import { hasExactV2Attempt } from '../plan/quality-helpers';

const MAX_ITEMS_PER_SECTION = 24;

/**
 * Returns a merged structured summary, or `undefined` when any block is not
 * structured enough to merge deterministically (caller should LLM-merge).
 */
export function tryMergeStructuredBlockSummaries(
  blockSummaries: readonly string[],
): string | undefined {
  if (blockSummaries.length === 0) return undefined;
  if (blockSummaries.length === 1) {
    const only = blockSummaries[0]?.trim() ?? '';
    return only.length > 0 && hasExactV2Attempt(only) ? only : undefined;
  }
  if (!blockSummaries.every((s) => hasExactV2Attempt(s.trim()))) {
    return undefined;
  }

  const memories = blockSummaries.map((s) => parseStructuredCompactionMemory(s));
  // Prefer the last block's goal (most recent conversation slice) when present.
  // Parser only fills currentGoal for inline `current_goal: text`; bullet form
  // is recovered via extractGoalFromBlock.
  let currentGoal: string | undefined;
  for (let i = blockSummaries.length - 1; i >= 0; i--) {
    const g = extractGoalFromBlock(blockSummaries[i] ?? '', memories[i]);
    if (g !== undefined) {
      currentGoal = g;
      break;
    }
  }
  if (currentGoal === undefined || currentGoal.length === 0) {
    return undefined;
  }

  const merged: StructuredCompactionMemory = {
    currentGoal,
    lastKnownState: mergeLists(memories.map((m) => m.lastKnownState)),
    decisions: mergeLists(memories.map((m) => m.decisions)),
    filesTouched: mergeLists(memories.map((m) => m.filesTouched)),
    failedAttempts: mergeLists(memories.map((m) => m.failedAttempts)),
    openQuestions: mergeLists(memories.map((m) => m.openQuestions)),
    nextActions: mergeLists(memories.map((m) => m.nextActions)),
    verifiedClaims: mergeLists(memories.map((m) => m.verifiedClaims)),
    rawRefs: mergeLists(memories.map((m) => m.rawRefs)),
    swarmRuns: mergeLists(memories.map((m) => m.swarmRuns)),
    ultraworkRuns: mergeLists(memories.map((m) => m.ultraworkRuns)),
  };

  if (merged.nextActions.length === 0) {
    return undefined;
  }

  return renderMergedStructuredSummary(merged, blockSummaries.length);
}

function extractGoalFromBlock(
  summary: string,
  memory: StructuredCompactionMemory | undefined,
): string | undefined {
  const inline = memory?.currentGoal?.trim();
  if (inline !== undefined && inline.length > 0) return inline;
  // Bullet form:
  // current_goal:
  // - do the thing
  const match = /(?:^|\n)\s*current_goal:\s*\n\s*-\s*(.+)/iu.exec(summary);
  const bullet = match?.[1]?.replaceAll(/\s+/g, ' ').trim();
  return bullet !== undefined && bullet.length > 0 ? bullet : undefined;
}

function mergeLists(lists: readonly (readonly string[])[]): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const item of list) {
      if (!isUsefulCompactionMemoryItem(item)) continue;
      const key = item.replaceAll(/\s+/g, ' ').trim().toLowerCase();
      if (key.length === 0 || seen.has(key)) continue;
      seen.add(key);
      out.push(item.replaceAll(/\s+/g, ' ').trim());
      if (out.length >= MAX_ITEMS_PER_SECTION) return out;
    }
  }
  return out;
}

function renderMergedStructuredSummary(
  memory: StructuredCompactionMemory,
  blockCount: number,
): string {
  const lines = [
    'current_goal:',
    `- ${memory.currentGoal ?? 'Continue the active user task.'}`,
    'last_known_state:',
    ...bulletSection(memory.lastKnownState, `Merged from ${String(blockCount)} structured block summaries.`),
    'decisions:',
    ...bulletSection(memory.decisions),
    'files_touched:',
    ...bulletSection(memory.filesTouched),
    'failed_attempts:',
    ...bulletSection(memory.failedAttempts),
    'open_questions:',
    ...bulletSection(memory.openQuestions),
    'next_actions:',
    ...bulletSection(memory.nextActions),
    'verified_claims:',
    ...bulletSection(memory.verifiedClaims),
    'raw_refs:',
    ...bulletSection(memory.rawRefs),
  ];
  if (memory.swarmRuns.length > 0) {
    lines.push('swarm_runs:', ...bulletSection(memory.swarmRuns));
  }
  if (memory.ultraworkRuns.length > 0) {
    lines.push('ultrawork_runs:', ...bulletSection(memory.ultraworkRuns));
  }
  return lines.join('\n');
}

function bulletSection(items: readonly string[], fallback?: string): string[] {
  if (items.length === 0) {
    return [`- ${fallback ?? 'none'}`];
  }
  return items.map((item) => `- ${item}`);
}
