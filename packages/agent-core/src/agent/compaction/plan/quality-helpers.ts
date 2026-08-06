import { extractText, type Message } from '@superliora/kosong';

import {
  extractSwarmRunsFromMessages,
  extractSwarmRunsFromText,
} from '../memory/swarm-memory-extract';
import { persistCompactionSidecar } from '../memory/sidecar';
import type { CompactionQualityWarningCategory } from '../types';
import type { CompactionQualitySignals } from '../types';
import {
  isPromptControlCompactionMemoryItem,
  isUsefulCompactionMemoryItem,
  parseStructuredCompactionMemory,
} from '../memory';
import { isRealUserPromptOrigin, type ContextMessage } from '../../context/types';

export const V2_REQUIRED_LABELS = [
  'current_goal',
  'last_known_state',
  'decisions',
  'files_touched',
  'failed_attempts',
  'open_questions',
  'next_actions',
  'raw_refs',
] as const;

export const TINY_HISTORY_TOKEN_THRESHOLD = 512;

export function computeSwarmRecallScore(
  expectedRuns: ReturnType<typeof extractSwarmRunsFromMessages>,
  summary: string,
  structuredSwarmRuns: readonly string[],
): number {
  const summaryRuns = extractSwarmRunsFromText(summary);
  const structuredText = structuredSwarmRuns.join('\n');
  let matched = 0;
  let total = 0;
  for (const run of expectedRuns) {
    total += 1;
    const runPresent =
      summary.includes(run.runId) ||
      structuredText.includes(run.runId) ||
      summaryRuns.some((entry) => entry.runId === run.runId);
    if (!runPresent) continue;
    matched += 1;
    for (const expert of run.experts) {
      total += 2;
      if (summary.includes(expert.expertId) || structuredText.includes(expert.expertId)) matched += 1;
      if (
        expert.verdict.length === 0 ||
        summary.includes(expert.verdict) ||
        structuredText.includes(expert.verdict)
      ) {
        matched += 1;
      }
    }
  }
  return total === 0 ? 1 : Number((matched / total).toFixed(2));
}

export function addSignalWarnings(
  warnings: string[],
  warningCategories: CompactionQualityWarningCategory[],
  signals: CompactionQualitySignals,
): void {
  if (signals.nextActionPreservationScore < 1) {
    warnings.push('summary did not preserve next_actions for unfinished compacted work');
    warningCategories.push('missing_next_actions');
  }
  if (signals.fileHintRecallScore < 1) {
    warnings.push('summary did not preserve all file hints from compacted work');
    warningCategories.push('missing_file_hints');
  }
  if (signals.failedAttemptRecallScore < 1) {
    warnings.push('summary did not preserve failed_attempts for compacted errors');
    warningCategories.push('missing_failed_attempts');
  }
  if (signals.evidenceIdRecallScore < 1) {
    warnings.push('summary did not preserve durable evidence/node/archive identifiers from compacted work');
    warningCategories.push('missing_evidence_ids');
  }
  if (signals.placeholderItemCount > 0 && signals.criticalFactCount === 0) {
    warnings.push('summary structured memory contains placeholders only');
    warningCategories.push('placeholder_only_memory');
  }
  if (signals.promptInjectionResistanceScore < 1) {
    warnings.push('summary kept prompt-control text in recalled structured memory');
    warningCategories.push('prompt_control_recalled');
  }
  if (signals.failureSignature?.split(',').includes('token_growth') === true) {
    warnings.push('summary did not reduce token count');
    warningCategories.push('token_growth');
  }
}

export function hasExactV2Attempt(summary: string): boolean {
  return V2_REQUIRED_LABELS.some((label) =>
    new RegExp(`(^|\\n)\\s*(?:#{1,6}\\s*)?${label}\\s*:`, 'i').test(summary)
  );
}

export function latestUserText(messages: readonly Message[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (
      message?.role !== 'user' ||
      !isRealUserPromptOrigin((message as ContextMessage).origin)
    ) {
      continue;
    }
    const text = extractText(message, ' ').replaceAll(/\s+/g, ' ').trim();
    if (text.length > 0) return text;
  }
  return undefined;
}

export function sharesMeaningfulToken(summary: string, source: string): boolean {
  const summaryLower = summary.toLowerCase();
  for (const token of source.toLowerCase().match(/[a-z0-9_./-]{4,}/g) ?? []) {
    if (token.length < 4) continue;
    if (summaryLower.includes(token)) return true;
  }
  return false;
}

