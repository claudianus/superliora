import { describe, expect, it } from 'vitest';

import {
  GOAL_PREDICATE_VERSION,
  parseGoalPredicateCriterion,
} from '../../../src/agent/goal/predicate';

describe('agent/goal/predicate.ts — parseGoalPredicateCriterion', () => {
  it('returns kind=empty for undefined or whitespace-only text', () => {
    expect(parseGoalPredicateCriterion(undefined)).toEqual({ kind: 'empty' });
    expect(parseGoalPredicateCriterion('')).toEqual({ kind: 'empty' });
    expect(parseGoalPredicateCriterion('   \n')).toEqual({ kind: 'empty' });
  });

  it('parses a goal-predicate fence (case-insensitive)', () => {
    const r = parseGoalPredicateCriterion(
      '```GOAL-PREDICATE\n{"version":1,"requiredPaths":["src/a.ts"]}\n```',
    );
    expect(r.kind).toBe('structured');
    if (r.kind === 'structured') {
      expect(r.spec.requiredPaths).toEqual(['src/a.ts']);
      expect(r.spec.version).toBe(GOAL_PREDICATE_VERSION);
    }
  });

  it('parses a JSON fence (with the `json` tag) too', () => {
    const r = parseGoalPredicateCriterion('```json\n{"version":1,"minEvidenceIds":3}\n```');
    expect(r.kind).toBe('structured');
    if (r.kind === 'structured') {
      expect(r.spec.minEvidenceIds).toBe(3);
    }
  });

  it('parses the inline `predicate:v1:` prefix', () => {
    const r = parseGoalPredicateCriterion('predicate:v1:{"version":1,"minEvidenceIds":2}');
    expect(r.kind).toBe('structured');
    if (r.kind === 'structured') {
      expect(r.spec.minEvidenceIds).toBe(2);
    }
  });

  it('parses a raw JSON object that starts with `{`', () => {
    const r = parseGoalPredicateCriterion('{"version":1,"requiredTestFiles":["a.test.ts"]}');
    expect(r.kind).toBe('structured');
    if (r.kind === 'structured') {
      expect(r.spec.requiredTestFiles).toEqual(['a.test.ts']);
    }
  });

  it('returns kind=legacy for free-form prose', () => {
    const r = parseGoalPredicateCriterion('ship a TUI that lists files');
    expect(r.kind).toBe('legacy');
    if (r.kind === 'legacy') expect(r.text).toBe('ship a TUI that lists files');
  });

  it('falls back to legacy when the embedded JSON version does not match', () => {
    const r = parseGoalPredicateCriterion('```json\n{"version":2}\n```');
    expect(r.kind).toBe('legacy');
  });

  it('trims whitespace inside string array entries and drops empty ones', () => {
    const r = parseGoalPredicateCriterion(
      '```json\n{"version":1,"requiredPaths":["  src/a.ts  ","","  "]}\n```',
    );
    expect(r.kind).toBe('structured');
    if (r.kind === 'structured') {
      expect(r.spec.requiredPaths).toEqual(['src/a.ts']);
    }
  });

  it('clamps negative minEvidenceIds to 0 and accepts floats (Math.floor)', () => {
    const r = parseGoalPredicateCriterion('{"version":1,"minEvidenceIds":-1.7}');
    expect(r.kind).toBe('structured');
    if (r.kind === 'structured') {
      expect(r.spec.minEvidenceIds).toBe(0);
    }
  });

  it('ignores non-string entries when normalizing string arrays', () => {
    const r = parseGoalPredicateCriterion(
      '```json\n{"version":1,"requiredPaths":["a.ts", 1, null, "b.ts"]}\n```',
    );
    expect(r.kind).toBe('structured');
    if (r.kind === 'structured') {
      expect(r.spec.requiredPaths).toEqual(['a.ts', 'b.ts']);
    }
  });

});
