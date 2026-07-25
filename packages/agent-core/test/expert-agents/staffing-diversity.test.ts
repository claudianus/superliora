import { describe, expect, it } from 'vitest';

import type { ExpertCatalogEntry, ExpertSearchResult } from '../../src/expert-agents/types';
import {
  applyStaffingDiversity,
  containsHangul,
  expertIdPrefix,
  formatSelectionReason,
  rewriteExpertSearchQuery,
} from '../../src/expert-agents/staffing-diversity';

function expert(
  id: string,
  division: string,
  overrides: Partial<ExpertCatalogEntry> = {},
): ExpertCatalogEntry {
  return {
    id,
    name: id,
    division,
    divisionLabel: division,
    divisionIcon: '•',
    divisionColor: '#fff',
    description: overrides.description ?? `${id} description`,
    color: '#fff',
    emoji: '🤖',
    vibe: 'steady',
    tags: overrides.tags ?? ['tag'],
    capabilities: ['code'],
    whenToUse: 'tests',
    personaText: '',
    ...overrides,
  };
}

function result(id: string, division: string, score: number): ExpertSearchResult {
  return { expert: expert(id, division), score };
}

describe('rewriteExpertSearchQuery', () => {
  it('appends English technical tokens for Hangul queries', () => {
    const rewritten = rewriteExpertSearchQuery('터미널 대시보드 렌더러 개선해주세요');
    expect(containsHangul(rewritten)).toBe(true);
    expect(rewritten.toLowerCase()).toContain('terminal');
    expect(rewritten.toLowerCase()).toContain('dashboard');
    expect(rewritten.toLowerCase()).toContain('renderer');
    expect(rewritten).not.toMatch(/해주세요/);
  });

  it('leaves English technical queries mostly intact', () => {
    const query = 'Improve terminal dashboard renderer TypeScript components';
    expect(rewriteExpertSearchQuery(query)).toBe(query);
  });
});

describe('applyStaffingDiversity', () => {
  it('caps experts per division and near-identical id prefixes', () => {
    const pool = [
      result('engineering-frontend-developer', 'engineering', 1.0),
      result('engineering-frontend-architect', 'engineering', 0.95),
      result('engineering-backend-developer', 'engineering', 0.9),
      result('design-ui-designer', 'design', 0.85),
      result('design-ux-researcher', 'design', 0.8),
      result('design-brand-designer', 'design', 0.75),
      result('testing-qa-engineer', 'testing', 0.7),
    ];

    const selected = applyStaffingDiversity(pool, 5, { maxPerDivision: 2 });
    expect(selected.length).toBeLessThanOrEqual(5);

    const engineering = selected.filter((item) => item.expert.division === 'engineering');
    expect(engineering.length).toBeLessThanOrEqual(2);

    const prefixes = selected.map((item) => expertIdPrefix(item.expert.id));
    // Prefer not selecting two with the same prefix when alternatives exist.
    const frontendPrefixCount = prefixes.filter((prefix) => prefix === 'engineering-frontend').length;
    expect(frontendPrefixCount).toBe(1);
  });

  it('fills remainder when diverse shortlist is short', () => {
    const pool = [
      result('engineering-a-one', 'engineering', 1),
      result('engineering-a-two', 'engineering', 0.9),
      result('engineering-a-three', 'engineering', 0.8),
    ];
    const selected = applyStaffingDiversity(pool, 3, { maxPerDivision: 2, fillRemainder: true });
    expect(selected.length).toBe(3);
  });
});

describe('formatSelectionReason', () => {
  it('includes score and division', () => {
    const reason = formatSelectionReason({
      expert: expert('engineering-frontend-developer', 'engineering', {
        divisionLabel: 'Engineering',
        description: 'Builds terminal UIs',
      }),
      score: 0.42,
      coverageLane: 'architecture_implementation',
    });
    expect(reason).toContain('score 0.420');
    expect(reason).toContain('Engineering');
    expect(reason).toContain('architecture_implementation');
    expect(reason).toContain('Builds terminal UIs');
  });
});
