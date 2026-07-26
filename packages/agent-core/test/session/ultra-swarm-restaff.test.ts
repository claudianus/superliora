import type { ExpertSwarmPlan } from '../../src/expert-agents/types';
import { describe, expect, it } from 'vitest';

import {
  buildRestaffReflectionPrompt,
  collectRestaffGaps,
  filterRestaffPlan,
  needsRestaffing,
  restaffPhaseForGaps,
  restaffSlotsAvailable,
  shouldPlanRestaffWave,
  type RestaffGapResult,
} from '../../src/session/ultra-swarm-restaff';

const GAP: RestaffGapResult = {
  expertId: 'e-1',
  expertName: 'reviewer',
  phase: 'review',
  verdict: 'REVISE',
  summary: 'looks unfinished',
};

function makePlan(expertIds: readonly string[]): ExpertSwarmPlan {
  return {
    taskDescription: 't',
    strategy: 'parallel',
    experts: expertIds.map((expertId) => ({
      expertId,
      expertName: expertId,
      role: 'implementer' as const,
      phase: 'implement' as const,
    })),
  };
}

describe('ultra-swarm-restaff.ts — needsRestaffing / shouldPlanRestaffWave', () => {
  it('needsRestaffing returns false when there are no gaps or no free slots', () => {
    expect(needsRestaffing([], 0, 4)).toBe(false);
    expect(needsRestaffing([GAP], 4, 4)).toBe(false);
  });

  it('needsRestaffing returns true when at least one gap has a non-PASS verdict', () => {
    const passGap: RestaffGapResult = { ...GAP, verdict: 'PASS' };
    expect(needsRestaffing([passGap, GAP], 2, 4)).toBe(true);
  });

  it('needsRestaffing returns false when every gap already PASSes', () => {
    expect(needsRestaffing([{ ...GAP, verdict: 'PASS' }], 2, 4)).toBe(false);
  });

  it('shouldPlanRestaffWave short-circuits to false when no slot is available', () => {
    expect(
      shouldPlanRestaffWave({ forceRestaff: true, gaps: [GAP], staffedCount: 4, maxExperts: 4 }),
    ).toBe(false);
  });

  it('shouldPlanRestaffWave returns true for force regardless of gaps', () => {
    expect(
      shouldPlanRestaffWave({ forceRestaff: true, gaps: [], staffedCount: 2, maxExperts: 4 }),
    ).toBe(true);
  });

  it('shouldPlanRestaffWave falls back to needsRestaffing in soft mode', () => {
    expect(
      shouldPlanRestaffWave({ forceRestaff: false, gaps: [GAP], staffedCount: 2, maxExperts: 4 }),
    ).toBe(true);
    expect(
      shouldPlanRestaffWave({ forceRestaff: false, gaps: [], staffedCount: 2, maxExperts: 4 }),
    ).toBe(false);
  });
});

describe('ultra-swarm-restaff.ts — collectRestaffGaps / buildRestaffReflectionPrompt', () => {
  it('collects only required + completed + non-PASS gaps', () => {
    const out = collectRestaffGaps([
      {
        spec: { expertId: 'a', expertName: 'A', phase: 'review', requiredForCompletion: true },
        verdict: 'REVISE',
        status: 'completed',
        result: 'needs more work',
      },
      {
        spec: { expertId: 'b', expertName: 'B', phase: 'review', requiredForCompletion: true },
        verdict: 'PASS',
        status: 'completed',
        result: 'all good',
      },
      {
        spec: { expertId: 'c', expertName: 'C', phase: 'review', requiredForCompletion: false },
        verdict: 'REVISE',
        status: 'completed',
        result: 'optional',
      },
      {
        spec: { expertId: 'd', expertName: 'D', phase: 'review', requiredForCompletion: true },
        verdict: 'BLOCK',
        status: 'failed',
        result: 'never ran',
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.expertId).toBe('a');
    expect(out[0]?.summary).toBe('needs more work');
  });

  it('falls back to the error message when result is missing', () => {
    const out = collectRestaffGaps([
      {
        spec: { expertId: 'a', expertName: 'A', phase: 'review', requiredForCompletion: true },
        verdict: 'BLOCK',
        status: 'completed',
        error: 'something broke',
      },
    ]);
    expect(out[0]?.summary).toBe('something broke');
  });

  it('buildRestaffReflectionPrompt renders the gap lines + optional bus digest', () => {
    const prompt = buildRestaffReflectionPrompt('ship feature X', [GAP], 'digest line');
    expect(prompt).toContain('ship feature X');
    expect(prompt).toContain('- reviewer (e-1) review REVISE: looks unfinished');
    expect(prompt).toContain('Recent swarm bus digest:\ndigest line');
  });

  it('buildRestaffReflectionPrompt omits the bus digest line when missing', () => {
    const prompt = buildRestaffReflectionPrompt('t', [GAP]);
    expect(prompt).not.toContain('Recent swarm bus digest');
  });
});

describe('ultra-swarm-restaff.ts — filterRestaffPlan / slots / phase', () => {
  it('filterRestaffPlan removes excluded experts and caps the count at min(slots, 2)', () => {
    const plan = makePlan(['a', 'b', 'c', 'd']);
    const out = filterRestaffPlan(plan, ['b'], 1);
    expect(out.experts.map((e) => e.expertId)).toEqual(['a']);
    expect(out.strategy).toBe('sequential');
  });

  it('filterRestaffPlan returns a sequential plan when only one expert survives', () => {
    const plan = makePlan(['a', 'b', 'c']);
    const out = filterRestaffPlan(plan, ['a', 'b'], 4);
    expect(out.experts).toHaveLength(1);
    expect(out.strategy).toBe('sequential');
  });

  it('filterRestaffPlan returns a parallel plan when 2+ experts survive', () => {
    const plan = makePlan(['a', 'b', 'c']);
    const out = filterRestaffPlan(plan, ['c'], 4);
    expect(out.strategy).toBe('parallel');
  });

  it('restaffSlotsAvailable caps the free slots at 2 (RESTAFF_MAX_NEW_EXPERTS)', () => {
    expect(restaffSlotsAvailable(0, 10)).toBe(2);
    expect(restaffSlotsAvailable(8, 10)).toBe(2);
    expect(restaffSlotsAvailable(9, 10)).toBe(1);
    expect(restaffSlotsAvailable(10, 10)).toBe(0);
  });

  it('restaffPhaseForGaps returns "implement" when any gap is in the implement or plan phase', () => {
    expect(
      restaffPhaseForGaps([GAP, { ...GAP, phase: 'implement' }]),
    ).toBe('implement');
    expect(restaffPhaseForGaps([GAP, { ...GAP, phase: 'plan' }])).toBe('implement');
  });

  it('restaffPhaseForGaps returns "review" when all gaps are review-only', () => {
    expect(restaffPhaseForGaps([GAP, { ...GAP, phase: 'review' }])).toBe('review');
  });
});
