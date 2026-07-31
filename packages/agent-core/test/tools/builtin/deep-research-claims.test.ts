/**
 * Covers: DeepResearch citation + freshness gate helpers.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  applyCitationGate,
  applyFreshnessGate,
  buildClaimsFromSources,
  citationCoverageRatio,
  demoteConfidence,
  filterClaimsByFreshness,
  formatStructuredClaimLine,
  isSourceStaleForFreshness,
  meetsCitationCoverageGoldSet,
  parseResearchSourceDate,
  type ClaimSourceInput,
  type DeepResearchClaim,
} from '../../../src/tools/builtin/web/deep-research-claims';

const FIXTURE_DIR = dirname(fileURLToPath(import.meta.url));

interface ClaimsGoldFixture {
  freshness: 'any' | 'day' | 'week' | 'month' | 'year';
  referenceNow: string;
  minCoverage: number;
  sources: ClaimSourceInput[];
}

function loadGoldFixture(): ClaimsGoldFixture {
  const raw = readFileSync(join(FIXTURE_DIR, 'fixtures/deep-research-claims-gold.json'), 'utf8');
  return JSON.parse(raw) as ClaimsGoldFixture;
}

describe('demoteConfidence', () => {
  it('steps down the confidence ladder', () => {
    expect(demoteConfidence('high')).toBe('medium');
    expect(demoteConfidence('medium')).toBe('low');
    expect(demoteConfidence('low')).toBe('speculative');
    expect(demoteConfidence('speculative')).toBe('speculative');
  });
});

describe('applyCitationGate', () => {
  it('marks uncited claims as speculative', () => {
    const gated = applyCitationGate({
      claim: 'Unverified inference',
      sources: [],
      confidence: 'high',
    });
    expect(gated.confidence).toBe('speculative');
    expect(gated.sources).toEqual([]);
  });

  it('preserves cited claims', () => {
    const gated = applyCitationGate({
      claim: 'Cited fact',
      sources: ['https://example.com/a'],
      confidence: 'medium',
    });
    expect(gated.confidence).toBe('medium');
  });
});

describe('applyFreshnessGate', () => {
  const now = new Date('2026-07-31T12:00:00.000Z');

  it('demotes claims without as_of when freshness is set', () => {
    const gated = applyFreshnessGate(
      { claim: 'No date', sources: ['https://example.com/a'], confidence: 'high' },
      'week',
      now,
    );
    expect(gated.confidence).toBe('medium');
  });

  it('demotes stale dated claims more aggressively', () => {
    const gated = applyFreshnessGate(
      {
        claim: 'Old news',
        sources: ['https://example.com/old'],
        confidence: 'high',
        as_of: '2024-01-01',
      },
      'month',
      now,
    );
    expect(gated.confidence).toBe('low');
  });

  it('leaves fresh dated claims unchanged', () => {
    const gated = applyFreshnessGate(
      {
        claim: 'Recent',
        sources: ['https://example.com/new'],
        confidence: 'high',
        as_of: '2026-07-28',
      },
      'month',
      now,
    );
    expect(gated.confidence).toBe('high');
  });
});

describe('isSourceStaleForFreshness', () => {
  const now = new Date('2026-07-31T12:00:00.000Z');

  it('treats old dates as stale for week freshness', () => {
    const asOf = parseResearchSourceDate('2026-07-01', now);
    expect(asOf).toBeDefined();
    expect(isSourceStaleForFreshness(asOf, 'week', now)).toBe(true);
  });

  it('ignores staleness when freshness is any', () => {
    const asOf = parseResearchSourceDate('2020-01-01', now);
    expect(isSourceStaleForFreshness(asOf, 'any', now)).toBe(false);
  });
});

describe('buildClaimsFromSources', () => {
  it('assigns base confidence from hit count and dates', () => {
    const claims = buildClaimsFromSources([
      {
        title: 'A',
        url: 'https://example.com/a',
        snippet: 'Corroborated fact',
        date: '2026-07-01',
        hitCount: 2,
      },
      {
        title: 'B',
        url: 'https://example.com/b',
        snippet: 'Single hit with date',
        date: '2026-07-02',
        hitCount: 1,
      },
      {
        title: 'C',
        url: 'https://example.com/c',
        snippet: 'Single hit without date',
        hitCount: 1,
      },
    ]);

    expect(claims[0]?.confidence).toBe('high');
    expect(claims[1]?.confidence).toBe('medium');
    expect(claims[2]?.confidence).toBe('low');
  });

  it('filters stale speculative claims when freshness is set', () => {
    const now = new Date('2026-07-31T12:00:00.000Z');
    const claims = buildClaimsFromSources(
      [
        {
          title: 'Stale',
          url: 'https://example.com/stale',
          snippet: 'Very old claim',
          date: '2020-01-01',
          hitCount: 1,
        },
        {
          title: 'Fresh',
          url: 'https://example.com/fresh',
          snippet: 'Recent claim',
          date: '2026-07-28',
          hitCount: 2,
        },
      ],
      { freshness: 'week', now },
    );

    expect(claims.some((claim) => claim.claim.includes('Very old'))).toBe(false);
    expect(claims.some((claim) => claim.claim.includes('Recent'))).toBe(true);
  });
});

describe('formatStructuredClaimLine', () => {
  it('renders confidence, sources, and as_of', () => {
    const line = formatStructuredClaimLine({
      claim: 'Example claim',
      sources: ['https://example.com/a'],
      confidence: 'medium',
      as_of: '2026-07-01',
    });
    expect(line).toContain('[medium]');
    expect(line).toContain('https://example.com/a');
    expect(line).toContain('as_of: 2026-07-01');
  });
});

describe('citation coverage gold-set fixture', () => {
  it('meets ≥95% cited claims when sources exist', () => {
    const fixture = loadGoldFixture();
    const now = new Date(fixture.referenceNow);
    const claims = buildClaimsFromSources(fixture.sources, {
      freshness: fixture.freshness,
      now,
    });

    const coverage = citationCoverageRatio(claims);
    expect(meetsCitationCoverageGoldSet(claims, fixture.sources.length > 0, fixture.minCoverage)).toBe(
      true,
    );
    expect(coverage).toBeGreaterThanOrEqual(fixture.minCoverage);
  });

  it('flags uncited entries in the fixture as speculative', () => {
    const fixture = loadGoldFixture();
    const now = new Date(fixture.referenceNow);
    const claims = buildClaimsFromSources(fixture.sources, {
      freshness: fixture.freshness,
      now,
      maxClaims: fixture.sources.length,
    });

    const uncited = claims.filter((claim) => claim.sources.length === 0);
    for (const claim of uncited) {
      expect(claim.confidence).toBe('speculative');
    }
  });
});

describe('filterClaimsByFreshness', () => {
  it('keeps undated claims but drops stale speculative ones', () => {
    const now = new Date('2026-07-31T12:00:00.000Z');
    const claims: DeepResearchClaim[] = [
      {
        claim: 'Undated',
        sources: ['https://example.com/u'],
        confidence: 'low',
      },
      {
        claim: 'Stale speculative',
        sources: ['https://example.com/s'],
        confidence: 'speculative',
        as_of: '2020-01-01',
      },
    ];

    const filtered = filterClaimsByFreshness(claims, 'week', now);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.claim).toBe('Undated');
  });
});
