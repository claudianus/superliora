import { describe, expect, it, vi } from 'vitest';

import {
  displayClusterWidth,
  measureAnsiDisplayWidth,
  measureDisplayWidth,
  splitDisplayClusters,
  wrapDisplayText,
} from '../src';

describe('displayClusterWidth kitty placeholders', () => {
  it('measures a placeholder with row/column diacritics as one cell', () => {
    expect(displayClusterWidth('\u{10EEEE}\u{0305}\u{030D}')).toBe(1);
  });

  it('measures a bare placeholder as one cell', () => {
    expect(displayClusterWidth('\u{10EEEE}')).toBe(1);
  });
});

describe('display width fast path agrees with grapheme segmentation', () => {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const reference = (text: string): { clusters: string[]; width: number } => {
    const clusters = Array.from(segmenter.segment(text), (s) => s.segment);
    return {
      clusters,
      width: clusters.reduce((sum, cluster) => sum + displayClusterWidth(cluster), 0),
    };
  };
  const samples = [
    'plain ascii line',
    '한국어 트랜스크립트 스크롤',
    '日本語のテキストとカタカナ',
    'mixed 한글 and 中文 — “quotes” ✓ ✗ → ←',
    '│ box ─ drawing ┌┐└┘ █▓▒░',
    'ﾊﾟﾋﾞ halfwidth voiced',
    'é combining acute',
    '각 conjoining jamo',
    '각 syllable plus trailing jamo',
    '👍🏽 skin tone and 👨‍👩‍👧 family',
    '☀️ variation selector',
    '🇰🇷 regional indicators',
    'cr\r\nlf pair',
    'tab\tseparated',
  ];

  it.each(samples)('splits and measures %j like Intl.Segmenter', (text) => {
    const expected = reference(text);
    const clusters = splitDisplayClusters(text);
    expect(clusters.map((cluster) => cluster.text)).toEqual(expected.clusters);
    expect(measureDisplayWidth(text)).toBe(expected.width);
  });

  it('measures ANSI-styled text by its visible clusters only', () => {
    const styled = '\u001B[38;2;1;2;3m한글\u001B[0m \u001B]8;;https://example.com\u0007link\u001B]8;;\u0007';
    expect(measureAnsiDisplayWidth(styled)).toBe(4 + 1 + 4);
    // Memoized second read returns the same width.
    expect(measureAnsiDisplayWidth(styled)).toBe(9);
    expect(measureAnsiDisplayWidth('a\tb', { tabWidth: 3 })).toBe(5);
    expect(measureAnsiDisplayWidth('a\tb', { tabWidth: 8 })).toBe(10);
  });
});


describe('width fast-path and cache regressions', () => {
  it.each(['first\r\nsecond', '한글\r\n中文'])('preserves CRLF wrapping for %j', (text) => {
    expect(wrapDisplayText(text, 80)).toEqual(text.split('\r\n'));
  });

  it('skips segmentation for standalone BMP text but retains it for joined Unicode', () => {
    const segment = vi.spyOn(Intl.Segmenter.prototype, 'segment');
    try {
      expect(measureDisplayWidth('한글 中文 Latin')).toBe(15);
      expect(segment).not.toHaveBeenCalled();
      expect(measureDisplayWidth('e\u0301👨‍👩‍👧')).toBe(3);
      expect(segment).toHaveBeenCalled();
    } finally { segment.mockRestore(); }
  });

  it('reuses ANSI widths without contaminating custom tab measurements', () => {
    const styled = '\u001B[35mcache-regression e\u0301👩‍💻\t尾\u001B[0m';
    const segment = vi.spyOn(Intl.Segmenter.prototype, 'segment');
    try {
      const first = measureAnsiDisplayWidth(styled);
      const measuredCalls = segment.mock.calls.length;
      expect(measuredCalls).toBeGreaterThan(0);
      expect(measureAnsiDisplayWidth(styled)).toBe(first);
      expect(segment.mock.calls.length).toBe(measuredCalls);
      expect(measureAnsiDisplayWidth(styled, { tabWidth: 8 })).toBe(first + 5);
      expect(measureAnsiDisplayWidth(styled)).toBe(first);
    } finally { segment.mockRestore(); }
  });

  it('preserves Unicode/ANSI widths after bounded-cache rollover and on uncached long lines', () => {
    const styled = '\u001B[32m👩‍💻한글e\u0301\u001B[0m';
    const width = measureAnsiDisplayWidth(styled);
    for (let i = 0; i < 8_193; i++) measureAnsiDisplayWidth(`row-${i} 한글`);
    expect(measureAnsiDisplayWidth(styled)).toBe(width);
    expect(width).toBe(7);
    const long = '\u001B[33m' + '한글'.repeat(3_000) + '\u001B[0m';
    expect(measureAnsiDisplayWidth(long)).toBe(12_000);
    expect(measureAnsiDisplayWidth(long)).toBe(12_000);
  });

  it('evicts by retained characters before the entry cap when lines are long', () => {
    const styled = '\u001B[36mchar-budget e\u0301👩‍💻\u001B[0m';
    const segment = vi.spyOn(Intl.Segmenter.prototype, 'segment');
    try {
      const width = measureAnsiDisplayWidth(styled);
      let calls = segment.mock.calls.length;
      expect(measureAnsiDisplayWidth(styled)).toBe(width);
      expect(segment.mock.calls.length).toBe(calls);
      // 300 long lines stay far below the 8192-entry cap but exceed ~1M chars.
      for (let i = 0; i < 300; i++) measureAnsiDisplayWidth(`${String(i).padStart(4, '0')}${'x'.repeat(4_000)}`);
      calls = segment.mock.calls.length;
      expect(measureAnsiDisplayWidth(styled)).toBe(width);
      expect(segment.mock.calls.length).toBeGreaterThan(calls);
    } finally { segment.mockRestore(); }
  });
});
