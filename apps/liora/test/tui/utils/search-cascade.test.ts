import { describe, expect, it } from 'vitest';

import {
  activeSearchCascade,
  formatResearchHopsOpsLine,
  formatSearchCascadeFooterBadge,
  formatSearchCascadeOpsFallbackLine,
  formatSearchCascadeOpsLine,
  formatSearchCascadeSessionGlance,
  buildSearchCascadeSessionLiveLines,
  resolveSearchCascadeOpsHealthLines,
  SEARCH_CASCADE_SESSION_STUB_TIP,
  isSearchCascadeActive,
  parseDeepResearchChannelsTried,
  parseDeepResearchHops,
  parseSearchChannelsFromText,
  SEARCH_CASCADE_BADGE_TTL_MS,
  searchCascadePatchFromDegraded,
  searchCascadePatchFromToolResult,
  staleSearchCascadeClearPatch,
} from '#/tui/utils/search/search-cascade';
import { collectFooterStaleAppStatePatches } from '#/tui/components/chrome/footer/footer-badges';

const sample = { channelsTried: ['ch1', 'ch4'], atMs: 1_000 };

describe('search-cascade TTL', () => {
  it('is active within TTL and inactive after expiry', () => {
    expect(isSearchCascadeActive(sample, 1_000)).toBe(true);
    expect(isSearchCascadeActive(sample, 1_000 + SEARCH_CASCADE_BADGE_TTL_MS - 1)).toBe(true);
    expect(isSearchCascadeActive(sample, 1_000 + SEARCH_CASCADE_BADGE_TTL_MS)).toBe(false);
    expect(activeSearchCascade(sample, 1_000 + SEARCH_CASCADE_BADGE_TTL_MS + 1)).toBeNull();
  });

  it('clears stale AppState patch only when expired', () => {
    expect(staleSearchCascadeClearPatch(null)).toBeNull();
    expect(staleSearchCascadeClearPatch(sample, 1_000)).toBeNull();
    expect(staleSearchCascadeClearPatch(sample, 1_000 + SEARCH_CASCADE_BADGE_TTL_MS + 1)).toEqual({
      searchCascade: null,
    });
  });

  it('footer badge hides when TTL expires', () => {
    expect(
      formatSearchCascadeFooterBadge(sample, 1_000 + SEARCH_CASCADE_BADGE_TTL_MS - 1),
    ).not.toBeNull();
    expect(formatSearchCascadeFooterBadge(sample, 1_000 + SEARCH_CASCADE_BADGE_TTL_MS)).toBeNull();
  });

  it('collectFooterStaleAppStatePatches clears expired searchCascade', () => {
    expect(
      collectFooterStaleAppStatePatches(
        { runtimeDegraded: null, searchCascade: sample },
        1_000 + SEARCH_CASCADE_BADGE_TTL_MS + 1,
      ),
    ).toEqual({ searchCascade: null });
  });
});

