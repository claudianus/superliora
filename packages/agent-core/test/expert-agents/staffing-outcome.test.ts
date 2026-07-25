import { afterEach, describe, expect, it } from 'vitest';

import {
  clearStaffingOutcomes,
  getOutcome,
  recordOutcome,
  recordOutcomesFromSwarmResults,
  scoreBoost,
} from '../../src/expert-agents/staffing-outcome';

afterEach(() => {
  clearStaffingOutcomes();
});

describe('staffing-outcome', () => {
  it('defaults scoreBoost to 1.0 with no history', () => {
    expect(scoreBoost('unknown-expert')).toBe(1);
  });

  it('records accepted outcomes and boosts score', () => {
    recordOutcome('exp-a', { accepted: true });
    recordOutcome('exp-a', { accepted: true });
    const record = getOutcome('exp-a');
    expect(record).toMatchObject({ accepted: 2, rejected: 0, samples: 2 });
    expect(scoreBoost('exp-a')).toBeGreaterThan(1);
  });

  it('penalizes rejections and conflicts', () => {
    recordOutcome('exp-b', { accepted: false, conflict: true });
    recordOutcome('exp-b', { accepted: false, conflict: true });
    expect(scoreBoost('exp-b')).toBeLessThan(1);
    expect(getOutcome('exp-b')?.conflicts).toBe(2);
  });

  it('applies a soft wastedTokens penalty', () => {
    recordOutcome('exp-c', { accepted: true, wastedTokens: 50_000 });
    const withWaste = scoreBoost('exp-c');
    clearStaffingOutcomes();
    recordOutcome('exp-c', { accepted: true, wastedTokens: 0 });
    const clean = scoreBoost('exp-c');
    expect(withWaste).toBeLessThan(clean);
  });

  it('rejects empty expertId', () => {
    expect(() => recordOutcome('  ', { accepted: true })).toThrow(/non-empty/);
  });

  it('recordOutcomesFromSwarmResults maps verdicts into priors', () => {
    recordOutcomesFromSwarmResults([
      { expertId: 'e-pass', verdict: 'PASS' },
      { expertId: 'e-fail', verdict: 'FAIL', status: 'completed' },
      { expertId: 'e-abort', verdict: 'ABORTED', status: 'aborted' },
    ]);
    expect(getOutcome('e-pass')).toMatchObject({ accepted: 1, rejected: 0 });
    expect(getOutcome('e-fail')).toMatchObject({ accepted: 0, rejected: 1, conflicts: 1 });
    expect(getOutcome('e-abort')?.samples).toBe(1);
    expect(scoreBoost('e-pass')).toBeGreaterThan(scoreBoost('e-fail'));
  });
});
