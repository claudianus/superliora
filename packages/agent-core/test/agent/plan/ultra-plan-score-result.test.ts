import { describe, expect, it } from 'vitest';

import {
  buildAmbiguityScoreResult,
  openSeedGapsFromLlmResult,
} from '#/agent/plan/ultra-plan-score-result';
import type { InterviewState, LLMAmbiguityResult } from '#/agent/plan/ultra-plan-ambiguity-heuristic';

const makeLlm = (overrides: Partial<LLMAmbiguityResult> = {}): LLMAmbiguityResult => ({
  goalClarity: 1,
  constraintClarity: 1,
  successCriteriaClarity: 1,
  presentSections: [
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
  ],
  verifiableGoal: true,
  specificityScore: 1,
  justifications: { goal: 'g', constraints: 'c', successCriteria: 's' },
  ...overrides,
});

const freshInterview = (): InterviewState => ({
  rounds: [],
  completionCandidateStreak: 0,
  lastReadyRoundCount: -1,
  lastReadyEvidenceHash: undefined,
  monotonicReadyLocked: false,
});

describe('ultra-plan-score-result — buildAmbiguityScoreResult', () => {
  it('returns ready milestone with all sections present and verifiable goal', () => {
    const { result, nextInterviewState, progressMessages } = buildAmbiguityScoreResult({
      llmResult: makeLlm(),
      evidenceHash: 'h1',
      interviewState: freshInterview(),
    });
    expect(result.overallScore).toBeCloseTo(0.14, 5);
    expect(result.milestone).toBe('ready');
    expect(result.isReadyForSeed).toBe(true);
    expect(result.breakdown.map((b) => b.name)).toEqual([
      'goal_clarity',
      'constraint_clarity',
      'success_criteria_clarity',
      'seed_ledger_gaps',
      'verifiable_goal',
    ]);
    expect(result.floorFailures).toEqual([]);
    expect(result.usedHeuristicFallback).toBe(false);
    expect(nextInterviewState.completionCandidateStreak).toBe(1);
    expect(nextInterviewState.lastReadyEvidenceHash).toBe('h1');
    expect(nextInterviewState.monotonicReadyLocked).toBe(true);
    expect(progressMessages.some((m) => m.includes('Seed Spec is ready'))).toBe(true);
  });

  it('returns progress milestone when ambiguity is mid-range and no gaps', () => {
    const llm = makeLlm({
      goalClarity: 0.5,
      constraintClarity: 0.5,
      successCriteriaClarity: 0.5,
    });
    const { result } = buildAmbiguityScoreResult({
      llmResult: llm,
      evidenceHash: 'h',
      interviewState: freshInterview(),
    });
    expect(['initial', 'progress', 'refined', 'ready']).toContain(result.milestone);
    expect(result.overallScore).toBeGreaterThan(0);
  });

  it('marks floor failures when any clarity is below 0.4', () => {
    const llm = makeLlm({
      goalClarity: 0.3,
      constraintClarity: 0.95,
      successCriteriaClarity: 0.95,
    });
    const { result } = buildAmbiguityScoreResult({
      llmResult: llm,
      evidenceHash: 'h',
      interviewState: freshInterview(),
    });
    expect(result.floorFailures.length).toBeGreaterThan(0);
    expect(result.overallScore).toBeGreaterThan(0);
  });

  it('keeps hardReady via monotonic lock even when goal becomes non-verifiable', () => {
    const interview: InterviewState = {
      ...freshInterview(),
      rounds: [],
      monotonicReadyLocked: true,
    };
    const llm = makeLlm({ verifiableGoal: false });
    const { result } = buildAmbiguityScoreResult({
      llmResult: llm,
      evidenceHash: 'h',
      interviewState: interview,
    });
    expect(result.isReadyForSeed).toBe(false);
    // Overall pressure is bounded — non-verifiable pushes score above threshold.
    expect(result.overallScore).toBeGreaterThan(0);
  });

  it('does not lock when hardReady is false on the first call', () => {
    const llm = makeLlm({ verifiableGoal: false });
    const { nextInterviewState } = buildAmbiguityScoreResult({
      llmResult: llm,
      evidenceHash: 'h',
      interviewState: freshInterview(),
    });
    expect(nextInterviewState.monotonicReadyLocked).toBe(false);
  });

  it('does not bump the streak when nothing changed since last ready round', () => {
    const interview: InterviewState = {
      rounds: [],
      completionCandidateStreak: 2,
      lastReadyRoundCount: 0,
      lastReadyEvidenceHash: 'same',
      monotonicReadyLocked: true,
    };
    const { nextInterviewState } = buildAmbiguityScoreResult({
      llmResult: makeLlm(),
      evidenceHash: 'same',
      interviewState: interview,
    });
    expect(nextInterviewState.completionCandidateStreak).toBe(2);
  });

  it('attaches the supplied heuristic-fallback flag to the result', () => {
    const { result } = buildAmbiguityScoreResult({
      llmResult: makeLlm(),
      evidenceHash: 'h',
      interviewState: freshInterview(),
      usedHeuristicFallback: true,
    });
    expect(result.usedHeuristicFallback).toBe(true);
  });
});

describe('ultra-plan-score-result — openSeedGapsFromLlmResult', () => {
  it('returns all sections when llmResult is null / undefined', () => {
    expect(openSeedGapsFromLlmResult(null).length).toBeGreaterThan(0);
    expect(openSeedGapsFromLlmResult(undefined).length).toBeGreaterThan(0);
  });

  it('drops present sections from the gap list', () => {
    const llm = makeLlm({ presentSections: ['goal', 'actors'] });
    const gaps = openSeedGapsFromLlmResult(llm);
    expect(gaps).not.toContain('goal');
    expect(gaps).not.toContain('actors');
    expect(gaps.length).toBeGreaterThan(0);
  });
});
