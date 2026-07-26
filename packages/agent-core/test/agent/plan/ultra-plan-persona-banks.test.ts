import { describe, expect, it } from 'vitest';

import {
  questionsForThinkingPersona,
  THINKING_PERSONA_QUESTION_BANKS,
  THINKING_PERSONA_SUMMARIES,
} from '#/agent/plan/ultra-plan-persona-banks';

describe('agent/plan/ultra-plan-persona-banks — thinking persona banks', () => {
  it('exposes a summary for every persona in the bank', () => {
    for (const persona of Object.keys(THINKING_PERSONA_QUESTION_BANKS) as Array<
      keyof typeof THINKING_PERSONA_QUESTION_BANKS
    >) {
      expect(typeof THINKING_PERSONA_SUMMARIES[persona]).toBe('string');
      expect(THINKING_PERSONA_SUMMARIES[persona].length).toBeGreaterThan(0);
    }
  });

  it('exposes at least 3 questions per persona', () => {
    for (const persona of Object.keys(THINKING_PERSONA_QUESTION_BANKS) as Array<
      keyof typeof THINKING_PERSONA_QUESTION_BANKS
    >) {
      expect(THINKING_PERSONA_QUESTION_BANKS[persona].length).toBeGreaterThanOrEqual(3);
    }
  });

  it('returns a fresh copy of the questions for each call', () => {
    const a = questionsForThinkingPersona('hacker');
    const b = questionsForThinkingPersona('hacker');
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    a.push('mutated');
    expect(questionsForThinkingPersona('hacker')).not.toContain('mutated');
  });

  it('mirrors the bank entries for every persona', () => {
    for (const persona of Object.keys(THINKING_PERSONA_QUESTION_BANKS) as Array<
      keyof typeof THINKING_PERSONA_QUESTION_BANKS
    >) {
      expect(questionsForThinkingPersona(persona)).toEqual([
        ...THINKING_PERSONA_QUESTION_BANKS[persona],
      ]);
    }
  });
});
