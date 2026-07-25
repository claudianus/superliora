import { describe, expect, it } from 'vitest';

import { meanNdcgAtK, ndcgAtK, STAFFING_GOLD_SEED } from '../../src/expert-agents/staffing-gold';

describe('staffing-gold nDCG', () => {
  it('scores perfect ranking as 1', () => {
    expect(ndcgAtK(['a', 'b', 'c'], ['a', 'b'], 5)).toBeCloseTo(1, 5);
  });

  it('scores empty gold as 0', () => {
    expect(ndcgAtK(['a'], [], 5)).toBe(0);
  });

  it('penalizes relevant hit lower in list', () => {
    const perfect = ndcgAtK(['a', 'x'], ['a'], 5);
    const worse = ndcgAtK(['x', 'a'], ['a'], 5);
    expect(perfect).toBeGreaterThan(worse);
  });

  it('meanNdcgAtK averages cases', () => {
    const mean = meanNdcgAtK(
      [
        { rankedIds: ['a'], gold: { id: '1', query: 'q', relevantIds: ['a'] } },
        { rankedIds: ['b'], gold: { id: '2', query: 'q', relevantIds: ['a'] } },
      ],
      5,
    );
    expect(mean).toBeGreaterThan(0);
    expect(mean).toBeLessThan(1);
  });

  it('exports seed cases', () => {
    expect(STAFFING_GOLD_SEED.length).toBeGreaterThan(0);
  });
});
