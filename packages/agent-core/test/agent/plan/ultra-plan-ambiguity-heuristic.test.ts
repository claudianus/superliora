import { describe, expect, it } from 'vitest';

import {
  AMBIGUITY_THRESHOLD,
  CONSTRAINT_CLARITY_FLOOR,
  GOAL_CLARITY_FLOOR,
  SUCCESS_CRITERIA_CLARITY_FLOOR,
  clampClarity,
  computeAmbiguityScoreHeuristic,
  floorFailures,
  normalizeSectionName,
} from '../../../src/agent/plan/ultra-plan-ambiguity-heuristic';
import type { InterviewState } from '../../../src/agent/plan/ultra-plan-mode';

function state(rounds: { origin: 'user' | 'model' | 'system' }[]): InterviewState {
  return {
    objective: '',
    rounds: rounds.map((r, i) => ({
      id: `r${i}`,
      origin: r.origin,
      prompt: '',
      response: '',
    })),
  } as unknown as InterviewState;
}

describe('plan/ultra-plan-ambiguity-heuristic.ts — clamps and floors', () => {
  it('clampClarity pins values to [0, 1]', () => {
    expect(clampClarity(0.5)).toBe(0.5);
    expect(clampClarity(1.5)).toBe(1);
    expect(clampClarity(-0.2)).toBe(0);
  });

  it('pins the documented floor constants', () => {
    expect(GOAL_CLARITY_FLOOR).toBe(0.75);
    expect(CONSTRAINT_CLARITY_FLOOR).toBe(0.65);
    expect(SUCCESS_CRITERIA_CLARITY_FLOOR).toBe(0.7);
    expect(AMBIGUITY_THRESHOLD).toBe(0.2);
  });

  it('floorFailures lists one entry per metric below its floor', () => {
    // 0.70 < 0.75 → goal fails
    // 0.70 > 0.65 → constraint passes
    // 0.70 < 0.70 → success criteria passes (strict <)
    expect(floorFailures(0.7, 0.7, 0.7)).toEqual(['Goal Clarity 0.70 < 0.75']);
    expect(floorFailures(0.0, 0.0, 0.0)).toHaveLength(3);
    expect(floorFailures(0.9, 0.9, 0.9)).toEqual([]);
  });
});

describe('plan/ultra-plan-ambiguity-heuristic.ts — normalizeSectionName', () => {
  it('converts whitespace runs to a single underscore and lowercases', () => {
    expect(normalizeSectionName('Goal Clarity')).toBe('goal_clarity');
    expect(normalizeSectionName('  Goal   Clarity  ')).toBe('goal_clarity');
    expect(normalizeSectionName('Goal\tClarity\nPlan')).toBe('goal_clarity_plan');
  });
});

describe('plan/ultra-plan-ambiguity-heuristic.ts — computeAmbiguityScoreHeuristic', () => {
  it('returns clamped scores in [0, 1] with heuristic justifications', () => {
    const out = computeAmbiguityScoreHeuristic(state([
      { origin: 'user' },
      { origin: 'user' },
      { origin: 'user' },
    ]));
    for (const v of [out.goalClarity, out.constraintClarity, out.successCriteriaClarity]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(out.presentSections).toEqual([]);
    expect(out.verifiableGoal).toBe(false);
    expect(out.specificityScore).toBe(0);
    expect(out.justifications.goal).toMatch(/Heuristic fallback/);
  });

  it('keeps every score strictly below the goal-clarity floor when no user rounds exist', () => {
    const out = computeAmbiguityScoreHeuristic(state([
      { origin: 'model' },
      { origin: 'model' },
      { origin: 'model' },
    ]));
    expect(out.goalClarity).toBeLessThan(GOAL_CLARITY_FLOOR);
    expect(out.constraintClarity).toBeLessThan(CONSTRAINT_CLARITY_FLOOR);
  });

  it('handles an empty rounds list with a 0 user-origin ratio and no division-by-zero', () => {
    const out = computeAmbiguityScoreHeuristic(state([]));
    expect(out.goalClarity).toBe(0);
    expect(out.justifications.goal).toContain('0% user-origin');
  });
});
