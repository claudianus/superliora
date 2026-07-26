import { describe, expect, it } from 'vitest';

import { DREAM_BACKUP_SUFFIX, parseDreamPlan } from '#/agent/dream/auto-dream';
import type { MemoryRecord } from '#/agent/dream/types';

const records: MemoryRecord[] = [
  { id: 'a1', kind: 'note', subject: 's', content: 'c' },
  { id: 'a2', kind: 'note', subject: 's', content: 'c' },
  { id: 'b1', kind: 'note', subject: 's', content: 'c' },
] as unknown as MemoryRecord[];

describe('agent/dream — DREAM_BACKUP_SUFFIX', () => {
  it('exposes the documented suffix', () => {
    expect(DREAM_BACKUP_SUFFIX).toBe('.dream-bak');
  });
});

describe('agent/dream — parseDreamPlan', () => {
  it('returns empty plan when no JSON object is present', () => {
    expect(parseDreamPlan('no json here', records)).toEqual({ merges: [] });
  });

  it('returns empty plan when the JSON is invalid', () => {
    expect(parseDreamPlan('prefix {not-json} suffix', records)).toEqual({ merges: [] });
  });

  it('returns empty plan when merges is missing or not an array', () => {
    expect(parseDreamPlan('{"foo":1}', records)).toEqual({ merges: [] });
    expect(parseDreamPlan('{"merges":"nope"}', records)).toEqual({ merges: [] });
  });

  it('keeps a valid merge group', () => {
    const text = JSON.stringify({
      merges: [
        { keeperId: 'a1', duplicateIds: ['a2'], mergedSubject: 's', mergedContent: 'c' },
      ],
    });
    const result = parseDreamPlan(text, records);
    expect(result.merges).toEqual([
      { keeperId: 'a1', duplicateIds: ['a2'], mergedSubject: 's', mergedContent: 'c' },
    ]);
  });

  it('drops merge groups where the keeper is unknown', () => {
    const text = JSON.stringify({
      merges: [{ keeperId: 'unknown', duplicateIds: ['a2'] }],
    });
    expect(parseDreamPlan(text, records)).toEqual({ merges: [] });
  });

  it('keeps only string duplicateIds (drops non-string entries)', () => {
    const text = JSON.stringify({
      merges: [
        { keeperId: 'a1', duplicateIds: ['a2', 42, null, 'a2'] },
      ],
    });
    const result = parseDreamPlan(text, records);
    expect(result.merges[0].duplicateIds).toEqual(['a2', 'a2']);
  });

  it('skips non-object entries inside merges', () => {
    const text = JSON.stringify({ merges: [null, 5, { keeperId: 'a1', duplicateIds: ['a2'] }] });
    const result = parseDreamPlan(text, records);
    expect(result.merges).toHaveLength(1);
    expect(result.merges[0].keeperId).toBe('a1');
  });

  it('extracts the first JSON object from mixed prose', () => {
    const text = `preamble\n${JSON.stringify({
      merges: [{ keeperId: 'a1', duplicateIds: ['a2'] }],
    })}\nepilogue`;
    const result = parseDreamPlan(text, records);
    expect(result.merges).toHaveLength(1);
    expect(result.merges[0].keeperId).toBe('a1');
  });
});
