import { extractText, type Message } from '@superliora/kosong';

import type { CompactionPlan } from './planner';
import type {
  CompactionQualitySignals,
  CompactionQualityWarningCategory,
} from './types';
import {
  isPlaceholderCompactionMemoryItem,
  isPromptControlCompactionMemoryItem,
  isUsefulCompactionMemoryItem,
  parseStructuredCompactionMemory,
} from './memory';

export interface CompactionQualityResult {
  readonly critical: readonly string[];
  readonly warnings: readonly string[];
  readonly warningCategories: readonly CompactionQualityWarningCategory[];
  readonly signals?: CompactionQualitySignals;
}

const V2_REQUIRED_LABELS = [
  'current_goal',
  'last_known_state',
  'decisions',
  'files_touched',
  'failed_attempts',
  'open_questions',
  'next_actions',
  'raw_refs',
] as const;

const TINY_HISTORY_TOKEN_THRESHOLD = 512;

export function validateInitialCompactionSummary(
  summary: string,
  plan: CompactionPlan,
  compactedMessages: readonly Message[],
): CompactionQualityResult {
  const critical: string[] = [];
  const warnings: string[] = [];
  const warningCategories: CompactionQualityWarningCategory[] = [];
  const trimmed = summary.trim();

  if (trimmed.length === 0) {
    critical.push('summary is empty');
    return { critical, warnings, warningCategories };
  }

  const exactV2Attempt = hasExactV2Attempt(trimmed);
  if (exactV2Attempt) {
    const memory = parseStructuredCompactionMemory(trimmed);
    if (memory.currentGoal === undefined || memory.currentGoal.trim().length === 0) {
      critical.push('v2 summary is missing current_goal');
    }
    if (usefulItems(memory.nextActions).length === 0) {
      critical.push('v2 summary is missing next_actions');
    }
    if (plan.rawRefs.length > 0 && memory.rawRefs.length === 0) {
      critical.push('v2 summary is missing raw_refs');
    }
  }

  const latestUserRequest = latestUserText(compactedMessages);
  if (
    exactV2Attempt &&
    latestUserRequest !== undefined &&
    latestUserRequest.length >= 24 &&
    !sharesMeaningfulToken(trimmed, latestUserRequest)
  ) {
    warnings.push('summary may not mention the latest compacted user request');
  }

  addSignalWarnings(
    warnings,
    warningCategories,
    evaluateCompactionQualitySignals({
      summary: trimmed,
      compactedMessages,
      tokensBefore: plan.compactedTokens,
      tokensAfter: undefined,
    }),
  );

  if (containsRiskyBarePath(trimmed)) {
    warnings.push('summary contains a path-like reference outside code formatting');
  }

  return {
    critical: uniqueList(critical),
    warnings: uniqueList(warnings),
    warningCategories: uniqueCategories(warningCategories),
  };
}

export function validateRenderedCompactionSummary(
  summary: string,
  plan: CompactionPlan,
  compactedMessages: readonly Message[] = [],
  tokensAfter?: number,
): CompactionQualityResult {
  const critical: string[] = [];
  const warnings: string[] = [];
  const warningCategories: CompactionQualityWarningCategory[] = [];

  if (!summary.includes('# SuperLiora Context Compaction v2 Memory')) {
    critical.push('rendered summary is missing the v2 memory header');
  }

  for (const label of V2_REQUIRED_LABELS) {
    if (!summary.includes(`${label}:`)) {
      critical.push(`rendered summary is missing ${label}`);
    }
  }

  const memory = parseStructuredCompactionMemory(summary);
  if (plan.rawRefs.length > 0 && memory.rawRefs.length === 0) {
    critical.push('rendered summary is missing raw_refs entries');
  }
  const signals = evaluateCompactionQualitySignals({
    summary,
    compactedMessages,
    tokensBefore: plan.compactedTokens,
    tokensAfter,
  });
  addSignalWarnings(warnings, warningCategories, signals);

  return {
    critical: uniqueList(critical),
    warnings: uniqueList(warnings),
    warningCategories: uniqueCategories(warningCategories),
    signals,
  };
}

