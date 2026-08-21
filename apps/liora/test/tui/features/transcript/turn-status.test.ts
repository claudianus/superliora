import { describe, expect, it } from 'vitest';

import {
  buildTurnStatusParts,
  composeTurnStatusLine,
  formatTokenChip,
  formatTurnStatusLabel,
  formatTurnStatusRight,
} from '#/tui/features/transcript/turn-status';

describe('formatTurnStatusLabel', () => {
  it('prefers verb groups over the phase label', () => {
    expect(
      formatTurnStatusLabel({
        phase: 'waiting',
        tools: [{ name: 'Read', running: true }],
      }),
    ).toBe('Reading 1 file');
  });

  it('keeps the tip only when no tools are running', () => {
    expect(formatTurnStatusLabel({ phase: 'thinking', tools: [], tip: 'ctrl+s: steer' })).toBe(
      'Thinking · ctrl+s: steer',
    );
    expect(
      formatTurnStatusLabel({
        phase: 'tool',
        tools: [{ name: 'Read', running: true }],
        tip: 'hidden',
      }),
    ).toBe('Reading 1 file');
  });
});

describe('formatTokenChip', () => {
  it('compacts thousands and hides empty counts', () => {
    expect(formatTokenChip(undefined)).toBeUndefined();
    expect(formatTokenChip(0)).toBeUndefined();
    expect(formatTokenChip(42)).toBe('42');
    expect(formatTokenChip(1500)).toBe('1.5k');
    expect(formatTokenChip(42_000)).toBe('42k');
  });
});

describe('formatTurnStatusRight', () => {
  it('joins elapsed, tokens, and queue depth', () => {
    expect(formatTurnStatusRight({ elapsed: '12s', tokens: '42k', queued: 2 })).toBe(
      '12s  42k  2 queued',
    );
    expect(formatTurnStatusRight({ elapsed: '3s', queued: 1 })).toBe('3s  1 queued');
  });
});

describe('composeTurnStatusLine', () => {
  it('right-aligns the metric chip inside the width', () => {
    const line = composeTurnStatusLine({
      width: 40,
      glyph: '◐',
      label: 'Reading 2 files',
      right: '12s  42k',
      visibleWidth: (text) => text.length,
      pad: (text) => text,
    });
    expect(line.startsWith('◐ Reading 2 files')).toBe(true);
    expect(line.endsWith('12s  42k')).toBe(true);
    expect(line.length).toBe(40);
  });
});

describe('buildTurnStatusParts', () => {
  it('builds label and right from a snapshot', () => {
    const parts = buildTurnStatusParts({
      phase: 'tool',
      tools: [{ name: 'Read', running: true }, { name: 'Grep', running: true }],
      startedAt: 1_000,
      now: 13_000,
      contextTokens: 12_000,
      queued: 2,
    });
    expect(parts.label).toBe('Reading 1 file · Searching 1 pattern');
    expect(parts.right).toBe('12s  12k  2 queued');
  });
});
