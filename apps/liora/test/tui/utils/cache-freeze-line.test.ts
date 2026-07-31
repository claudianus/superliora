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
    expect(formatCacheFreezeLine(true)).toBe('Freeze: active (mid-turn)');
    expect(formatCacheFreezeLine(false)).toBe('Freeze: idle');
  });
});

describe('formatCacheFreezeOpsHealthLine', () => {
  it('returns null when status.cacheFrozen is not exposed', () => {
    expect(formatCacheFreezeOpsHealthLine(undefined)).toBeNull();
  });

  it('maps live status.cacheFrozen into Runtime Health lines', () => {
    expect(formatCacheFreezeOpsHealthLine(true)).toBe('Freeze: active (mid-turn)');
    expect(formatCacheFreezeOpsHealthLine(false)).toBe('Freeze: idle');
  });
});
