/**
 * Pure deterministic ambiguity scoring helpers for Ultra Plan interviews.
 */

import { ULTRA_PLAN_REQUIRED_SECTIONS } from './ultra-plan-section-guidance';
import type { InterviewState } from './ultra-plan-mode';

export const AMBIGUITY_THRESHOLD = 0.2;
export const GOAL_CLARITY_FLOOR = 0.75;
export const CONSTRAINT_CLARITY_FLOOR = 0.65;
export const SUCCESS_CRITERIA_CLARITY_FLOOR = 0.70;

export interface LLMAmbiguityResult {
  readonly goalClarity: number;
  readonly constraintClarity: number;
  readonly successCriteriaClarity: number;
  readonly presentSections: readonly string[];
  readonly verifiableGoal: boolean;
  readonly specificityScore: number;
  readonly justifications: {
    readonly goal: string;
    readonly constraints: string;
    readonly successCriteria: string;
  };
}

export function clampClarity(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function floorFailures(
  goalClarity: number,
  constraintClarity: number,
  criteriaClarity: number,
): readonly string[] {
  const failures: string[] = [];
  if (goalClarity < GOAL_CLARITY_FLOOR) {
    failures.push(`Goal Clarity ${goalClarity.toFixed(2)} < ${GOAL_CLARITY_FLOOR.toFixed(2)}`);
  }
  if (constraintClarity < CONSTRAINT_CLARITY_FLOOR) {
    failures.push(`Constraint Clarity ${constraintClarity.toFixed(2)} < ${CONSTRAINT_CLARITY_FLOOR.toFixed(2)}`);
  }
  if (criteriaClarity < SUCCESS_CRITERIA_CLARITY_FLOOR) {
    failures.push(`Success Criteria Clarity ${criteriaClarity.toFixed(2)} < ${SUCCESS_CRITERIA_CLARITY_FLOOR.toFixed(2)}`);
  }
  return failures;
}

export function normalizeSectionName(section: string): string {
  let result = '';
  let previousWasSpace = true;
  for (const c of section.trim().toLowerCase()) {
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v') {
      if (!previousWasSpace) {
        result += '_';
        previousWasSpace = true;
      }
    } else {
      result += c;
      previousWasSpace = false;
    }
  }
  return result;
}

/**
 * Deterministic fallback ambiguity scorer used when the LLM scoring engine
 * is unavailable or returns invalid JSON. Intentionally conservative so a
 * transient LLM outage cannot prematurely mark the interview as ready.
 */
export function computeAmbiguityScoreHeuristic(state: InterviewState): LLMAmbiguityResult {
  const totalRounds = state.rounds.length;
  const userRounds = state.rounds.filter((round) => round.origin === 'user').length;
  const userOriginRatio = totalRounds > 0 ? userRounds / totalRounds : 0;
  // Assume most sections are open when the LLM cannot evaluate the evidence;
  // each closed round is treated as covering roughly two sections.
  const estimatedClosedSections = Math.min(Math.floor(totalRounds * 2), ULTRA_PLAN_REQUIRED_SECTIONS.length);
  const openGaps = Math.max(0, ULTRA_PLAN_REQUIRED_SECTIONS.length - estimatedClosedSections);

  const goalClarity = Math.max(0, 1 - 0.25 * openGaps) * (userOriginRatio * 0.7 + 0.3);
  const constraintClarity = (userOriginRatio * 0.7 + 0.3) / 3;
  const successCriteriaClarity = constraintClarity;

  return {
    goalClarity: Math.max(0, Math.min(1, goalClarity)),
    constraintClarity: Math.max(0, Math.min(1, constraintClarity)),
    successCriteriaClarity: Math.max(0, Math.min(1, successCriteriaClarity)),
    presentSections: [],
    verifiableGoal: false,
    specificityScore: 0,
    justifications: {
      goal: `Heuristic fallback: ${openGaps} estimated open sections, ${Math.round(userOriginRatio * 100)}% user-origin answers.`,
      constraints: 'Heuristic fallback: derived from user-origin ratio.',
      successCriteria: 'Heuristic fallback: derived from user-origin ratio.',
    },
  };
}
