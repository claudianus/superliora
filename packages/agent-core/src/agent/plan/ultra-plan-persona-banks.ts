/** Thinking-persona prompt banks for Ultra Plan lateral thinking. */

import type { ThinkingPersona } from './ultra-plan-mode';

export const THINKING_PERSONA_SUMMARIES: Record<ThinkingPersona, string> = {
  hacker: 'Find unconventional workarounds and bypasses',
  researcher: 'Seek additional information and context',
  simplifier: 'Reduce complexity and challenge assumptions',
  architect: 'Restructure the approach fundamentally',
  contrarian: 'Challenge assumptions and invert the problem',
};

export const THINKING_PERSONA_QUESTION_BANKS: Record<ThinkingPersona, readonly string[]> = {
  hacker: [
    'What is the simplest workaround?',
    'What assumption can we bypass?',
    'What is the minimal viable fix?',
  ],
  researcher: [
    'What information are we missing?',
    'What similar problems have been solved?',
    'What documentation should we read?',
  ],
  simplifier: [
    'What can we remove without breaking it?',
    'What is the core problem, not the symptoms?',
    'Can we solve a smaller version first?',
  ],
  architect: [
    'What is the fundamental structure?',
    'How would we design this from scratch?',
    'What abstraction would clarify this?',
  ],
  contrarian: [
    'What if the opposite is true?',
    'What assumption is most dangerous?',
    'What would make this definitely fail?',
  ],
};

export function questionsForThinkingPersona(persona: ThinkingPersona): string[] {
  return [...THINKING_PERSONA_QUESTION_BANKS[persona]];
}
