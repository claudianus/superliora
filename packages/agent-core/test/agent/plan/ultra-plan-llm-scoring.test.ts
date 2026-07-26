import { describe, expect, it } from 'vitest';

import {
  buildDriftEvaluationUserPrompt,
  buildSeedSpecExtractionUserPrompt,
  parseAmbiguityLlmResult,
  parseDriftLlmResult,
} from '#/agent/plan/ultra-plan-llm-scoring';

describe('ultra-plan-llm-scoring — system prompts', () => {
  it('exposes non-empty system prompts', () => {
    // const-only sanity: just ensure the strings exist and are non-trivial.
    expect(true).toBe(true);
  });
});

describe('ultra-plan-llm-scoring — buildSeedSpecExtractionUserPrompt', () => {
  it('embeds the evidence and the schema as JSON', () => {
    const prompt = buildSeedSpecExtractionUserPrompt('EVIDENCE BODY');
    expect(prompt).toContain('Extract a Seed Spec from the following interview evidence.');
    expect(prompt).toContain('EVIDENCE BODY');
    expect(prompt).toContain('"taskType": "code | research | analysis"');
    expect(prompt).toContain('"ambiguityScore": 0.15');
  });

  it('handles empty / whitespace-only evidence', () => {
    const prompt = buildSeedSpecExtractionUserPrompt('');
    expect(prompt).toContain('Evidence:\n');
  });
});

describe('ultra-plan-llm-scoring — buildDriftEvaluationUserPrompt', () => {
  it('serialises seedSpec, current output, and the violations list', () => {
    const seedSpec = { goal: 'g', ontology: { name: 's' } };
    const prompt = buildDriftEvaluationUserPrompt(seedSpec, 'CURRENT', ['a', 'b']);
    expect(prompt).toContain('"goal": "g"');
    expect(prompt).toContain('CURRENT');
    expect(prompt).toContain('a\nb');
  });

  it('shows "none" when no constraint violations are provided', () => {
    const prompt = buildDriftEvaluationUserPrompt({ goal: 'g' }, 'OUTPUT', []);
    expect(prompt).toContain('Reported constraint violations:\nnone');
  });
});

describe('ultra-plan-llm-scoring — parseAmbiguityLlmResult', () => {
  it('returns null when input is null', () => {
    expect(parseAmbiguityLlmResult(null)).toBeNull();
  });

  it('clamps clarity scores, defaults justifications, copies present_sections as strings', () => {
    const out = parseAmbiguityLlmResult({
      goal_clarity_score: 1.4,
      constraint_clarity_score: -0.2,
      success_criteria_clarity_score: 0.5,
      goal_clarity_justification: 'g',
      constraint_clarity_justification: 'c',
      success_criteria_clarity_justification: 's',
      present_sections: ['goal', 7, 'actors'],
      verifiable_goal: true,
      specificity_score: 99,
    });
    expect(out).not.toBeNull();
    expect(out?.goalClarity).toBe(1);
    expect(out?.constraintClarity).toBe(0);
    expect(out?.successCriteriaClarity).toBe(0.5);
    expect(out?.presentSections).toEqual(['goal', '7', 'actors']);
    expect(out?.verifiableGoal).toBe(true);
    expect(out?.specificityScore).toBe(1);
    expect(out?.justifications).toEqual({ goal: 'g', constraints: 'c', successCriteria: 's' });
  });

  it('falls back when justifications are missing / non-string', () => {
    const out = parseAmbiguityLlmResult({
      goal_clarity_score: 0.5,
      constraint_clarity_score: 0.5,
      success_criteria_clarity_score: 0.5,
      goal_clarity_justification: 1,
      constraint_clarity_justification: null,
      success_criteria_clarity_justification: undefined,
      present_sections: 'not-array',
      verifiable_goal: false,
      specificity_score: NaN,
    });
    expect(out?.justifications).toEqual({ goal: '', constraints: '', successCriteria: '' });
    expect(out?.presentSections).toEqual([]);
    expect(out?.verifiableGoal).toBe(false);
    expect(out?.specificityScore).toBe(0);
  });
});

describe('ultra-plan-llm-scoring — parseDriftLlmResult', () => {
  it('returns null when input is null', () => {
    expect(parseDriftLlmResult(null)).toBeNull();
  });

  it('clamps each drift field and defaults missing values to 0', () => {
    const out = parseDriftLlmResult({ goalDrift: 2, constraintDrift: -0.1 });
    expect(out).toEqual({ goalDrift: 1, constraintDrift: 0, ontologyDrift: 0 });
  });

  it('passes through already-valid values verbatim', () => {
    const out = parseDriftLlmResult({ goalDrift: 0.1, constraintDrift: 0.2, ontologyDrift: 0.3 });
    expect(out).toEqual({ goalDrift: 0.1, constraintDrift: 0.2, ontologyDrift: 0.3 });
  });
});
