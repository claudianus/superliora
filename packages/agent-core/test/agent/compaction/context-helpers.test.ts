import type { CompactionPlan } from '../../../src/agent/compaction/planner';
import { describe, expect, it } from 'vitest';
import {
  extractFileHints,
  extractNextActions,
  extractSwarmRunLines,
  factsToDetails,
  formatRawRef,
  formatRecallSections,
  formatStringList,
  isUsefulHint,
  mergeStringLists,
  normalizeHint,
  recallSubject,
  recallTags,
  uniqueHints,
  uniqueSorted,
  usefulRecallItems,
} from '../../../src/agent/compaction/context-helpers';

describe('context-helpers.ts — pure helpers', () => {
  describe('usefulRecallItems', () => {
    it('filters undefined, dedupes case-insensitively, and caps at 8', () => {
      const out = usefulRecallItems([
        undefined,
        '  Alpha  ',
        'alpha',
        'Beta',
        'Gamma',
        'Delta',
        'Epsilon',
        'Zeta',
        'Eta',
        'Theta',
        'Iota',
        'Kappa',
      ]);
      // The first 'Alpha' wins; subsequent case-insensitive duplicates are
      // dropped, and the result is capped at 8 entries.
      expect(out).toEqual([
        'Alpha',
        'Beta',
        'Gamma',
        'Delta',
        'Epsilon',
        'Zeta',
        'Eta',
        'Theta',
      ]);
    });

    it('drops the prompt-control and useless-memory items so they never reach recall', () => {
      const out = usefulRecallItems(['valid', 'none captured during compaction.', '## heading']);
      expect(out).toEqual(['valid']);
    });
  });

  describe('formatRecallSections', () => {
    it('skips empty sections and renders ## headers + bulleted items (cap 8 each)', () => {
      const out = formatRecallSections([
        ['Current goal', ['a', 'b', 'c']],
        ['Empty', []],
        ['Decisions', ['d']],
      ]);
      expect(out).toBe('## Current goal\n- a\n- b\n- c\n\n## Decisions\n- d');
    });
  });

  describe('recallSubject', () => {
    it('returns the prefix unchanged when detail is undefined or empty after cleanup', () => {
      expect(recallSubject('Compaction', undefined)).toBe('Compaction');
      expect(recallSubject('Compaction', '   ')).toBe('Compaction');
    });

    it('strips `*_# and trims whitespace before slicing to 80 chars', () => {
      expect(recallSubject('Compaction', '`code` *star* #hash')).toBe(
        'Compaction: code star hash',
      );
      const long = `${'a'.repeat(120)} end`;
      const out = recallSubject('P', long);
      expect(out.length).toBeLessThanOrEqual('P: '.length + 80);
    });
  });

  describe('recallTags', () => {
    it('merges base + optional tags into a unique set, ignoring undefined', () => {
      const out = recallTags(['compaction', 'file'], [undefined, 'decision', 'file']);
      expect(out).toEqual(['compaction', 'file', 'decision']);
    });
  });

  describe('formatStringList', () => {
    it('returns the documented empty marker when the list is empty', () => {
      expect(formatStringList([])).toBe('- None captured during compaction.');
    });

    it('caps the rendered list at 12 bullets', () => {
      const items = Array.from({ length: 20 }, (_, i) => `i-${i}`);
      const out = formatStringList(items);
      expect(out.split('\n').length).toBe(12);
      expect(out.endsWith('- i-11')).toBe(true);
    });
  });

  describe('factsToDetails', () => {
    it('maps each fact to its detail string', () => {
      const facts = [
        { category: 'file' as const, subject: 'a.ts', detail: 'detail-a', importance: 'critical' as const },
        { category: 'decision' as const, subject: 'd', detail: 'detail-d', importance: 'important' as const },
      ];
      expect(factsToDetails(facts)).toEqual(['detail-a', 'detail-d']);
    });
  });

  describe('extractSwarmRunLines', () => {
    it('captures bullet lines under the swarm_runs: section', () => {
      const summary = [
        '## heading',
        'swarm_runs:',
        '- run-1: ac-1 → PASS',
        '- run-2: ac-2 → FAIL',
        'next_actions:',
        '- todo',
      ].join('\n');
      expect(extractSwarmRunLines(summary)).toEqual([
        'run-1: ac-1 → PASS',
        'run-2: ac-2 → FAIL',
      ]);
    });

    it('returns an empty list when no swarm_runs: section is present', () => {
      expect(extractSwarmRunLines('no section here')).toEqual([]);
    });
  });

  describe('extractNextActions', () => {
    it('captures - / * list items under a Next steps / Todo / Pending / Active issues heading', () => {
      const summary = [
        '## Other',
        '- skipped',
        '## Next steps',
        '- write tests',
        '* run vitest',
        '## Done',
        '- ignored',
      ].join('\n');
      expect(extractNextActions(summary)).toEqual(['write tests', 'run vitest']);
    });

    it('returns an empty list when no recognised heading is present', () => {
      expect(extractNextActions('plain text')).toEqual([]);
    });
  });

  describe('mergeStringLists', () => {
    it('dedupes case-insensitively across primary and fallback, dropping empties', () => {
      const out = mergeStringLists([' Alpha ', 'beta', ''], ['ALPHA', 'gamma', 'beta']);
      expect(out).toEqual(['Alpha', 'beta', 'gamma']);
    });
  });

  describe('uniqueSorted', () => {
    it('drops empty strings, dedupes, and returns a sorted array', () => {
      expect(uniqueSorted(['b', 'a', 'b', '', 'c'])).toEqual(['a', 'b', 'c']);
    });
  });

  describe('uniqueHints / normalizeHint / isUsefulHint', () => {
    it('normalizeHint collapses whitespace, trims, and slices to 200 chars', () => {
      expect(normalizeHint('  hello\n\n  world  ')).toBe('hello world');
      const sliced = normalizeHint('x'.repeat(300));
      expect(sliced.length).toBe(200);
    });

    it('isUsefulHint rejects the empty marker, headings, and lone **label**: lines', () => {
      expect(isUsefulHint('None captured during compaction.')).toBe(false);
      expect(isUsefulHint('## heading')).toBe(false);
      expect(isUsefulHint('**file**: ')).toBe(false);
      expect(isUsefulHint('plain useful hint')).toBe(true);
    });

    it('uniqueHints dedupes case-insensitively after normalization and usefulness check', () => {
      const out = uniqueHints(['  alpha  ', 'ALPHA', 'beta', undefined, '## skip']);
      expect(out).toEqual(['alpha', 'beta']);
    });
  });

  describe('extractFileHints', () => {
    it('captures both backtick-wrapped and bare file paths, dedupes, and sorts', () => {
      const out = extractFileHints('look at `src/foo.ts` and src/bar.py plus src/baz.ts');
      expect(out).toEqual(['src/bar.py', 'src/baz.ts', 'src/foo.ts']);
    });

    it('ignores non-matching extensions', () => {
      const out = extractFileHints('only .txt and .lock here, no match');
      expect(out).toEqual([]);
    });
  });

  describe('formatRawRef', () => {
    it('renders the kind/range/tokens and tools list when present', () => {
      const ref: CompactionPlan['rawRefs'][number] = {
        kind: 'tool',
        messageStart: 1,
        messageEnd: 9,
        tokens: 12_345,
        toolNames: ['shell', 'read'],
      };
      expect(formatRawRef(ref)).toBe('tool[1-9] tokens=12345 tools=shell,read');
    });

    it('omits the tools= suffix when toolNames is missing or empty', () => {
      const ref: CompactionPlan['rawRefs'][number] = {
        kind: 'message',
        messageStart: 0,
        messageEnd: 5,
        tokens: 100,
      };
      expect(formatRawRef(ref)).toBe('message[0-5] tokens=100');
    });
  });
});
