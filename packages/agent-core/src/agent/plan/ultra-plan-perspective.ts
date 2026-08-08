/**
 * Interview perspective descriptions for Ultra Plan.
 */

import type { InterviewPerspective } from './ultra-plan-types';

export const INTERVIEW_PERSPECTIVE_DESCRIPTIONS: Record<InterviewPerspective, string> = {
  researcher:
    'Explore industry and technical context. Surface benchmarks, best practices, and opportunities the user may not know exist.',
  simplifier:
    'Contrast Baseline vs Upgrade payoff. Sequence agent slices; do not shrink the UltraGoal because a human calendar would look long.',
  architect:
    'Propose structural and pattern improvements. Focus on interfaces, maintainability, and long-term design quality.',
  'breadth-keeper':
    'Balance stretch goals vs non-goals. Catch missed quality dimensions, edge cases, and expansion opportunities.',
  'seed-closer':
    'Lock the elevated UltraGoal into measurable acceptance criteria and a verifiable completion test.',
};

export function getInterviewPerspectiveDescription(perspective: InterviewPerspective): string {
  return INTERVIEW_PERSPECTIVE_DESCRIPTIONS[perspective];
}
