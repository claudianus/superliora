import { describe, expect, it } from 'vitest';

import { computeSessionCostUsd } from '#/tui/utils/session-cost';

const pricing = { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 };

describe('computeSessionCostUsd', () => {
  it('computes USD from per-million pricing and token usage', () => {
    const total = { inputOther: 1_000_000, output: 1_000_000, inputCacheRead: 0, inputCacheCreation: 0 };
    // 1M input @ $3 + 1M output @ $15 = $18
    expect(computeSessionCostUsd(total, pricing)).toBeCloseTo(18, 5);
  });

  it('accounts for cache read and cache write tokens', () => {
    const total = { inputOther: 0, output: 0, inputCacheRead: 1_000_000, inputCacheCreation: 1_000_000 };
    // $0.30 + $3.75 = $4.05
    expect(computeSessionCostUsd(total, pricing)).toBeCloseTo(4.05, 5);
  });

  it('returns undefined when usage or pricing is missing', () => {
    expect(computeSessionCostUsd(undefined, pricing)).toBeUndefined();
    expect(
      computeSessionCostUsd({ inputOther: 1, output: 1, inputCacheRead: 0, inputCacheCreation: 0 }, undefined),
    ).toBeUndefined();
  });

  it('returns undefined when pricing is empty or the result is zero', () => {
    expect(
      computeSessionCostUsd({ inputOther: 100, output: 0, inputCacheRead: 0, inputCacheCreation: 0 }, {}),
    ).toBeUndefined();
    expect(
      computeSessionCostUsd({ inputOther: 0, output: 0, inputCacheRead: 0, inputCacheCreation: 0 }, pricing),
    ).toBeUndefined();
  });
});
