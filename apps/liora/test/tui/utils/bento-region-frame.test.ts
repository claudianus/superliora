import { describe, expect, it } from 'vitest';

import { visibleWidth } from '#/tui/renderer';
import { frameBentoRegionLines } from '#/tui/utils/bento-region-frame';

const ANSI = /\u001B\[[0-9;]*m/g;

function strip(text: string): string {
  return text.replaceAll(ANSI, '');
}

describe('frameBentoRegionLines', () => {
  it('keeps outer width stable with emoji titles', () => {
    const lines = frameBentoRegionLines({
      width: 40,
      title: '💬 Quick Chat',
      kind: 'panel',
      lines: ['hello'],
    });
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(visibleWidth(strip(line))).toBe(40);
    }
    const top = strip(lines[0]!);
    expect(top.startsWith('╭')).toBe(true);
    expect(top.endsWith('╮')).toBe(true);
    expect(top).toContain('Quick Chat');
  });

  it('frames Status chrome titles on spacious footers', () => {
    const lines = frameBentoRegionLines({
      width: 80,
      title: 'Status',
      kind: 'chrome',
      lines: ['yolo · next'],
    });
    // Open-sided chrome: title in a rule band, no corner/side pipes.
    expect(strip(lines[0]!)).toMatch(/─+ Status ─+/);
    expect(strip(lines[0]!)).not.toMatch(/[╭╮│]/);
    expect(strip(lines[1]!)).toContain('yolo');
    expect(strip(lines[2]!)).toMatch(/^─+$/);
  });

  it('pads closed rail tiles up to minHeight', () => {
    const lines = frameBentoRegionLines({
      width: 28,
      title: 'Context',
      kind: 'rail',
      lines: ['todo'],
      minHeight: 10,
    });
    expect(lines).toHaveLength(10);
    expect(strip(lines[0]!)).toMatch(/^╭.*Context.*╮$/);
    expect(strip(lines[lines.length - 1]!)).toMatch(/^╰─+╯$/);
    expect(strip(lines[2]!)).toMatch(/^│\s+│$/);
    // Last body row carries a dim dock hint instead of a blank shaft.
    expect(strip(lines[lines.length - 2]!)).toMatch(/Ctrl\+\/ panels/);
  });
});
