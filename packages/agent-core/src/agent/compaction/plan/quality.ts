import { extractText, type Message } from '@superliora/kosong';

import type { CompactionPlan } from './planner';
import type {
  CompactionQualitySignals,
  CompactionQualityWarningCategory,
} from '../types';
import type { UltraworkRunMirror } from '#/mission';
import {
  isPlaceholderCompactionMemoryItem,
  isUsefulCompactionMemoryItem,
  parseStructuredCompactionMemory,
} from '../memory';
import {
  addSignalWarnings,
  buildFailureSignature,
  computeSwarmRecallScore,
  containsFailureMarker,
  containsRiskyBarePath,
  containsUnfinishedWork,
  extractEvidenceIdsFromText,
  extractFileHintsFromText,
  hasExactV2Attempt,
  hasPromptControlInStructuredMemory,
  injectMissingDurableEvidenceIds,
  latestUserText,
  overlapCount,
  ratio,
  sharesMeaningfulToken,
  uniqueCategories,
  uniqueList,
  uniqueLower,
  usefulItems,
  V2_REQUIRED_LABELS,
} from './quality-helpers';
import { extractSwarmRunsFromMessages } from '../memory/swarm-memory-extract';
export { extractEvidenceIdsFromText, injectMissingDurableEvidenceIds } from './quality-helpers';
export type { CompactionQualityTrend } from './quality-tracker';
export { CompactionQualityTracker } from './quality-tracker';

export interface CompactionQualityResult {
  readonly critical: readonly string[];
  readonly warnings: readonly string[];
  readonly warningCategories: readonly CompactionQualityWarningCategory[];
  readonly signals?: CompactionQualitySignals;
}

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
