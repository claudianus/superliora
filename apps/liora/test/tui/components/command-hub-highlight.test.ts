import { describe, expect, it } from 'vitest';

import { hubHighlightSegments } from '#/tui/components/dialogs/command-hub/command-hub-highlight';

function joined(segments: readonly { text: string; matched: boolean }[]): string {
  return segments.map((s) => (s.matched ? `[${s.text}]` : s.text)).join('');
}

describe('hubHighlightSegments', () => {
  it('returns a single unmatched segment for empty query or text', () => {
    expect(hubHighlightSegments('Model', '')).toEqual([{ text: 'Model', matched: false }]);
    expect(hubHighlightSegments('Model', '   ')).toEqual([{ text: 'Model', matched: false }]);
    expect(hubHighlightSegments('', 'm')).toEqual([{ text: '', matched: false }]);
  });

  it('marks a contiguous substring match', () => {
    expect(joined(hubHighlightSegments('Model routing', 'mod'))).toBe('[Mod]el routing');
  });

  it('marks a gapped subsequence match case-insensitively', () => {
    expect(joined(hubHighlightSegments('Model routing', 'mr'))).toBe('[M]odel [r]outing');
  });

  it('highlights each whitespace token independently', () => {
    expect(joined(hubHighlightSegments('Job Deck monitor', 'job mon'))).toBe(
      '[Job] Deck [mon]itor',
    );
  });

  it('skips tokens that do not match the label at all', () => {
    // "zzz" may have matched description/keywords; the label stays honest.
    expect(joined(hubHighlightSegments('Model', 'mod zzz'))).toBe('[Mod]el');
  });

  it('merges adjacent matched runs into single segments', () => {
    const segments = hubHighlightSegments('model', 'model');
    expect(segments).toEqual([{ text: 'model', matched: true }]);
  });
});
