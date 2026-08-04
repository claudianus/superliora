import { describe, expect, it } from 'vitest';

import {
  MAX_INTERVIEW_ROUNDS,
  ULTRA_PLAN_REQUIRED_SECTIONS,
  ULTRA_PLAN_SECTION_GUIDANCE,
  type UltraPlanRequiredSection,
} from '#/agent/plan/ultra-plan-section-guidance';

describe('agent/plan/ultra-plan-section-guidance — required sections + guidance', () => {
  it('lists the canonical 10 required seed sections in order', () => {
    expect(ULTRA_PLAN_REQUIRED_SECTIONS).toEqual([
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

  it('exposes a `label` and `askHint` for every required section', () => {
    for (const section of ULTRA_PLAN_REQUIRED_SECTIONS) {
      const entry = ULTRA_PLAN_SECTION_GUIDANCE[section];
      expect(typeof entry.label).toBe('string');
      expect(entry.label.length).toBeGreaterThan(0);
      expect(typeof entry.askHint).toBe('string');
      expect(entry.askHint.length).toBeGreaterThan(0);
    }
  });

  it('exposes a guidance entry exactly for the required sections (no more, no less)', () => {
    const guidanceKeys = Object.keys(ULTRA_PLAN_SECTION_GUIDANCE).toSorted();
    const required = [...ULTRA_PLAN_REQUIRED_SECTIONS].toSorted();
    expect(guidanceKeys).toEqual(required);
  });

  it('exposes MAX_INTERVIEW_ROUNDS as a positive soft cap', () => {
    expect(MAX_INTERVIEW_ROUNDS).toBe(5);
    expect(MAX_INTERVIEW_ROUNDS).toBeGreaterThan(0);
  });

  it('keeps `UltraPlanRequiredSection` aligned with the runtime list', () => {
    const runtime: readonly UltraPlanRequiredSection[] = ULTRA_PLAN_REQUIRED_SECTIONS;
    expect(runtime.length).toBe(10);
  });
});
