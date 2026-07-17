import { describe, expect, it } from 'vitest';

import {
  CONTEXT_ASYNC_RATIO,
  CONTEXT_HARD_RATIO,
  CONTEXT_SOFT_RATIO,
  contextIsHigh,
  contextNeedsCompact,
  contextUsageSeverity,
} from '#/utils/usage/context-ladder';
import {
  DEFAULT_ASYNC_COMPACTION_TRIGGER_RATIO,
  DEFAULT_COMPACTION_BLOCK_RATIO,
  DEFAULT_COMPACTION_TRIGGER_RATIO,
} from '@superliora/sdk';

describe('context ladder constants', () => {
  it('mirrors SDK research-aligned defaults', () => {
    expect(CONTEXT_ASYNC_RATIO).toBe(DEFAULT_ASYNC_COMPACTION_TRIGGER_RATIO);
    expect(CONTEXT_SOFT_RATIO).toBe(DEFAULT_COMPACTION_TRIGGER_RATIO);
    expect(CONTEXT_HARD_RATIO).toBe(DEFAULT_COMPACTION_BLOCK_RATIO);
    expect(CONTEXT_SOFT_RATIO).toBe(0.8);
    expect(CONTEXT_ASYNC_RATIO).toBe(0.7);
    expect(CONTEXT_HARD_RATIO).toBe(0.92);
  });
});

describe('contextUsageSeverity', () => {
  it('maps async/soft/danger bands without densify false positives', () => {
    expect(contextUsageSeverity(0)).toBe('muted');
    expect(contextUsageSeverity(0.5)).toBe('muted');
    expect(contextUsageSeverity(0.69)).toBe('muted');
    expect(contextUsageSeverity(0.7)).toBe('info');
    expect(contextUsageSeverity(0.8)).toBe('warning');
    expect(contextUsageSeverity(0.9)).toBe('danger');
  });
});

describe('contextNeedsCompact / contextIsHigh', () => {
  it('only flags soft reclaim and above', () => {
    expect(contextNeedsCompact(0.79)).toBe(false);
    expect(contextNeedsCompact(0.8)).toBe(true);
    expect(contextIsHigh(0.8, 0)).toBe(false);
    expect(contextIsHigh(0.8, 10_000)).toBe(true);
  });
});
