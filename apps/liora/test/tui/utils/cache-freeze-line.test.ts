import { describe, expect, it } from 'vitest';

import {
  formatCacheFreezeLine,
  formatCacheFreezeOpsHealthLine,
} from '#/tui/utils/cache/cache-freeze-line';

describe('formatCacheFreezeLine', () => {
  it('returns undefined when cacheFrozen is not exposed', () => {
    expect(formatCacheFreezeLine(undefined)).toBeUndefined();
  });

  it('labels mid-turn freeze and idle between turns', () => {
    expect(formatCacheFreezeLine(true)).toBe('Freeze: active (mid-turn · step soft-check on)');
    expect(formatCacheFreezeLine(false)).toBe('Freeze: idle');
  });

  it('appends drift count when violations > 0 (Loop22b)', () => {
    expect(formatCacheFreezeLine(true, 2)).toBe(
      'Freeze: active (mid-turn · step soft-check on) · drift×2',
    );
    expect(formatCacheFreezeLine(false, 1)).toBe('Freeze: idle · drift×1');
  });
});

describe('formatCacheFreezeOpsHealthLine', () => {
  it('returns null when status.cacheFrozen is not exposed', () => {
    expect(formatCacheFreezeOpsHealthLine(undefined)).toBeNull();
  });

  it('maps live status.cacheFrozen into Runtime Health lines', () => {
    expect(formatCacheFreezeOpsHealthLine(true)).toBe(
      'Freeze: active (mid-turn · step soft-check on)',
    );
    expect(formatCacheFreezeOpsHealthLine(false)).toBe('Freeze: idle');
  });

  it('passes violations through to Ops Health line', () => {
    expect(formatCacheFreezeOpsHealthLine(false, 3)).toBe('Freeze: idle · drift×3');
  });
});
