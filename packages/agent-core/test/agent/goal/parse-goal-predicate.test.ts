import { describe, expect, it } from 'vitest';

import { parseGoalPredicateCriterion } from '#/agent/goal/predicate';
import {
  GOAL_BLOCKED_REMINDER_NAME,
  GOAL_COMPLETION_REMINDER_NAME,
} from '#/agent/turn/reminder-names';

describe('agent/turn/reminder-names — constants', () => {
  it('exposes the documented reminder names', () => {
    expect(GOAL_COMPLETION_REMINDER_NAME).toBe('goal_completion');
    expect(GOAL_BLOCKED_REMINDER_NAME).toBe('goal_blocked');
  });
});

describe('agent/goal/predicate — parseGoalPredicateCriterion', () => {
  it('returns empty when the input is undefined', () => {
    expect(parseGoalPredicateCriterion(undefined)).toEqual({ kind: 'empty' });
  });

  it('returns empty when the input is whitespace', () => {
    expect(parseGoalPredicateCriterion('   \n  ')).toEqual({ kind: 'empty' });
  });

  it('parses a fenced goal-predicate block', () => {
    const result = parseGoalPredicateCriterion(
      '```goal-predicate\n{"version":1,"minEvidenceIds":2,"requireUltraworkGraph":true}\n```',
    );
    expect(result).toEqual({
      kind: 'structured',
      spec: {
        version: 1,
        requiredPaths: undefined,
        requiredTestFiles: undefined,
        minEvidenceIds: 2,
        requireUltraworkGraph: true,
      },
    });
  });

  it('parses a fenced json block', () => {
    const result = parseGoalPredicateCriterion(
      'preamble\n```json\n{"version":"1","requiredPaths":["a","b"]}\n```\nepilogue',
    );
    expect(result).toEqual({
      kind: 'structured',
      spec: {
        version: 1,
        requiredPaths: ['a', 'b'],
        requiredTestFiles: undefined,
        minEvidenceIds: undefined,
        requireUltraworkGraph: undefined,
      },
    });
  });

  it('parses a predicate:v1: prefix line', () => {
    const result = parseGoalPredicateCriterion(
      'predicate:v1:{"version":1,"requiredTestFiles":["x.test.ts"]}',
    );
    expect(result).toEqual({
      kind: 'structured',
      spec: {
        version: 1,
        requiredPaths: undefined,
        requiredTestFiles: ['x.test.ts'],
        minEvidenceIds: undefined,
        requireUltraworkGraph: undefined,
      },
    });
  });

  it('parses a bare JSON object as the whole input', () => {
    const result = parseGoalPredicateCriterion('{"version":1,"minEvidenceIds":5}');
    expect(result).toEqual({
      kind: 'structured',
      spec: {
        version: 1,
        requiredPaths: undefined,
        requiredTestFiles: undefined,
        minEvidenceIds: 5,
        requireUltraworkGraph: undefined,
      },
    });
  });

  it('falls back to legacy for plain prose', () => {
    const result = parseGoalPredicateCriterion('Refactor the parser to support ranges.');
    expect(result).toEqual({ kind: 'legacy', text: 'Refactor the parser to support ranges.' });
  });

  it('falls back to legacy when the JSON is invalid', () => {
    const result = parseGoalPredicateCriterion('predicate:v1:{not-json}');
    expect(result).toEqual({ kind: 'legacy', text: 'predicate:v1:{not-json}' });
  });

  it('falls back to legacy when version mismatches', () => {
    const result = parseGoalPredicateCriterion('{"version":2,"minEvidenceIds":1}');
    expect(result).toEqual({ kind: 'legacy', text: '{"version":2,"minEvidenceIds":1}' });
  });

  it('clamps negative minEvidenceIds to 0 and trims empty path strings', () => {
    const result = parseGoalPredicateCriterion(
      '```goal-predicate\n{"version":1,"minEvidenceIds":-7,"requiredPaths":["", " ok ", " " ]}\n```',
    );
    expect(result).toEqual({
      kind: 'structured',
      spec: {
        version: 1,
        requiredPaths: ['ok'],
        requiredTestFiles: undefined,
        minEvidenceIds: 0,
        requireUltraworkGraph: undefined,
      },
    });
  });

  it('rejects non-object JSON (array / null)', () => {
    expect(parseGoalPredicateCriterion('null')).toEqual({ kind: 'legacy', text: 'null' });
    expect(parseGoalPredicateCriterion('[1,2,3]')).toEqual({ kind: 'legacy', text: '[1,2,3]' });
  });
});
