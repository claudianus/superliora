/**
 * Interview perspective descriptions for Ultra Plan.
 */

import type { InterviewPerspective } from './ultra-plan-mode';

export const INTERVIEW_PERSPECTIVE_DESCRIPTIONS: Record<InterviewPerspective, string> = {
  researcher:
    'Explore industry and technical context. Surface benchmarks, best practices, and opportunities the user may not know exist.',
  simplifier:
    'Contrast MVP vs premium scope. Show what to cut vs what unlocks disproportionate value with modest extra effort.',
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