describe('search-cascade', () => {
  describe('parseSearchChannelsFromText', () => {
    it('extracts ordered Ch1–Ch5 mentions', () => {
      expect(
        parseSearchChannelsFromText(
          'Paid slots cooling; browser (Ch4) or Chrome extension bridge (Ch5) may help.',
        ),
      ).toEqual(['ch4', 'ch5']);
    });

    it('maps free fallback to ch3', () => {
      expect(parseSearchChannelsFromText('free fallback (DDG/local) remains available')).toEqual([
        'ch3',
      ]);
    });

    it('maps searxng and Ch2 meta hints to ch2', () => {
      expect(parseSearchChannelsFromText('Ch2 SearXNG meta search may still yield hits.')).toEqual([
        'ch2',
      ]);
    });
  });

  describe('parseDeepResearchHops', () => {
    it('reads hops line', () => {
      expect(parseDeepResearchHops('hops: 3\ndegraded: false')).toBe(3);
      expect(parseDeepResearchHops('degraded: true')).toBeNull();
    });
  });

  describe('parseDeepResearchChannelsTried', () => {
    it('parses pipe-separated channel ids', () => {
      expect(parseDeepResearchChannelsTried('channelsTried: ch1 | ch3')).toEqual([
        'ch1',
        'ch3',
      ]);
    });

    it('returns empty for none marker', () => {
      expect(parseDeepResearchChannelsTried('channelsTried: (none)')).toEqual([]);
    });
  });

  describe('searchCascadePatchFromDegraded', () => {
    it('sets cascade for search scope with channel hints', () => {
      expect(
        searchCascadePatchFromDegraded(
          'search',
          'paid_channels_cooling',
          'Ch1 failed; escalated to browser (Ch4)',
          1000,
        ),
      ).toEqual({
        searchCascade: { channelsTried: ['ch1', 'ch4'], atMs: 1000 },
      });
    });

    it('ignores non-search scope', () => {
      expect(searchCascadePatchFromDegraded('oauth', 'x', 'Ch4')).toBeNull();
    });
  });

  describe('searchCascadePatchFromToolResult', () => {
    it('parses WebSearch degraded hint', () => {
      const output = [
        'No live search hits.',
        'degraded: true',
        'hint: Paid slots cooling; free fallback (DDG/local) remains.',
      ].join('\n');
      expect(searchCascadePatchFromToolResult('WebSearch', output, 2000)).toEqual({
        searchCascade: { channelsTried: ['ch3'], atMs: 2000 },
      });
    });

    it('parses WebSearch never-empty next line with Ch4/Ch5', () => {
      const output = [
        'Search failed (network): timeout',
        'degraded: true',
        'next: simplify the query, retry WebSearch, try or retry browser automation (Ch4) or Chrome extension bridge (Ch5), FetchURL a known URL, or continue from local repo evidence.',
      ].join('\n');
      expect(searchCascadePatchFromToolResult('WebSearch', output, 2000)).toEqual({
        searchCascade: { channelsTried: ['ch4', 'ch5'], atMs: 2000 },
      });
    });

    it('parses DeepResearch hops and channelsTried', () => {
      const output = [
        'question: foo',
        'hops: 2',
        'channelsTried: ch1 | ch3',
        'degraded: false',
      ].join('\n');
      expect(searchCascadePatchFromToolResult('DeepResearch', output, 3000)).toEqual({
        searchCascade: { channelsTried: ['ch1', 'ch3'], hops: 2, atMs: 3000 },
      });
    });

    it('parses DeepResearch output with channel mentions', () => {
      const output = [
        'question: foo',
        'degraded: true',
        'next: try browser (Ch4)',
      ].join('\n');
      expect(searchCascadePatchFromToolResult('DeepResearch', output, 3000)).toEqual({
        searchCascade: { channelsTried: ['ch4'], atMs: 3000 },
      });
    });

    it('skips WebSearch when not degraded', () => {
      expect(searchCascadePatchFromToolResult('WebSearch', 'degraded: false', 0)).toBeNull();
    });
  });

  describe('formatResearchHopsOpsLine', () => {
    it('formats hop count', () => {
      expect(formatResearchHopsOpsLine(3)).toBe('Research hops: 3');
      expect(formatResearchHopsOpsLine(0)).toBeNull();
      expect(formatResearchHopsOpsLine(undefined)).toBeNull();
    });
  });

  describe('formatSearchCascadeOpsLine', () => {
    it('joins channels with arrow', () => {
      expect(formatSearchCascadeOpsLine(['ch1', 'ch3', 'ch4'])).toBe('Cascade: ch1→ch3→ch4');
    });

    it('appends hops when provided', () => {
      expect(formatSearchCascadeOpsLine(['ch1', 'ch4'], 2)).toBe('Cascade: ch1→ch4 · hops 2');
    });

    it('parses WebSearch explicit channelsTried line', () => {
      const output = [
        'No live search hits.',
        'degraded: true',
        'channelsTried: ch1 | ch4 | ch5',
        'next: simplify the query',
      ].join('\n');
      expect(searchCascadePatchFromToolResult('WebSearch', output, 2000)).toEqual({
        searchCascade: { channelsTried: ['ch1', 'ch4', 'ch5'], atMs: 2000 },
      });
    });
  });

  describe('formatSearchCascadeOpsFallbackLine', () => {
    it('shows never-empty escalate stub when search is degraded', () => {
      expect(formatSearchCascadeOpsFallbackLine(true)).toBe(
        'Cascade: never-empty · Ch4 browser · Ch5 chrome-ext',
      );
      expect(formatSearchCascadeOpsFallbackLine(false)).toBeNull();
    });
  });

  describe('resolveSearchCascadeOpsHealthLines', () => {
    it('maps channelsTried to cascade line within TTL', () => {
      expect(
        resolveSearchCascadeOpsHealthLines(
          { channelsTried: ['ch1', 'ch4'], atMs: 1_000 },
          1_000,
        ),
      ).toEqual({
        cascadeLine: 'Cascade: ch1→ch4',
        researchHopsLine: null,
      });
    });

    it('maps hops-only snapshot to research hops row (no cascade row)', () => {
      expect(
        resolveSearchCascadeOpsHealthLines({ channelsTried: [], hops: 3, atMs: 1_000 }, 1_000),
      ).toEqual({
        cascadeLine: null,
        researchHopsLine: 'Research hops: 3',
      });
    });

    it('returns null rows when cascade expired or absent', () => {
      expect(resolveSearchCascadeOpsHealthLines(null, 1_000)).toEqual({
        cascadeLine: null,
        researchHopsLine: null,
      });
      expect(
        resolveSearchCascadeOpsHealthLines(sample, 1_000 + SEARCH_CASCADE_BADGE_TTL_MS),
      ).toEqual({
        cascadeLine: null,
        researchHopsLine: null,
      });
    });
  });

  describe('formatSearchCascadeSessionGlance', () => {
    it('returns ops line while cascade is within TTL', () => {
      expect(formatSearchCascadeSessionGlance(sample, 1_000)).toBe('Cascade: ch1→ch4');
    });

    it('returns null when cascade expired or absent', () => {
      expect(formatSearchCascadeSessionGlance(sample, 1_000 + SEARCH_CASCADE_BADGE_TTL_MS)).toBeNull();
      expect(formatSearchCascadeSessionGlance(null, 1_000)).toBeNull();
    });

    it('includes hops for DeepResearch snapshot', () => {
      expect(
        formatSearchCascadeSessionGlance(
          { channelsTried: ['ch1', 'ch3'], hops: 2, atMs: 1_000 },
          1_000,
        ),
      ).toBe('Cascade: ch1→ch3 · hops 2');
    });
  });

  describe('buildSearchCascadeSessionLiveLines', () => {
    it('shows live cascade in Session (live) block', () => {
      const lines = buildSearchCascadeSessionLiveLines(sample, 1_000);
      expect(lines[0]).toContain('Session (live)');
      expect(lines[1]).toBe('Cascade: ch1→ch4');
    });

    it('shows stub tip when cascade absent', () => {
      const lines = buildSearchCascadeSessionLiveLines(null, 1_000);
      expect(lines[1]).toContain(SEARCH_CASCADE_SESSION_STUB_TIP);
    });
  });
});

