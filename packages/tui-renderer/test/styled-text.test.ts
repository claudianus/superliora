import { describe, expect, it } from 'vitest';

import {
  createRendererStyledTextCells,
  measureRendererStyledTextRuns,
  truncateRendererStyledTextRuns,
  wrapRendererStyledTextRuns,
} from '../src';

describe('renderer styled text helpers', () => {
  it('measures styled text run display width', () => {
    expect(measureRendererStyledTextRuns([
      { text: 'ab' },
      { text: 'cde', style: { bold: true } },
    ])).toBe(5);
  });

  it('truncates styled text runs with an ellipsis run', () => {
    const truncated = truncateRendererStyledTextRuns([
      { text: 'hello world', style: { fg: '#111111' } },
    ], { width: 8, ellipsis: '…', ellipsisStyle: { dim: true } });

    expect(truncated.map((run) => run.text).join('')).toBe('hello w…');
    expect(truncated.at(-1)?.style).toEqual({ dim: true });
  });

  it('wraps styled text runs into fixed-width lines', () => {
    expect(wrapRendererStyledTextRuns([
      { text: 'abcd efgh' },
    ], { width: 5 })).toEqual([
      [{ text: 'abcd ' }],
      [{ text: 'efgh' }],
    ]);
  });

  it('creates styled cells and preserves hyperlinks', () => {
    const cells = createRendererStyledTextCells([
      { text: 'go', style: { fg: '#222222' }, link: 'https://example.com' },
    ]);

    expect(cells).toEqual([
      { char: 'g', style: { fg: '#222222' }, link: 'https://example.com' },
      { char: 'o', style: { fg: '#222222' }, link: 'https://example.com' },
    ]);
  });
});
