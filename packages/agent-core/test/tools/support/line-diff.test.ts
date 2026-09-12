import { describe, expect, it } from 'vitest';

import { diffAddedLineRanges } from '../../../src/tools/support/line-diff';

function lines(...values: readonly string[]): string {
  return `${values.join('\n')}\n`;
}

describe('diffAddedLineRanges', () => {
  it('returns empty for identical content', () => {
    const text = lines('a', 'b', 'c');
    expect(diffAddedLineRanges(text, text)).toEqual({
      added: [],
      addedLines: 0,
      removedLines: 0,
    });
  });

  it('treats a created file as fully added', () => {
    expect(diffAddedLineRanges(null, lines('x', 'y'))).toEqual({
      added: [{ start: 1, end: 2 }],
      addedLines: 2,
      removedLines: 0,
    });
  });

  it('treats deletion as pure removal', () => {
    expect(diffAddedLineRanges(lines('x', 'y'), null)).toEqual({
      added: [],
      addedLines: 0,
      removedLines: 2,
    });
  });

  it('reports a replaced middle line as one added and one removed', () => {
    const summary = diffAddedLineRanges(lines('a', 'b', 'c'), lines('a', 'B', 'c'));
    expect(summary.added).toEqual([{ start: 2, end: 2 }]);
    expect(summary.addedLines).toBe(1);
    expect(summary.removedLines).toBe(1);
  });

  it('coalesces consecutive added lines into one range', () => {
    const summary = diffAddedLineRanges(lines('a', 'd'), lines('a', 'b', 'c', 'd'));
    expect(summary.added).toEqual([{ start: 2, end: 3 }]);
    expect(summary.addedLines).toBe(2);
    expect(summary.removedLines).toBe(0);
  });

  it('reports appended trailing lines', () => {
    const summary = diffAddedLineRanges(lines('a'), lines('a', 'b', 'c'));
    expect(summary.added).toEqual([{ start: 2, end: 3 }]);
    expect(summary.addedLines).toBe(2);
  });

  it('reports removal without additions when the file shrinks', () => {
    const summary = diffAddedLineRanges(lines('a', 'b', 'c'), lines('a'));
    expect(summary.added).toEqual([]);
    expect(summary.addedLines).toBe(0);
    expect(summary.removedLines).toBe(2);
  });

  it('handles insertion and removal in one edit', () => {
    const summary = diffAddedLineRanges(lines('a', 'b', 'c'), lines('a', 'X', 'Y', 'c'));
    expect(summary.added).toEqual([{ start: 2, end: 3 }]);
    expect(summary.addedLines).toBe(2);
    expect(summary.removedLines).toBe(1);
  });

  it('falls back to whole-middle attribution for oversized rewrites', () => {
    const middle = Array.from({ length: 1200 }, (_, i) => `a${String(i)}`);
    const before = lines('head', ...middle, 'tail');
    const after = lines('head', ...middle.map((l) => `${l}!`), 'tail');
    const summary = diffAddedLineRanges(before, after);
    expect(summary.added).toEqual([{ start: 2, end: 1201 }]);
    expect(summary.addedLines).toBe(1200);
    expect(summary.removedLines).toBe(1200);
  });

  it('counts a reordering as one added and one removed line', () => {
    const summary = diffAddedLineRanges(lines('a', 'b', 'c'), lines('a', 'c', 'b'));
    expect(summary.addedLines).toBe(1);
    expect(summary.removedLines).toBe(1);
  });

  it('never counts the shared edges as removed', () => {
    const summary = diffAddedLineRanges(lines('h', 'a', 't'), lines('h', 'x', 't'));
    expect(summary.removedLines).toBe(1);
    expect(summary.added).toEqual([{ start: 2, end: 2 }]);
  });
});
