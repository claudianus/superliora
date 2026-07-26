import { describe, expect, it } from 'vitest';

import { buildDefaultEvaluationPlan } from '#/agent/plan/ultra-plan-evaluation';

describe('ultra-plan-evaluation — buildDefaultEvaluationPlan', () => {
  it('returns the pinned default Evaluation Plan', () => {
    expect(buildDefaultEvaluationPlan()).toEqual({
      stage1Mechanical: true,
      stage2Semantic: true,
      stage3Consensus: false,
      mechanicalChecks: ['lint', 'build', 'test', 'static_analysis', 'coverage'],
      semanticCriteria: ['ac_compliance', 'code_quality', 'maintainability'],
    });
  });

  it('returns a fresh object on every call (no shared mutable state)', () => {
    const a = buildDefaultEvaluationPlan();
    const b = buildDefaultEvaluationPlan();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
