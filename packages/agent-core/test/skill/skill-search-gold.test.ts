import { describe, expect, it } from 'vitest';

import { meanNdcgAtK, ndcgAtK } from '../../src/expert-agents/staffing-gold';
import { SkillSearchEngine } from '../../src/skill/expert-search';
import type { SkillDefinition } from '../../src/skill/types';

function skill(partial: {
  name: string;
  description: string;
  whenToUse?: string;
  catalogId: string;
}): SkillDefinition {
  return {
    name: partial.name,
    description: partial.description,
    path: `/tmp/skills/${partial.catalogId}/SKILL.md`,
    dir: `/tmp/skills/${partial.catalogId}`,
    content: '',
    source: 'builtin',
    metadata: {
      whenToUse: partial.whenToUse ?? '',
      catalogId: partial.catalogId,
    },
  };
}

const FIXTURE_SKILLS: readonly SkillDefinition[] = [
  skill({
    name: 'premium-visual',
    catalogId: 'fixture-premium-visual',
    description: 'Art direction, typography, craft audit for shipping UI surfaces',
    whenToUse: 'Before shipping visible web UI or game canvas polish',
  }),
  skill({
    name: 'git-hygiene',
    catalogId: 'fixture-git-hygiene',
    description: 'Prune stale worktrees and merged liora branches',
    whenToUse: 'After parallel agent runs leave dirty worktrees',
  }),
  skill({
    name: 'playwright-smoke',
    catalogId: 'fixture-playwright-smoke',
    description: 'Browser interaction smoke and VerifySurface scenarios',
    whenToUse: 'When validating click paths on interactive pages',
  }),
  skill({
    name: 'finance-fpa',
    catalogId: 'fixture-finance-fpa',
    description: 'Financial planning models and variance analysis',
    whenToUse: 'Board packs and FP&A forecasting',
  }),
];

const SKILL_GOLD = [
  {
    id: 'ui-craft',
    query: 'UI craft art direction typography shipping visual surface',
    relevantIds: ['fixture-premium-visual'],
  },
  {
    id: 'browser-smoke',
    query: 'playwright click interaction VerifySurface browser smoke',
    relevantIds: ['fixture-playwright-smoke'],
  },
  {
    id: 'worktree-cleanup',
    query: 'prune stale worktrees merged branches hygiene',
    relevantIds: ['fixture-git-hygiene'],
  },
] as const;

describe('local playbook search', () => {
  it('ranks a project auto skill above a catalog fixture on trigger keywords', async () => {
    const { SessionSkillRegistry } = await import('../../src/skill/registry');
    const registry = new SessionSkillRegistry({ disableCatalogLoad: true });
    registry.register({
      name: 'playwright-smoke',
      description: 'Browser interaction smoke and VerifySurface scenarios',
      path: '/catalog/playwright-smoke/SKILL.md',
      dir: '/catalog/playwright-smoke',
      content: '',
      source: 'builtin',
      metadata: { catalogId: 'fixture-playwright-smoke' },
    });
    registry.register(
      {
        name: 'windows-pnpm-e2e-spawn',
        description:
          'Windows pnpm e2e hits spawn EPERM; run via node scripts/test-local.mjs. Use when Windows e2e, pnpm test, spawn EPERM, or test-local runner.',
        path: '/repo/.agents/skills/auto/windows-pnpm-e2e-spawn/SKILL.md',
        dir: '/repo/.agents/skills/auto/windows-pnpm-e2e-spawn',
        content: '',
        source: 'project',
        metadata: {
          whenToUse: 'Windows e2e spawn EPERM',
          triggers: ['windows e2e', 'spawn EPERM', 'test-local'],
        },
      },
      { replace: true },
    );

    const hits = await registry.searchByQuery('windows e2e spawn EPERM test-local', 5);
    expect(hits[0]?.name).toBe('windows-pnpm-e2e-spawn');
    expect(hits[0]?.fresh).toBe(true);
    expect(hits[0]?.matchReason).toMatch(/local playbook/);
  });
});

describe('SkillSearchEngine gold nDCG', () => {
  it('hybrid ranks fixture skills at or above sparse nDCG@3', async () => {
    const engine = new SkillSearchEngine();
    engine.initialize(FIXTURE_SKILLS);
    const nameToCatalog = new Map(
      FIXTURE_SKILLS.map((entry) => [entry.name, String(entry.metadata['catalogId'])]),
    );
    const k = 3;
    const sparseScored = [];
    const hybridScored = [];
    for (const gold of SKILL_GOLD) {
      const sparse = await engine.search({ query: gold.query, topK: k, useEmbedding: false });
      const hybrid = await engine.search({ query: gold.query, topK: k });
      const goldMeta = {
        id: gold.id,
        query: gold.query,
        relevantIds: [...gold.relevantIds],
      };
      sparseScored.push({
        rankedIds: sparse.map((hit) => nameToCatalog.get(hit.name) ?? hit.name),
        gold: goldMeta,
      });
      hybridScored.push({
        rankedIds: hybrid.map((hit) => nameToCatalog.get(hit.name) ?? hit.name),
        gold: goldMeta,
      });
    }
    const sparseMean = meanNdcgAtK(sparseScored, k);
    const hybridMean = meanNdcgAtK(hybridScored, k);
    expect(sparseMean).toBeGreaterThanOrEqual(0.9);
    expect(hybridMean).toBeGreaterThanOrEqual(sparseMean - 0.05);
    expect(
      hybridScored
        .filter((row) => ndcgAtK(row.rankedIds, row.gold.relevantIds, k) <= 0)
        .map((row) => row.gold.id),
    ).toEqual([]);
  });
});
