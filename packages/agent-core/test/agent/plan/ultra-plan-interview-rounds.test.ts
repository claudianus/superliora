import { describe, expect, it } from 'vitest';

import {
  appendInterviewRoundState,
  formatInterviewAnswerText,
  formatInterviewQuestionText,
} from '#/agent/plan/ultra-plan-interview-rounds';
import type { InterviewState } from '#/agent/plan/ultra-plan-mode';

const freshState = (over: Partial<InterviewState> = {}): InterviewState => ({
  rounds: [],
  completionCandidateStreak: 0,
  lastReadyRoundCount: -1,
  lastReadyEvidenceHash: undefined,
  monotonicReadyLocked: false,
  consecutiveNonUserAnswers: 0,
  ...over,
});

describe('ultra-plan-interview-rounds — formatInterviewAnswerText', () => {
  it('joins entries as "key: value", rendering true as the literal "true"', () => {
    expect(
      formatInterviewAnswerText({
        goal: 'ship it',
        verifiable: true,
        notes: 'fast',
      }),
    ).toBe('goal: ship it\nverifiable: true\nnotes: fast');
  });

  it('returns an empty string for an empty object', () => {
    expect(formatInterviewAnswerText({})).toBe('');
  });
});

describe('ultra-plan-interview-rounds — formatInterviewQuestionText', () => {
  it('uses only the question when no header is supplied', () => {
    expect(formatInterviewQuestionText([{ question: 'Why?' }])).toBe('Why?');
  });

  it('renders "header: question" when header is non-empty', () => {
    expect(
      formatInterviewQuestionText([
        { question: 'Why?', header: 'Goal' },
        { question: 'How?' },
        { question: 'When?', header: '' },
      ]),
    ).toBe('Goal: Why?\nHow?\nWhen?');
  });
});

describe('ultra-plan-interview-rounds — appendInterviewRoundState', () => {
  it('appends a user-origin round and resets consecutiveNonUserAnswers', () => {
    const before = freshState({ consecutiveNonUserAnswers: 2 });
    const after = appendInterviewRoundState(before, 'Q?', 'A', 'user', 1000);
    expect(after.rounds).toHaveLength(1);
    expect(after.rounds[0]).toEqual({
      roundNumber: 1,
      question: 'Q?',
      userResponse: 'A',
      timestamp: 1000,
      origin: 'user',
    });
    expect(after.consecutiveNonUserAnswers).toBe(0);
  });

  it('appends a non-user-origin round and increments consecutiveNonUserAnswers', () => {
    const before = freshState({ consecutiveNonUserAnswers: 1 });
    const after = appendInterviewRoundState(before, 'Q?', 'A', 'code', 2000);
    expect(after.rounds).toHaveLength(1);
    expect(after.rounds[0].origin).toBe('code');
    expect(after.rounds[0].roundNumber).toBe(1);
    expect(after.consecutiveNonUserAnswers).toBe(2);
  });

  it('numbers rounds starting from the previous length + 1', () => {
    const before = freshState();
    const r1 = appendInterviewRoundState(before, 'q1', 'a1', 'user', 1);
    const r2 = appendInterviewRoundState(r1, 'q2', 'a2', 'user', 2);
    const r3 = appendInterviewRoundState(r2, 'q3', 'a3', 'auto', 3);
    expect(r3.rounds.map((r) => r.roundNumber)).toEqual([1, 2, 3]);
    expect(r3.rounds[2].origin).toBe('auto');
    expect(r3.consecutiveNonUserAnswers).toBe(1);
  });

  it('invalidates the LLM cache and unlocks monotonic ready on a new round', () => {
    const before = freshState({
      lastScoredEvidenceHash: 'h',
      cachedLlmResult: { ok: true } as never,
      monotonicReadyLocked: true,
    });
    const after = appendInterviewRoundState(before, 'Q', 'A', 'user', 9);
    expect(after.lastScoredEvidenceHash).toBeUndefined();
    expect(after.cachedLlmResult).toBeUndefined();
    expect(after.monotonicReadyLocked).toBe(false);
  });

  it('defaults origin to "user" and timestamp to Date.now()', () => {
    const before = freshState();
    const after = appendInterviewRoundState(before, 'Q', 'A');
    expect(after.rounds[0].origin).toBe('user');
    expect(typeof after.rounds[0].timestamp).toBe('number');
  });
});
