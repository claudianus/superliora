import { describe, it, expect } from 'vitest';

import {
  formatTokenCount,
  ratioSeverity,
  safeUsageRatio,
} from '#/utils/usage/usage-format';

describe('formatTokenCount', () => {
  it('passes small values through unchanged', () => {
    expect(formatTokenCount(0)).toBe('0');
    expect(formatTokenCount(1)).toBe('1');
    expect(formatTokenCount(999)).toBe('999');
  });

  it('rounds integers over 1k to 1 decimal', () => {
    expect(formatTokenCount(1_000)).toBe('1.0K');
    expect(formatTokenCount(1_234)).toBe('1.2K');
    expect(formatTokenCount(9_876)).toBe('9.9K');
  });

  it('switches to M above a million', () => {
    expect(formatTokenCount(1_000_000)).toBe('1.0M');
    expect(formatTokenCount(2_500_000)).toBe('2.5M');
  });

  it('clamps negatives and NaN to 0', () => {
    expect(formatTokenCount(-1)).toBe('0');
    expect(formatTokenCount(Number.NaN)).toBe('0');
    expect(formatTokenCount(Number.POSITIVE_INFINITY)).toBe('0');
  });
});

describe('safeUsageRatio', () => {
  it('matches footer context usage clamping semantics', () => {
    expect(safeUsageRatio(Number.NaN)).toBe(0);
    expect(safeUsageRatio(-1)).toBe(0);
    expect(safeUsageRatio(0.427)).toBe(0.427);
    expect(safeUsageRatio(1.5)).toBe(1);
  });
});

describe('ratioSeverity', () => {
  it('ok below async reclaim band', () => {
    expect(ratioSeverity(0)).toBe('ok');
    expect(ratioSeverity(0.69)).toBe('ok');
  });
  it('warn from async through soft', () => {
    expect(ratioSeverity(0.7)).toBe('warn');
    expect(ratioSeverity(0.8)).toBe('warn');
    expect(ratioSeverity(0.89)).toBe('warn');
  });
  it('danger at or above near-hard band', () => {
    expect(ratioSeverity(0.9)).toBe('danger');
    expect(ratioSeverity(1)).toBe('danger');
  });
});
