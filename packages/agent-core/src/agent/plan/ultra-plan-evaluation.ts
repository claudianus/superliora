/**
 * Pure default Evaluation Plan builder for Ultra Plan.
 */

import type { EvaluationPlan } from './ultra-plan-mode';

export function buildDefaultEvaluationPlan(): EvaluationPlan {
  return {
    stage1Mechanical: true,
    stage2Semantic: true,
    stage3Consensus: false,
    mechanicalChecks: ['lint', 'build', 'test', 'static_analysis', 'coverage'],
    semanticCriteria: ['ac_compliance', 'code_quality', 'maintainability'],
  };
}
