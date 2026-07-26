import { describe, expect, it } from 'vitest';

import {
  AMBIGUITY_THRESHOLD,
  clampClarity,
  computeAmbiguityScoreHeuristic,
  CONSTRAINT_CLARITY_FLOOR,
  floorFailures,
  GOAL_CLARITY_FLOOR,
  normalizeSectionName,
  SUCCESS_CRITERIA_CLARITY_FLOOR,
} from '#/agent/plan/ultra-plan-ambiguity-heuristic';
import type { InterviewState } from '#/agent/plan/ultra-plan-mode';

function makeState(rounds: InterviewState['rounds']): InterviewState {
  return { rounds };
}

describe('agent/plan/ultra-plan-ambiguity-heuristic — deterministic fallback scorer', () => {
  describe('clampClarity', () => {
    it('clamps below 0 to 0', () => {
      expect(clampClarity(-0.5)).toBe(0);
    });

    it('clamps above 1 to 1', () => {
      expect(clampClarity(1.5)).toBe(1);
    });

    it('keeps in-range values untouched', () => {
      expect(clampClarity(0.42)).toBe(0.42);
    });
  });

  describe('floorFailures', () => {
    it('returns no failures when all clarities meet their floors', () => {
      expect(
        floorFailures(
          GOAL_CLARITY_FLOOR,
          CONSTRAINT_CLARITY_FLOOR,
          SUCCESS_CRITERIA_CLARITY_FLOOR,
        ),
      ).toEqual([]);
    });

    it('flags a goal clarity shortfall', () => {
      const failures = floorFailures(0.1, 1, 1);
      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatch(/Goal Clarity/);
    });

    it('flags every clarity shortfall independently', () => {
      const failures = floorFailures(0.1, 0.1, 0.1);
      expect(failures).toHaveLength(3);
      expect(failures.join(' ')).toMatch(/Goal/);
      expect(failures.join(' ')).toMatch(/Constraint/);
      expect(failures.join(' ')).toMatch(/Success Criteria/);
    });
  });

  describe('normalizeSectionName', () => {
    it('lowercases and replaces whitespace with underscores', () => {
      expect(normalizeSectionName('Goal Statement')).toBe('goal_statement');
    });

    it('trims surrounding whitespace before normalizing', () => {
      expect(normalizeSectionName('  Acceptance Criteria  ')).toBe('acceptance_criteria');
    });

    it('collapses consecutive whitespace into a single underscore', () => {
      expect(normalizeSectionName('A   B\t\tC')).toBe('a_b_c');
    });
  });

  describe('computeAmbiguityScoreHeuristic', () => {
    it('returns the most conservative defaults for an empty interview', () => {
      const result = computeAmbiguityScoreHeuristic(makeState([]));
      // Empty interview: 0 user-origin rounds, 10 estimated open sections.
      // goalClarity = max(0, 1 - 0.25*10) * 0.3 = 0
      // constraintClarity = 0.3 / 3 = 0.1
      // successCriteriaClarity mirrors constraintClarity.
      expect(result.goalClarity).toBe(0);
      expect(result.constraintClarity).toBeCloseTo(0.1);
      expect(result.successCriteriaClarity).toBeCloseTo(0.1);
      expect(result.verifiableGoal).toBe(false);
      expect(result.specificityScore).toBe(0);
      expect(result.presentSections).toEqual([]);
    });

    it('clamps all clarities into [0, 1] even with extreme user-origin ratio', () => {
      const state = makeState([
        { origin: 'user' },
        { origin: 'user' },
        { origin: 'user' },
        { origin: 'user' },
        { origin: 'user' },
        { origin: 'user' },
        { origin: 'user' },
        { origin: 'user' },
        { origin: 'user' },
        { origin: 'user' },
      ]);
      const result = computeAmbiguityScoreHeuristic(state);
      for (const v of [
        result.goalClarity,
        result.constraintClarity,
        result.successCriteriaClarity,
      ]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    });

    it('fills justification strings from the heuristic path', () => {
      const result = computeAmbiguityScoreHeuristic(makeState([{ origin: 'user' }]));
      expect(result.justifications.goal).toMatch(/Heuristic fallback/);
      expect(result.justifications.constraints).toMatch(/Heuristic fallback/);
      expect(result.justifications.successCriteria).toMatch(/Heuristic fallback/);
    });
  });

  it('exposes the canonical floor and threshold constants', () => {
    expect(AMBIGUITY_THRESHOLD).toBe(0.2);
    expect(GOAL_CLARITY_FLOOR).toBe(0.75);
    expect(CONSTRAINT_CLARITY_FLOOR).toBe(0.65);
    expect(SUCCESS_CRITERIA_CLARITY_FLOOR).toBe(0.7);
  });
});