export function evaluateCompactionQualitySignals(input: {
  readonly summary: string;
  readonly compactedMessages: readonly Message[];
  readonly tokensBefore: number;
  readonly tokensAfter?: number | undefined;
}): CompactionQualitySignals {
  const memory = parseStructuredCompactionMemory(input.summary);
  const sourceText = input.compactedMessages.map((message) => extractText(message, ' ')).join('\n');
  const expectedFileHints = uniqueLower(extractFileHintsFromText(sourceText));
  const summaryFileHints = uniqueLower(extractFileHintsFromText(input.summary));
  const usefulNextActions = usefulItems(memory.nextActions);
  const usefulFailedAttempts = usefulItems(memory.failedAttempts);
  const usefulDecisions = usefulItems(memory.decisions);
  const usefulFiles = usefulItems(memory.filesTouched);
  const currentGoal = memory.currentGoal !== undefined && isUsefulCompactionMemoryItem(memory.currentGoal)
    ? memory.currentGoal
    : undefined;
  const placeholderItemCount = [
    memory.currentGoal,
    ...memory.lastKnownState,
    ...memory.decisions,
    ...memory.filesTouched,
    ...memory.failedAttempts,
    ...memory.openQuestions,
    ...memory.nextActions,
    ...memory.rawRefs,
  ].filter((item): item is string => item !== undefined)
    .filter(isPlaceholderCompactionMemoryItem).length;
  const criticalFactCount = [
    currentGoal,
    ...usefulNextActions,
    ...usefulFailedAttempts,
    ...usefulDecisions,
    ...usefulFiles,
  ].filter((item): item is string => item !== undefined).length;
  const fileHintRecallScore = expectedFileHints.length === 0
    ? 1
    : ratio(overlapCount(expectedFileHints, summaryFileHints), expectedFileHints.length);
  const expectsNextAction = containsUnfinishedWork(sourceText);
  const nextActionPreservationScore = expectsNextAction ? (usefulNextActions.length > 0 ? 1 : 0) : 1;
  const expectsFailure = containsFailureMarker(sourceText);
  const failedAttemptRecallScore = expectsFailure ? (usefulFailedAttempts.length > 0 ? 1 : 0) : 1;
  const promptInjectionResistanceScore = hasPromptControlInStructuredMemory(memory) ? 0 : 1;
  const tokensSavedRatio =
    input.tokensAfter === undefined || input.tokensBefore <= 0
      ? 0
      : Number(((input.tokensBefore - input.tokensAfter) / input.tokensBefore).toFixed(4));
  const componentScores = [
    fileHintRecallScore,
    nextActionPreservationScore,
    failedAttemptRecallScore,
    promptInjectionResistanceScore,
  ];
  const recallEvalScore = Number(
    (componentScores.reduce((sum, score) => sum + score, 0) / componentScores.length).toFixed(2),
  );
  const failureSignature = buildFailureSignature({
    expectedFileHints,
    summaryFileHints,
    expectsNextAction,
    usefulNextActions,
    expectsFailure,
    usefulFailedAttempts,
    promptInjectionResistanceScore,
    tokensBefore: input.tokensBefore,
    tokensAfter: input.tokensAfter,
  });

  return {
    recallEvalScore,
    criticalFactCount,
    placeholderItemCount,
    tokensSavedRatio,
    fileHintRecallScore,
    nextActionPreservationScore,
    failedAttemptRecallScore,
    promptInjectionResistanceScore,
    failureSignature,
  };
}

export function mergeCompactionQualityResults(
  ...results: readonly CompactionQualityResult[]
): CompactionQualityResult {
  return {
    critical: uniqueList(results.flatMap((result) => result.critical)),
    warnings: uniqueList(results.flatMap((result) => result.warnings)),
    warningCategories: uniqueCategories(results.flatMap((result) => result.warningCategories)),
    signals: results.findLast((result) => result.signals !== undefined)?.signals,
  };
}

function addSignalWarnings(
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

function hasExactV2Attempt(summary: string): boolean {
  return V2_REQUIRED_LABELS.some((label) =>
    new RegExp(`(^|\\n)\\s*(?:#{1,6}\\s*)?${label}\\s*:`, 'i').test(summary)
  );
}

function latestUserText(messages: readonly Message[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== 'user') continue;
    const text = extractText(message, ' ').replaceAll(/\s+/g, ' ').trim();
    if (text.length > 0) return text;
  }
  return undefined;
}

function sharesMeaningfulToken(summary: string, source: string): boolean {
  const summaryLower = summary.toLowerCase();
  for (const token of source.toLowerCase().match(/[a-z0-9_./-]{4,}/g) ?? []) {
    if (token.length < 4) continue;
    if (summaryLower.includes(token)) return true;
  }
  return false;
}

function containsRiskyBarePath(summary: string): boolean {
  const withoutInlineCode = summary.replaceAll(/`[^`]*`/g, '');
  return /(?:^|\s)(?:\.{1,2}\/|\/|[A-Za-z]:\\)[^\s]+\.(?:ts|js|tsx|jsx|py|rs|go|java|kt|swift|md|json|ya?ml|toml|html|css|scss|sql)(?:\s|$)/i.test(
    withoutInlineCode,
  );
}

function uniqueList(items: readonly string[]): readonly string[] {
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

function uniqueCategories(
  items: readonly CompactionQualityWarningCategory[],
): readonly CompactionQualityWarningCategory[] {
  return [...new Set(items)];
}

function usefulItems(items: readonly string[]): readonly string[] {
  return items.filter(isUsefulCompactionMemoryItem);
}

function extractFileHintsFromText(text: string): readonly string[] {
  const matches = text.matchAll(
    /`([^`]+\.(?:ts|js|tsx|jsx|py|rs|go|java|kt|swift|md|json|yaml|yml|toml|html|css|scss|sql))`|([A-Za-z0-9_./-]+\.(?:ts|js|tsx|jsx|py|rs|go|java|kt|swift|md|json|yaml|yml|toml|html|css|scss|sql))/gi,
  );
  const files: string[] = [];
  for (const match of matches) {
    files.push((match[1] ?? match[2] ?? '').trim());
  }
  return files;
}

function uniqueLower(items: readonly string[]): readonly string[] {
  return [...new Set(items.map((item) => item.toLowerCase()).filter((item) => item.length > 0))];
}

function overlapCount(left: readonly string[], right: readonly string[]): number {
  const rightSet = new Set(right);
  return left.filter((item) => rightSet.has(item)).length;
}

function ratio(count: number, total: number): number {
  if (total <= 0) return 1;
  return Number(Math.max(0, Math.min(1, count / total)).toFixed(2));
}

function containsUnfinishedWork(text: string): boolean {
  return /\b(?:todo|next steps?|pending|unfinished|remaining|follow[- ]?up|need(?:s|ed)? to|must|should|blocked|open question)\b/i.test(
    text,
  );
}

function containsFailureMarker(text: string): boolean {
  return /\b(?:error|failed|failure|exception|crash|bug|regression|timeout|blocked|cannot|can't)\b/i.test(
    text,
  );
}

function hasPromptControlInStructuredMemory(
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

function buildFailureSignature(input: {
  readonly expectedFileHints: readonly string[];
  readonly summaryFileHints: readonly string[];
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
