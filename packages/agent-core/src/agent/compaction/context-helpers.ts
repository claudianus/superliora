/**
 * Pure context/memory helpers used by FullCompaction (Context OS + structured summaries).
 */

import type { Message } from '@superliora/kosong';
import type { MemoryCreateInput, MemoryKind, MemoryScope } from '../../memory';
import { surpriseScore } from '../../lean-context/gate/density';
import type { CompactionPlan } from './planner';
import type {
  CompactionContextMemoryTier,
  CompactionContextOS,
  CompactionQualitySignals,
  CompactionResult,
} from './types';
import {
  isPromptControlCompactionMemoryItem,
  isUsefulCompactionMemoryItem,
  parseStructuredCompactionMemory,
  type ExtractedFact,
} from './memory';

export function usefulRecallItems(items: readonly (string | undefined)[]): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    if (item === undefined) continue;
    const normalized = item.replaceAll(/\s+/g, ' ').trim();
    if (!isUsefulCompactionMemoryItem(normalized)) continue;
    if (isPromptControlCompactionMemoryItem(normalized)) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result.slice(0, 8);
}

export function formatRecallSections(
  sections: readonly [title: string, items: readonly string[]][],
): string {
  const lines: string[] = [];
  for (const [title, items] of sections) {
    if (items.length === 0) continue;
    lines.push(`## ${title}`);
    for (const item of items.slice(0, 8)) {
      lines.push(`- ${item}`);
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}

export function recallSubject(prefix: string, detail: string | undefined): string {
  if (detail === undefined) return prefix;
  const compact = detail.replaceAll(/[`*_#]/g, '').replaceAll(/\s+/g, ' ').trim();
  if (compact.length === 0) return prefix;
  return `${prefix}: ${compact.slice(0, 80)}`;
}

export function recallTags(
  base: readonly string[],
  optional: readonly (string | undefined)[],
): readonly string[] {
  return [...new Set([...base, ...optional.filter((tag): tag is string => tag !== undefined)])];
}

export function formatStringList(items: readonly string[]): string {
  if (items.length === 0) return '- None captured during compaction.';
  return items.slice(0, 12).map((item) => `- ${item}`).join('\n');
}

export function factsToDetails(facts: readonly ExtractedFact[]): readonly string[] {
  return facts.map((fact) => fact.detail);
}

export function extractSwarmRunLines(summary: string): readonly string[] {
  const lines = summary.split('\n');
  const result: string[] = [];
  let inSection = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^swarm_runs:/i.test(trimmed)) {
      inSection = true;
      continue;
    }
    if (inSection && /^[a-z_]+:/i.test(trimmed) && !trimmed.startsWith('-')) break;
    if (!inSection) continue;
    const item = trimmed.replace(/^[-*]\s+/, '').trim();
    if (item.length > 0) result.push(item);
  }
  return result;
}

export function mergeStringLists(
  primary: readonly string[],
  fallback: readonly string[],
): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of [...primary, ...fallback]) {
    const normalized = item.trim();
    if (normalized.length === 0) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

export function extractNextActions(summary: string): readonly string[] {
  const lines = summary.split('\n');
  const result: string[] = [];
  let inNextSection = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^#{1,4}\s*(next steps?|todo|pending|active issues)/i.test(trimmed)) {
      inNextSection = true;
      continue;
    }
    if (inNextSection && /^#{1,4}\s+/.test(trimmed)) break;
    if (!inNextSection) continue;
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      result.push(trimmed.slice(2));
    }
  }
  return result;
}

export function uniqueSorted(items: readonly string[]): readonly string[] {
  return [...new Set(items.filter((item) => item.length > 0))].toSorted();
}

export function uniqueHints(items: readonly (string | undefined)[]): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    if (item === undefined) continue;
    const normalized = normalizeHint(item);
    if (normalized.length === 0) continue;
    if (!isUsefulHint(normalized)) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

export function normalizeHint(item: string): string {
  return item
    .replaceAll(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

export function isUsefulHint(item: string): boolean {
  const lower = item.toLowerCase();
  if (lower === 'none captured during compaction.') return false;
  if (/^#{1,6}\s+/.test(item)) return false;
  if (/^\*\*(?:file|decision|error|state|config|dependency|api)\*\*:\s*$/i.test(item)) {
    return false;
  }
  return true;
}

export function extractFileHints(item: string): readonly string[] {
  const matches = item.matchAll(
    /`([^`]+\.(?:ts|js|tsx|jsx|py|rs|go|java|kt|swift|md|json|yaml|yml|toml|html|css|scss|sql))`|([A-Za-z0-9_./-]+\.(?:ts|js|tsx|jsx|py|rs|go|java|kt|swift|md|json|yaml|yml|toml|html|css|scss|sql))/gi,
  );
  const files: string[] = [];
  for (const match of matches) {
    files.push((match[1] ?? match[2] ?? '').trim());
  }
  return uniqueSorted(files);
}

export function inferMemoryTiers(
  memory: ReturnType<typeof parseStructuredCompactionMemory>,
  rawRefKinds: readonly string[],
  actionTypes: readonly string[],
  fileHints: readonly string[],
): readonly CompactionContextMemoryTier[] {
  const tiers = new Set<CompactionContextMemoryTier>(['working']);
  if (rawRefKinds.length > 0) tiers.add('episodic');
  if (
    memory.currentGoal !== undefined ||
    memory.decisions.length > 0 ||
    memory.openQuestions.length > 0 ||
    fileHints.length > 0
  ) {
    tiers.add('semantic');
  }
  if (
    memory.nextActions.length > 0 ||
    memory.failedAttempts.length > 0 ||
    actionTypes.length > 0
  ) {
    tiers.add('procedural');
  }
  return Array.from(tiers);
}

export function countStructuredMemoryItems(
  memory: ReturnType<typeof parseStructuredCompactionMemory>,
): number {
  return [
    memory.currentGoal,
    ...memory.lastKnownState,
    ...memory.decisions,
    ...memory.filesTouched,
    ...memory.failedAttempts,
    ...memory.openQuestions,
    ...memory.nextActions,
    ...memory.rawRefs,
  ]
    .filter((item): item is string => item !== undefined)
    .filter(isUsefulCompactionMemoryItem).length;
}

export function evaluateContinuity(
  result: CompactionResult,
  memory: ReturnType<typeof parseStructuredCompactionMemory>,
  retrievalQueries: readonly string[],
  qualitySignals?: CompactionQualitySignals,
): CompactionContextOS['continuity'] {
  let score = 1;
  const reasons: string[] = [];

  if (memory.currentGoal === undefined) {
    score -= 0.2;
    reasons.push('missing_current_goal');
  }
  if (uniqueHints(memory.nextActions).length === 0) {
    score -= 0.2;
    reasons.push('missing_next_actions');
  }
  if ((result.rawRefs?.length ?? 0) === 0 || memory.rawRefs.length === 0) {
    score -= 0.15;
    reasons.push('missing_raw_refs');
  }
  if ((result.qualityWarnings?.length ?? 0) > 0) {
    score -= 0.15;
    reasons.push('quality_warnings_present');
  }
  // Durable identifier preservation (evidence/node/archive) is a continuity signal.
  // Weight matches next_actions so missing IDs alone drop below the ready threshold.
  if (
    qualitySignals !== undefined &&
    qualitySignals.evidenceIdRecallScore < 1
  ) {
    score -= 0.2;
    reasons.push('missing_evidence_ids');
  }
  if (result.repairAttempted === true) {
    score -= 0.1;
    reasons.push('summary_repaired');
  }
  if (retrievalQueries.length === 0) {
    score -= 0.1;
    reasons.push('empty_retrieval_queries');
  }

  const boundedScore = Math.max(0, Math.min(1, Number(score.toFixed(2))));
  return {
    status: boundedScore >= 0.85 ? 'ready' : boundedScore >= 0.55 ? 'needs_rehydration' : 'at_risk',
    score: boundedScore,
    reasons: reasons.length > 0 ? reasons : ['core_continuity_signals_present'],
  };
}

export function selectRehydrationRawRefKinds(
  rawRefKinds: readonly string[],
  status: CompactionContextOS['continuity']['status'],
): readonly string[] {
  if (status !== 'ready') return rawRefKinds;
  return rawRefKinds.filter((kind) => kind.includes('tool'));
}

export function formatRawRef(ref: CompactionPlan['rawRefs'][number]): string {
  const tools =
    ref.toolNames !== undefined && ref.toolNames.length > 0
      ? ` tools=${ref.toolNames.join(',')}`
      : '';
  return `${ref.kind}[${String(ref.messageStart)}-${String(ref.messageEnd)}] tokens=${String(ref.tokens)}${tools}`;
}

/**
 * Density / surprise score for a parallel-compaction block. Used to order
 * blocks so information-dense regions are summarized first and get priority
 * in the merged summary.
 */
export function blockDensity(block: readonly Message[]): number {
  const parts: string[] = [];
  for (const message of block) {
    if (typeof message.content === 'string') {
      parts.push(message.content);
    } else if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part.type === 'text') parts.push(part.text);
      }
    }
    for (const toolCall of message.toolCalls) {
      parts.push(`${toolCall.name} ${toolCall.arguments}`);
    }
  }
  return surpriseScore(parts.join('\n').slice(0, 16_000));
}

export type CompactionRecallSource = {
  readonly summary: string;
  readonly algorithmVersion?: string;
  readonly contextPack: {
    readonly contextOS: {
      readonly continuity: { readonly status: string };
      readonly qualitySignals?: {
        readonly criticalFactCount?: number;
        readonly recallEvalScore?: number;
      };
    };
  };
};

export function createCompactionRecallMemories(result: CompactionRecallSource): readonly MemoryCreateInput[] {
  const memory = parseStructuredCompactionMemory(result.summary);
  const currentGoal = usefulRecallItems([memory.currentGoal]).at(0);
  const decisions = usefulRecallItems(memory.decisions);
  const filesTouched = usefulRecallItems(memory.filesTouched);
  const failedAttempts = usefulRecallItems(memory.failedAttempts);
  const nextActions = usefulRecallItems(memory.nextActions);
  const records: MemoryCreateInput[] = [];

  const workspaceSections = formatRecallSections([
    ['Current goal', currentGoal === undefined ? [] : [currentGoal]],
    ['Decisions', decisions],
    ['Files touched', filesTouched],
    ['Failed attempts', failedAttempts],
  ]);
  if (workspaceSections.length > 0) {
    records.push({
      kind: 'semantic' satisfies MemoryKind,
      scope: 'workspace' satisfies MemoryScope,
      subject: recallSubject('Compaction working memory', currentGoal ?? decisions[0] ?? filesTouched[0]),
      content: workspaceSections,
      tags: recallTags(['compaction', 'context-os', 'workspace'], [
        decisions.length > 0 ? 'decision' : undefined,
        filesTouched.length > 0 ? 'file' : undefined,
        failedAttempts.length > 0 ? 'failure' : undefined,
      ]),
      confidence: 0.82,
      importance: result.contextPack.contextOS.qualitySignals?.criticalFactCount
        ? 0.82
        : 0.68,
      source: { kind: 'auto', excerpt: 'compaction structured working memory' },
      metadata: {
        source: 'compaction',
        algorithmVersion: result.algorithmVersion,
        recallEvalScore: result.contextPack.contextOS.qualitySignals?.recallEvalScore,
        contextOSStatus: result.contextPack.contextOS.continuity.status,
      },
    });
  }

  const prospectiveSections = formatRecallSections([
    ['Current goal', currentGoal === undefined ? [] : [currentGoal]],
    ['Next actions', nextActions],
  ]);
  if (nextActions.length > 0 && prospectiveSections.length > 0) {
    records.push({
      kind: 'prospective' satisfies MemoryKind,
      scope: 'session' satisfies MemoryScope,
      subject: recallSubject('Compaction next actions', currentGoal ?? nextActions[0]),
      content: prospectiveSections,
      tags: recallTags(['compaction', 'next-actions', 'session'], []),
      confidence: 0.86,
      importance: 0.84,
      source: { kind: 'auto', excerpt: 'compaction next actions' },
      metadata: {
        source: 'compaction',
        algorithmVersion: result.algorithmVersion,
        recallEvalScore: result.contextPack.contextOS.qualitySignals?.recallEvalScore,
        contextOSStatus: result.contextPack.contextOS.continuity.status,
      },
    });
  }

  return records;
}