describe('formatSearchCascadeFooterBadge', () => {
  const atMs = 1_000_000;
  const cascade = { channelsTried: ['ch1', 'ch4'], atMs };

  it('shows research↻ within TTL', () => {
    expect(
      formatSearchCascadeFooterBadge(cascade, atMs + SEARCH_CASCADE_BADGE_TTL_MS - 1),
    ).toEqual({
      text: 'research↻',
      severity: 'info',
    });
    expect(
      formatSearchCascadeFooterBadge({ channelsTried: [], hops: 2, atMs }, atMs + 1),
    ).toEqual({
      text: 'research↻',
      severity: 'info',
    });
  });

  it('hides at and after TTL', () => {
    expect(formatSearchCascadeFooterBadge(cascade, atMs + SEARCH_CASCADE_BADGE_TTL_MS)).toBeNull();
    expect(formatSearchCascadeFooterBadge(cascade, atMs + SEARCH_CASCADE_BADGE_TTL_MS + 1)).toBeNull();
  });

  it('returns null when unset or empty', () => {
    expect(formatSearchCascadeFooterBadge(null, atMs)).toBeNull();
    expect(formatSearchCascadeFooterBadge(undefined, atMs)).toBeNull();
    expect(formatSearchCascadeFooterBadge({ channelsTried: [], atMs }, atMs)).toBeNull();
  });
});
