import { extractText, type Message } from '@superliora/kosong';

import {
  extractSwarmRunsFromMessages,
  extractSwarmRunsFromText,
} from './swarm-memory-extract';
import type { CompactionPlan } from './planner';
import type {
  CompactionQualitySignals,
  CompactionQualityWarningCategory,
} from './types';
import type { UltraworkRunMirror } from '../../ultrawork/types';
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
    // raw_refs are planner-derived and injected during renderStructuredV2Summary;
    // do not fail the pre-render LLM summary when the model omits them.
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

  const signals = evaluateCompactionQualitySignals({
    summary: trimmed,
    compactedMessages,
    tokensBefore: plan.compactedTokens,
    tokensAfter: undefined,
  });
  addSignalWarnings(warnings, warningCategories, signals);
  // Durable IDs are load-bearing for resume/harness control (T4): drop = critical.
  if (signals.evidenceIdRecallScore < 1) {
    critical.push(
      'summary is missing durable evidence/node/archive identifiers present in compacted history',
    );
  }

  if (containsRiskyBarePath(trimmed)) {
    warnings.push('summary contains a path-like reference outside code formatting');
  }

  return {
    critical: uniqueList(critical),
    warnings: uniqueList(warnings),
    warningCategories: uniqueCategories(warningCategories),
    signals,
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
  if (signals.evidenceIdRecallScore < 1) {
    critical.push(
      'summary is missing durable evidence/node/archive identifiers present in compacted history',
    );
  }

  return {
    critical: uniqueList(critical),
    warnings: uniqueList(warnings),
    warningCategories: uniqueCategories(warningCategories),
    signals,
  };
}

