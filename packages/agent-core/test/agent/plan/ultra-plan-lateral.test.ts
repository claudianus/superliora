import { describe, expect, it } from 'vitest';

import { questionsForThinkingPersona, THINKING_PERSONA_QUESTION_BANKS, THINKING_PERSONA_SUMMARIES } from '../../../src/agent/plan/ultra-plan-persona-banks';

describe('plan/ultra-plan-persona-banks.ts — persona banks', () => {
  it('covers the 5 documented personas with summaries', () => {
    expect([...Object.keys(THINKING_PERSONA_SUMMARIES)].sort()).toEqual([
      'architect',
      'contrarian',
      'hacker',
      'researcher',
      'simplifier',
    ]);
    for (const summary of Object.values(THINKING_PERSONA_SUMMARIES)) {
      expect(summary.length).toBeGreaterThan(0);
    }
  });

  it('each persona has 3 questions in the bank', () => {
    for (const [persona, qs] of Object.entries(THINKING_PERSONA_QUESTION_BANKS)) {
      expect(qs.length, persona).toBe(3);
    }
  });

  it('questionsForThinkingPersona returns a copy (mutation-safe)', () => {
    const first = questionsForThinkingPersona('hacker');
    first.push('mutated');
    const second = questionsForThinkingPersona('hacker');
    expect(second).not.toContain('mutated');
  });
});
