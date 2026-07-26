import { describe, expect, it } from 'vitest';

import {
  MAX_INTERVIEW_ROUNDS,
  ULTRA_PLAN_REQUIRED_SECTIONS,
  ULTRA_PLAN_SECTION_GUIDANCE,
} from '../../../src/agent/plan/ultra-plan-section-guidance';

describe('plan/ultra-plan-section-guidance.ts — required sections', () => {
  it('pins the documented 10-section list in order', () => {
    expect([...ULTRA_PLAN_REQUIRED_SECTIONS]).toEqual([
      'goal',
      'actors',
      'inputs',
      'outputs',
      'constraints',
      'non_goals',
      'acceptance_criteria',
      'verification_plan',
      'failure_modes',
      'runtime_context',
    ]);
  });

  it('MAX_INTERVIEW_ROUNDS stays at 8 (soft cap, no Design-gate bypass)', () => {
    expect(MAX_INTERVIEW_ROUNDS).toBe(8);
  });

  it('ULTRA_PLAN_SECTION_GUIDANCE covers every required section', () => {
    for (const sec of ULTRA_PLAN_REQUIRED_SECTIONS) {
      const g = ULTRA_PLAN_SECTION_GUIDANCE[sec];
      expect(g.label.length).toBeGreaterThan(0);
      expect(g.askHint.length).toBeGreaterThan(0);
    }
  });

  it('each guidance label is the human-readable form of the snake_case key', () => {
    expect(ULTRA_PLAN_SECTION_GUIDANCE.acceptance_criteria.label).toBe('Acceptance Criteria');
    expect(ULTRA_PLAN_SECTION_GUIDANCE.verification_plan.label).toBe('Verification Plan');
    expect(ULTRA_PLAN_SECTION_GUIDANCE.failure_modes.label).toBe('Failure Modes');
  });
});