export function validateUltraworkCompactionContinuity(
  summary: string,
  snapshot: UltraworkRunMirror,
): CompactionQualityResult {
  const critical: string[] = [];
  const warnings: string[] = [];
  const warningCategories: CompactionQualityWarningCategory[] = [];
  const trimmed = summary.trim();

  if (!trimmed.includes(snapshot.run.id)) {
    critical.push(`summary is missing ultrawork run_id ${snapshot.run.id}`);
  }
  if (!trimmed.includes(snapshot.run.stage)) {
    critical.push(`summary is missing ultrawork stage ${snapshot.run.stage}`);
  }
  if (!trimmed.includes('ultrawork_runs:') && !trimmed.includes('ultrawork_envelope:')) {
    critical.push('summary is missing ultrawork checkpoint section');
  }

  const memory = parseStructuredCompactionMemory(trimmed);
  if (usefulItems(memory.nextActions).length === 0) {
    warnings.push('summary did not preserve next_actions for the active Ultrawork run');
    warningCategories.push('missing_next_actions');
  }
  if (usefulItems(memory.ultraworkRuns).length === 0) {
    warnings.push('summary is missing structured ultrawork_runs entries');
    warningCategories.push('missing_ultrawork_checkpoint');
  }

  return {
    critical: uniqueList(critical),
    warnings: uniqueList(warnings),
    warningCategories: uniqueCategories(warningCategories),
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
  const expectedEvidenceIds = uniqueLower(extractEvidenceIdsFromText(sourceText));
  const summaryEvidenceIds = uniqueLower(extractEvidenceIdsFromText(input.summary));
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
  const evidenceIdRecallScore = expectedEvidenceIds.length === 0
    ? 1
    : ratio(overlapCount(expectedEvidenceIds, summaryEvidenceIds), expectedEvidenceIds.length);
  const expectsNextAction = containsUnfinishedWork(sourceText);
  const nextActionPreservationScore = expectsNextAction ? (usefulNextActions.length > 0 ? 1 : 0) : 1;
  const expectsFailure = containsFailureMarker(sourceText);
  const failedAttemptRecallScore = expectsFailure ? (usefulFailedAttempts.length > 0 ? 1 : 0) : 1;
  const swarmRuns = extractSwarmRunsFromMessages(input.compactedMessages);
  const swarmRecallScore = swarmRuns.length === 0
    ? 1
    : computeSwarmRecallScore(swarmRuns, input.summary, memory.swarmRuns);
  const promptInjectionResistanceScore = hasPromptControlInStructuredMemory(memory) ? 0 : 1;
  const tokensSavedRatio =
    input.tokensAfter === undefined || input.tokensBefore <= 0
      ? 0
      : Number(((input.tokensBefore - input.tokensAfter) / input.tokensBefore).toFixed(4));
  const componentScores = [
    fileHintRecallScore,
    nextActionPreservationScore,
    failedAttemptRecallScore,
    evidenceIdRecallScore,
    promptInjectionResistanceScore,
    swarmRecallScore,
  ];
  const recallEvalScore = Number(
    (componentScores.reduce((sum, score) => sum + score, 0) / componentScores.length).toFixed(2),
  );
  const failureSignature = buildFailureSignature({
    expectedFileHints,
    summaryFileHints,
    expectedEvidenceIds,
    summaryEvidenceIds,
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
    evidenceIdRecallScore,
    promptInjectionResistanceScore,
    swarmRecallScore,
    failureSignature,
  };
}

function computeSwarmRecallScore(
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

/** Stable durable identifiers that must survive compaction when present in history. */
function extractEvidenceIdsFromText(text: string): string[] {
  const ids = new Set<string>();
  // evidence_ids: a,b  OR evidence_id=x OR evidence_ids="a,b"
  const attr = /\bevidence[_-]?ids?\s*[=:]\s*["']?([A-Za-z0-9_.:\/-]+(?:\s*,\s*[A-Za-z0-9_.:\/-]+)*)/gi;
  let match: RegExpExecArray | null;
  while ((match = attr.exec(text)) !== null) {
    for (const raw of match[1]?.split(/[,\s]+/) ?? []) {
      const id = raw.trim();
      if (id.length >= 2) ids.add(id);
    }
  }
  // WorkGraph / Ultrawork node ids in common forms: node_id=..., work_node_ids=...
  const nodeAttr = /\b(?:work_?node_ids?|node_id|ac_id|acceptance_criterion_id)\s*[=:]\s*["']?([A-Za-z0-9_.:\/-]+(?:\s*,\s*[A-Za-z0-9_.:\/-]+)*)/gi;
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

const QUALITY_ROLLING_WINDOW = 5;
const LOW_QUALITY_THRESHOLD = 0.75;

export interface CompactionQualityTrend {
  readonly sampleCount: number;
  readonly rollingAverage: number | null;
  readonly lowQualityStreak: number;
  readonly emergencyBackstopCount: number;
  readonly evidenceRepairAttempts: number;
  readonly evidenceRepairSuccesses: number;
  readonly evidenceRepairSuccessRate: number | null;
}

/**
 * Rolling compaction-quality feedback used to bias future trigger thresholds.
 * When recent summaries score poorly or require the emergency backstop, compaction
 * fires earlier on subsequent turns.
 */
export class CompactionQualityTracker {
  private readonly scores: number[] = [];
  private lowQualityStreak = 0;
  private emergencyBackstopCount = 0;
  private evidenceRepairAttempts = 0;
  private evidenceRepairSuccesses = 0;

  record(input: {
    readonly recallEvalScore?: number | undefined;
    readonly usedEmergencyBackstop: boolean;
    readonly evidenceRepairAttempted?: boolean;
    readonly evidenceRepairSucceeded?: boolean;
  }): CompactionQualityTrend {
    if (input.evidenceRepairAttempted === true) {
      this.evidenceRepairAttempts += 1;
      if (input.evidenceRepairSucceeded === true) {
        this.evidenceRepairSuccesses += 1;
      }
    }
    if (input.usedEmergencyBackstop) {
      this.emergencyBackstopCount += 1;
      this.lowQualityStreak += 1;
    } else if (input.recallEvalScore !== undefined) {
      this.scores.push(input.recallEvalScore);
      if (this.scores.length > QUALITY_ROLLING_WINDOW) {
        this.scores.shift();
      }
      if (input.recallEvalScore < LOW_QUALITY_THRESHOLD) {
        this.lowQualityStreak += 1;
      } else {
        this.lowQualityStreak = 0;
      }
    }
    return this.trend();
  }

  trend(): CompactionQualityTrend {
    const evidenceRepairSuccessRate =
      this.evidenceRepairAttempts === 0
        ? null
        : Number((this.evidenceRepairSuccesses / this.evidenceRepairAttempts).toFixed(3));
    if (this.scores.length === 0) {
      return {
        sampleCount: 0,
        rollingAverage: null,
        lowQualityStreak: this.lowQualityStreak,
        emergencyBackstopCount: this.emergencyBackstopCount,
        evidenceRepairAttempts: this.evidenceRepairAttempts,
        evidenceRepairSuccesses: this.evidenceRepairSuccesses,
        evidenceRepairSuccessRate,
      };
    }
    const rollingAverage = Number(
      (this.scores.reduce((sum, score) => sum + score, 0) / this.scores.length).toFixed(3),
    );
    return {
      sampleCount: this.scores.length,
      rollingAverage,
      lowQualityStreak: this.lowQualityStreak,
      emergencyBackstopCount: this.emergencyBackstopCount,
      evidenceRepairAttempts: this.evidenceRepairAttempts,
      evidenceRepairSuccesses: this.evidenceRepairSuccesses,
      evidenceRepairSuccessRate,
    };
  }
}

