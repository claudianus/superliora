import { describe, expect, it } from 'vitest';

import { extractEvidenceIdsFromText } from '../../../src/agent/compaction/quality';

describe('extractEvidenceIdsFromText', () => {
  // Stable durable identifiers that must survive compaction. If the
  // extractor drops a category, the next session can lose load-bearing
  // context (file hints, node ids, archive markers). Pin every branch.

  it('extracts evidence_ids: a, b form', () => {
    const ids = extractEvidenceIdsFromText(
      'see evidence_ids: ac-1, ac-2, work_node:42',
    );
    expect(ids).toContain('ac-1');
    expect(ids).toContain('ac-2');
    expect(ids).toContain('work_node:42');
  });

  it('extracts evidence_id=x form', () => {
    const ids = extractEvidenceIdsFromText('evidence_id=alpha-beta');
    expect(ids).toContain('alpha-beta');
  });

  it('extracts evidence_ids="quoted" form', () => {
    const ids = extractEvidenceIdsFromText(
      'evidence_ids="ac-1, ac-2, ac-3"',
    );
    expect(ids).toContain('ac-1');
    expect(ids).toContain('ac-2');
    expect(ids).toContain('ac-3');
  });

  it('extracts work_node_ids / node_id / ac_id / acceptance_criterion_id forms', () => {
    const ids = extractEvidenceIdsFromText([
      'work_node_ids: n-1, n-2',
      'node_id=n-3',
      'ac_id=n-4',
      'acceptance_criterion_id=n-5',
    ].join('\n'));
    expect(ids).toEqual(
      expect.arrayContaining(['n-1', 'n-2', 'n-3', 'n-4', 'n-5']),
    );
  });

  it('extracts liora-archived id markers', () => {
    const ids = extractEvidenceIdsFromText(
      '[liora-archived id=2b184b224f87] and [liora-archived id=f16513fbda60]',
    );
    expect(ids).toContain('2b184b224f87');
    expect(ids).toContain('f16513fbda60');
  });

  it('returns a deduplicated list', () => {
    const ids = extractEvidenceIdsFromText(
      'evidence_ids: ac-1, ac-1, ac-2, ac-2',
    );
    const ac1Count = ids.filter((id) => id === 'ac-1').length;
    const ac2Count = ids.filter((id) => id === 'ac-2').length;
    expect(ac1Count).toBe(1);
    expect(ac2Count).toBe(1);
  });

  it('ignores short tokens that look like noise', () => {
    // Length < 2 should not survive the filter. A single letter could
    // come from a coincidental match (e.g. "x = y" inside prose).
    const ids = extractEvidenceIdsFromText('evidence_ids: a, b, ac-1');
    expect(ids).toContain('ac-1');
    expect(ids).not.toContain('a');
    expect(ids).not.toContain('b');
  });

  it('returns an empty list for prose without identifiers', () => {
    expect(extractEvidenceIdsFromText('plain text with no markers')).toEqual(
      [],
    );
  });
});