export function containsRiskyBarePath(summary: string): boolean {
  const withoutInlineCode = summary.replaceAll(/`[^`]*`/g, '');
  return /(?:^|\s)(?:\.{1,2}\/|\/|[A-Za-z]:\\)[^\s]+\.(?:ts|js|tsx|jsx|py|rs|go|java|kt|swift|md|json|ya?ml|toml|html|css|scss|sql)(?:\s|$)/i.test(
    withoutInlineCode,
  );
}

export function uniqueList(items: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const normalized = item.trim();
    if (normalized.length === 0) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

export function uniqueCategories(
  items: readonly CompactionQualityWarningCategory[],
): readonly CompactionQualityWarningCategory[] {
  return [...new Set(items)];
}

export function usefulItems(items: readonly string[] | undefined | null): readonly string[] {
  if (items === undefined || items === null) return [];
  return items.filter(isUsefulCompactionMemoryItem);
}

export function extractFileHintsFromText(text: string): readonly string[] {
  const matches = text.matchAll(
    /`([^`]+\.(?:ts|js|tsx|jsx|py|rs|go|java|kt|swift|md|json|yaml|yml|toml|html|css|scss|sql))`|([A-Za-z0-9_./-]+\.(?:ts|js|tsx|jsx|py|rs|go|java|kt|swift|md|json|yaml|yml|toml|html|css|scss|sql))/gi,
  );
  const files: string[] = [];
  for (const match of matches) {
    files.push((match[1] ?? match[2] ?? '').trim());
  }
  return files;
}

/** Stable durable identifiers that must survive compaction when present in history. */
export function extractEvidenceIdsFromText(text: string): string[] {
  const ids = new Set<string>();
  // evidence_ids: a,b  OR evidence_id=x OR evidence_ids="a,b"
  const attr = /\bevidence[_-]?ids?\s*[=:]\s*["']?([A-Za-z0-9_.:/-]+(?:\s*,\s*[A-Za-z0-9_.:/-]+)*)/gi;
  let match: RegExpExecArray | null;
  while ((match = attr.exec(text)) !== null) {
    for (const raw of match[1]?.split(/[,\s]+/) ?? []) {
      const id = raw.trim();
      if (id.length >= 2) ids.add(id);
    }
  }
  // WorkGraph / Ultrawork node ids in common forms: node_id=..., work_node_ids=...
  const nodeAttr = /\b(?:work_?node_ids?|node_id|ac_id|acceptance_criterion_id)\s*[=:]\s*["']?([A-Za-z0-9_.:/-]+(?:\s*,\s*[A-Za-z0-9_.:/-]+)*)/gi;
  while ((match = nodeAttr.exec(text)) !== null) {
    for (const raw of match[1]?.split(/[,\s]+/) ?? []) {
      const id = raw.trim();
      if (id.length >= 2) ids.add(id);
    }
  }
  // liora-archived markers
  const archive = /\[liora-archived[^\]]*id=([a-f0-9]+)/gi;
  while ((match = archive.exec(text)) !== null) {
    if (match[1]) ids.add(match[1]);
  }
  return [...ids];
}

/**
 * Deterministically splice missing durable IDs into a compaction summary.
 * Prefer this over hard-failing auto-compaction when the LLM drops load-bearing
 * evidence/node/archive identifiers after repair attempts.
 */
const MAX_INLINE_EVIDENCE_IDS = 5;

export function injectMissingDurableEvidenceIds(
  summary: string,
  compactedMessages: readonly Message[],
  sidecarDir?: string,
): { summary: string; injectedIds: readonly string[] } {
  const sourceText = compactedMessages.map((message) => extractText(message, ' ')).join('\n');
  const expected = uniqueLower(extractEvidenceIdsFromText(sourceText));
  if (expected.length === 0) {
    return { summary, injectedIds: [] };
  }
  const present = new Set(uniqueLower(extractEvidenceIdsFromText(summary)));
  const missing = expected.filter((id) => !present.has(id));
  if (missing.length === 0) {
    return { summary, injectedIds: [] };
  }

  // Preserve original casing from the source when possible.
  const sourceIds = extractEvidenceIdsFromText(sourceText);
  const byLower = new Map(sourceIds.map((id) => [id.toLowerCase(), id] as const));
  const renderIds = missing.map((id) => byLower.get(id) ?? id);
  const inlineIds = renderIds.slice(0, MAX_INLINE_EVIDENCE_IDS);
  const overflowLines: string[] = [];
  if (renderIds.length > inlineIds.length) {
    const sidecar =
      sidecarDir !== undefined
        ? persistCompactionSidecar(sidecarDir, 'evidence-ids', `${renderIds.join('\n')}\n`)
        : undefined;
    overflowLines.push(
      sidecar !== undefined
        ? `evidence_ids_overflow: ${String(renderIds.length)} total; full list: ${sidecar}`
        : `evidence_ids_overflow: ${String(renderIds.length)} total`,
    );
  }
  const evidenceLine = `evidence_ids: ${inlineIds.join(',')}`;
  const archiveLines = inlineIds
    .filter((id) => /^[a-f0-9]+$/i.test(id) && id.length >= 8)
    .map((id) => `[liora-archived id=${id}]`);

  const block = [
    '',
    '## Durable Evidence Continuity',
    'Deterministically restored identifiers that the summarizer omitted:',
    evidenceLine,
    ...overflowLines,
    ...archiveLines,
  ].join('\n');

  return {
    summary: `${summary.trimEnd()}${block}\n`,
    injectedIds: renderIds,
  };
}


export function uniqueLower(items: readonly string[]): readonly string[] {
  return [...new Set(items.map((item) => item.toLowerCase()).filter((item) => item.length > 0))];
}

export function overlapCount(left: readonly string[], right: readonly string[]): number {
  const rightSet = new Set(right);
  return left.filter((item) => rightSet.has(item)).length;
}

export function ratio(count: number, total: number): number {
  if (total <= 0) return 1;
  return Number(Math.max(0, Math.min(1, count / total)).toFixed(2));
}

export function containsUnfinishedWork(text: string): boolean {
  return /\b(?:todo|next steps?|pending|unfinished|remaining|follow[- ]?up|need(?:s|ed)? to|must|should|blocked|open question)\b/i.test(
    text,
  );
}

export function containsFailureMarker(text: string): boolean {
  return /\b(?:error|failed|failure|exception|crash|bug|regression|timeout|blocked|cannot|can't)\b/i.test(
    text,
  );
}

export function hasPromptControlInStructuredMemory(
  memory: ReturnType<typeof parseStructuredCompactionMemory>,
): boolean {
  const items = [
    memory.currentGoal,
    ...memory.decisions,
    ...memory.filesTouched,
    ...memory.failedAttempts,
    ...memory.openQuestions,
    ...memory.nextActions,
  ].filter((item): item is string => item !== undefined);
  return items.some(isPromptControlCompactionMemoryItem);
}

export function buildFailureSignature(input: {
  readonly expectedFileHints: readonly string[];
  readonly summaryFileHints: readonly string[];
  readonly expectedEvidenceIds: readonly string[];
  readonly summaryEvidenceIds: readonly string[];
  readonly expectsNextAction: boolean;
  readonly usefulNextActions: readonly string[];
  readonly expectsFailure: boolean;
  readonly usefulFailedAttempts: readonly string[];
  readonly promptInjectionResistanceScore: number;
  readonly tokensBefore: number;
  readonly tokensAfter?: number | undefined;
}): string | undefined {
  const failures: string[] = [];
  if (input.expectedFileHints.length > 0 && overlapCount(input.expectedFileHints, input.summaryFileHints) < input.expectedFileHints.length) {
    failures.push('missing_file_hints');
  }
  if (
    input.expectedEvidenceIds.length > 0 &&
    overlapCount(input.expectedEvidenceIds, input.summaryEvidenceIds) < input.expectedEvidenceIds.length
  ) {
    failures.push('missing_evidence_ids');
  }
  if (input.expectsNextAction && input.usefulNextActions.length === 0) {
    failures.push('missing_next_actions');
  }
  if (input.expectsFailure && input.usefulFailedAttempts.length === 0) {
    failures.push('missing_failed_attempts');
  }
  if (input.promptInjectionResistanceScore < 1) {
    failures.push('prompt_control_recalled');
  }
  if (
    input.tokensAfter !== undefined &&
    input.tokensBefore >= TINY_HISTORY_TOKEN_THRESHOLD &&
    input.tokensAfter >= input.tokensBefore
  ) {
    failures.push('token_growth');
  }
  return failures.length > 0 ? failures.join(',') : undefined;
}

