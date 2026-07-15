/**
 * Pure lateral-thinking prompt builder for Ultra Plan.
 */

import {
  THINKING_PERSONA_SUMMARIES,
  questionsForThinkingPersona,
} from './ultra-plan-persona-banks';
import type { LateralThinkingResult, ThinkingPersona } from './ultra-plan-mode';

export function buildLateralThinkingResult(
  persona: ThinkingPersona,
  problemContext: string,
  currentApproach: string,
): LateralThinkingResult {
  const prompt = `You are acting as a ${persona}.
${THINKING_PERSONA_SUMMARIES[persona]}.

Problem context: ${problemContext}
Current approach: ${currentApproach}

Generate an alternative approach from this perspective. Be specific and actionable.`;
  return {
    persona,
    prompt,
    approachSummary: THINKING_PERSONA_SUMMARIES[persona],
    questions: questionsForThinkingPersona(persona),
  };
}
