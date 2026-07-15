/**
 * Pure ambiguity score assembly for Ultra Plan interviews.
 */

import {
  AMBIGUITY_THRESHOLD,
  clampClarity,
  floorFailures as floorFailuresPure,
  normalizeSectionName,
  type LLMAmbiguityResult,
} from './ultra-plan-ambiguity-heuristic';
import {
  MAX_INTERVIEW_ROUNDS,
  ULTRA_PLAN_REQUIRED_SECTIONS,
  type UltraPlanRequiredSection,
} from './ultra-plan-section-guidance';
import type {
  AmbiguityMilestone,
  AmbiguityScoreResult,
  InterviewState,
} from './ultra-plan-mode';

export { AMBIGUITY_THRESHOLD };

export interface BuildAmbiguityScoreInput {
  readonly llmResult: LLMAmbiguityResult;
  readonly evidenceHash: string;
  readonly interviewState: InterviewState;
  readonly usedHeuristicFallback?: boolean;
}

export interface BuildAmbiguityScoreOutput {
  readonly result: AmbiguityScoreResult;
  readonly nextInterviewState: InterviewState;
  readonly progressMessages: readonly string[];
}

export function buildAmbiguityScoreResult(input: BuildAmbiguityScoreInput): BuildAmbiguityScoreOutput {
  const { llmResult, evidenceHash, usedHeuristicFallback = false } = input;
  let interviewState = input.interviewState;

  const totalRounds = interviewState.rounds.length;
  const answerRoundClarity = Math.min(totalRounds / 3, 1.0);
  const specificityClarity = llmResult.specificityScore;

  const goalClarity = clampClarity(
    llmResult.goalClarity * 0.7 + answerRoundClarity * 0.2 + specificityClarity * 0.1,
  );
  const constraintClarity = clampClarity(
    llmResult.constraintClarity * 0.75 + specificityClarity * 0.15 + answerRoundClarity * 0.1,
  );
  const criteriaClarity = clampClarity(
    llmResult.successCriteriaClarity * 0.75 + specificityClarity * 0.15 + answerRoundClarity * 0.1,
  );

  const rawOverall =
    1.0 - (goalClarity * 0.4 + constraintClarity * 0.3 + criteriaClarity * 0.3);

  const presentSet = new Set(
    llmResult.presentSections.map((section) => normalizeSectionName(String(section))),
  );
  const openGaps = ULTRA_PLAN_REQUIRED_SECTIONS.filter((section) => !presentSet.has(section));
  const gapPressure = openGaps.length / ULTRA_PLAN_REQUIRED_SECTIONS.length;
  const verifiableGoal = llmResult.verifiableGoal;
  const floorFailures = floorFailuresPure(goalClarity, constraintClarity, criteriaClarity);
  const floorPressure = floorFailures.length > 0 ? AMBIGUITY_THRESHOLD + 0.01 : 0;
  const gatedOverall = clampClarity(
    Math.max(rawOverall, gapPressure, verifiableGoal ? 0 : 0.45, floorPressure),
  );

  const milestone: AmbiguityMilestone =
    gatedOverall <= AMBIGUITY_THRESHOLD
      ? 'ready'
      : gatedOverall <= 0.3
        ? 'refined'
        : gatedOverall <= 0.4
          ? 'progress'
          : 'initial';

  let isReady =
    gatedOverall <= AMBIGUITY_THRESHOLD &&
    openGaps.length === 0 &&
    verifiableGoal &&
    floorFailures.length === 0;

  // Monotonic ready: once locked, stay ready until evidence changes.
  if (interviewState.monotonicReadyLocked === true) {
    isReady = true;
  }

  const progressMessages: string[] = [];
  const hitMaxRounds = totalRounds >= MAX_INTERVIEW_ROUNDS;
  if (hitMaxRounds && !isReady) {
    progressMessages.push(
      `Interview round cap (${MAX_INTERVIEW_ROUNDS}) reached — Design remains blocked until blockers close.`,
    );
  }

  const lastReadyRoundCount = interviewState.lastReadyRoundCount ?? -1;
  const hasNewRoundSinceLastReady = interviewState.rounds.length > lastReadyRoundCount;
  const evidenceChanged = interviewState.lastReadyEvidenceHash !== evidenceHash;

  if (isReady && (evidenceChanged || hasNewRoundSinceLastReady)) {
    interviewState = {
      ...interviewState,
      completionCandidateStreak: interviewState.completionCandidateStreak + 1,
      lastReadyEvidenceHash: evidenceHash,
      lastReadyRoundCount: interviewState.rounds.length,
      // Lock monotonic ready so subsequent calls with the same evidence
      // cannot un-ready the gate due to LLM non-determinism.
      monotonicReadyLocked: true,
    };
  } else {
    interviewState = {
      ...interviewState,
      completionCandidateStreak: isReady ? interviewState.completionCandidateStreak : 0,
      lastReadyEvidenceHash: isReady ? interviewState.lastReadyEvidenceHash : undefined,
      lastReadyRoundCount: isReady ? interviewState.lastReadyRoundCount : -1,
      // Only unlock when a genuinely new round makes isReady false.
      monotonicReadyLocked: isReady ? interviewState.monotonicReadyLocked : false,
    };
  }

  const result: AmbiguityScoreResult = {
    overallScore: gatedOverall,
    breakdown: [
      {
        name: 'goal_clarity',
        clarityScore: goalClarity,
        weight: 0.4,
        justification: llmResult.justifications.goal,
      },
      {
        name: 'constraint_clarity',
        clarityScore: constraintClarity,
        weight: 0.3,
        justification: llmResult.justifications.constraints,
      },
      {
        name: 'success_criteria_clarity',
        clarityScore: criteriaClarity,
        weight: 0.3,
        justification: llmResult.justifications.successCriteria,
      },
      {
        name: 'seed_ledger_gaps',
        clarityScore: 1 - gapPressure,
        weight: 1,
        justification: `Open required sections: ${openGaps.length === 0 ? 'none' : openGaps.join(', ')}`,
      },
      {
        name: 'verifiable_goal',
        clarityScore: verifiableGoal ? 1 : 0,
        weight: 1,
        justification: 'UltraGoal must be judgeable as complete or incomplete.',
      },
    ],
    isReadyForSeed: isReady,
    milestone,
    floorFailures,
    usedHeuristicFallback,
  };

  interviewState = {
    ...interviewState,
    ambiguityScore: result,
  };

  progressMessages.push(
    `Goal clarity: ${goalClarity.toFixed(2)} — ${llmResult.justifications.goal}`,
    `Constraint clarity: ${constraintClarity.toFixed(2)} — ${llmResult.justifications.constraints}`,
    `Success criteria clarity: ${criteriaClarity.toFixed(2)} — ${llmResult.justifications.successCriteria}`,
    `Open Seed gaps: ${openGaps.length === 0 ? 'none' : openGaps.join(', ')}`,
  );
  if (floorFailures.length > 0) {
    progressMessages.push(`Dimension floor failures: ${floorFailures.join('; ')}`);
  }
  progressMessages.push(
    result.isReadyForSeed
      ? 'Seed Spec is ready. Preparing next question...'
      : 'Preparing next question...',
  );

  return { result, nextInterviewState: interviewState, progressMessages };
}

export function openSeedGapsFromLlmResult(
  llmResult: LLMAmbiguityResult | null | undefined,
): UltraPlanRequiredSection[] {
  if (llmResult === null || llmResult === undefined) {
    return [...ULTRA_PLAN_REQUIRED_SECTIONS];
  }
  const presentSet = new Set(
    llmResult.presentSections.map((section) => normalizeSectionName(String(section))),
  );
  return ULTRA_PLAN_REQUIRED_SECTIONS.filter((section) => !presentSet.has(section));
}
