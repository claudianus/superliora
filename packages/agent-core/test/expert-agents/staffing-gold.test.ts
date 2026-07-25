import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { meanNdcgAtK, ndcgAtK, STAFFING_GOLD_SEED } from '../../src/expert-agents/staffing-gold';

const catalogPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../src/expert-agents/catalog-personas.json',
);

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

  it('exports seed cases with catalog-backed relevantIds', () => {
    expect(STAFFING_GOLD_SEED.length).toBeGreaterThanOrEqual(8);
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as Record<string, unknown>;
    const nonEmpty = STAFFING_GOLD_SEED.filter((c) => c.relevantIds.length > 0);
    expect(nonEmpty.length).toBeGreaterThanOrEqual(8);
    for (const gold of nonEmpty) {
      for (const id of gold.relevantIds) {
        expect(catalog[id], `missing catalog id ${id} in case ${gold.id}`).toBeDefined();
      }
    }
  });
});
