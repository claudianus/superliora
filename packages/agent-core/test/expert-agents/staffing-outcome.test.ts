import { afterEach, describe, expect, it } from 'vitest';

import {
  clearStaffingOutcomes,
  getOutcome,
  recordOutcome,
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
});
