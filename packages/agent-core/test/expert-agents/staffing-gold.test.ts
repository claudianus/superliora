import { describe, expect, it } from 'vitest';

import {
  STAFFING_GOLD_SEED,
  collectStaffingGoldLabels,
  meanNdcgAtK,
  ndcgAtK,
  staffingGoldCasesForLabel,
  staffingGoldLabelCoverage,
} from '../../src/expert-agents/staffing-gold';
import { ExpertSearchEngine } from '../../src/expert-agents/search';

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

  it('exports seed cases with catalog-backed relevantIds', async () => {
    expect(STAFFING_GOLD_SEED.length).toBeGreaterThanOrEqual(28);
    const engine = new ExpertSearchEngine();
    await engine.initialize();
    const nonEmpty = STAFFING_GOLD_SEED.filter((c) => c.relevantIds.length > 0);
    expect(nonEmpty.length).toBeGreaterThanOrEqual(28);
    for (const gold of nonEmpty) {
      for (const id of gold.relevantIds) {
        expect(
          engine.getExpertById(id),
          `missing search-catalog id ${id} in case ${gold.id}`,
        ).toBeDefined();
      }
    }
    const ids = new Set(STAFFING_GOLD_SEED.map((c) => c.id));
    expect(ids.has('product-pm')).toBe(true);
    expect(ids.has('sre-observability')).toBe(true);
    expect(ids.has('ml-llm')).toBe(true);
    expect(ids.has('finance-fpa')).toBe(true);
    expect(ids.has('cloud-infra')).toBe(true);
    expect(ids.has('accessibility')).toBe(true);
    expect(ids.has('multi-agent-systems')).toBe(true);
  });

  it('labels domain cases for offline catalog coverage benches', () => {
    const labeled = STAFFING_GOLD_SEED.filter(
      (c) => c.labels !== undefined && c.labels.length > 0,
    );
    expect(labeled.length).toBe(STAFFING_GOLD_SEED.length);
    const allLabels = new Set(collectStaffingGoldLabels());
    for (const required of [
      'Finance',
      'Marketing',
      'Sales',
      'Support',
      'Game Dev',
      'Privacy',
      'Cloud',
      'Accessibility',
    ]) {
      expect(allLabels.has(required), `missing label ${required}`).toBe(true);
    }
    expect(
      staffingGoldLabelCoverage([
        'Finance',
        'Marketing',
        'Sales',
        'Support',
        'Game Dev',
        'Privacy',
        'Cloud',
        'Accessibility',
      ]),
    ).toBe(1);
    expect(staffingGoldCasesForLabel('Finance').some((c) => c.id === 'finance-fpa')).toBe(true);
    expect(staffingGoldCasesForLabel('Cloud').some((c) => c.id === 'cloud-infra')).toBe(true);
  });

  it('scores live ExpertSearchEngine ranks above an nDCG@10 floor', async () => {
    const engine = new ExpertSearchEngine();
    await engine.initialize();
    const k = 10;
    const scored = STAFFING_GOLD_SEED.filter((gold) => gold.relevantIds.length > 0).map((gold) => {
      const rankedIds = engine
        .search({ query: gold.query, topK: k, useEmbedding: false })
        .map((hit) => hit.expert.id);
      return { rankedIds, gold };
    });
    expect(scored.length).toBeGreaterThanOrEqual(28);
    const mean = meanNdcgAtK(scored, k);
    // Offline regression floor: catch ranking/query regressions without flaking on embeddings.
    expect(mean).toBeGreaterThanOrEqual(0.90);
    const zeros = scored.filter((row) => ndcgAtK(row.rankedIds, row.gold.relevantIds, k) <= 0);
    expect(zeros.map((row) => row.gold.id)).toEqual([]);
  });
});
