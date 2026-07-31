import { describe, expect, it } from 'vitest';

import { formatOpsTokenGlance } from '#/tui/utils/usage/ops-token-glance';

describe('formatOpsTokenGlance', () => {
  it('returns no-data when usage is missing', () => {
    expect(formatOpsTokenGlance({})).toBe('Tokens: (no data yet)');
  });

  it('formats totals from usage.total with cache hit and cost', () => {
    expect(
      formatOpsTokenGlance({
        usage: {
          total: {
            inputOther: 10_000,
            inputCacheRead: 2_300,
            inputCacheCreation: 0,
            output: 1_200,
          },
        },
        cacheHitRate: 0.99,
        costUsd: 0.42,
      }),
    ).toBe('Tokens: in 12.3K · out 1.2K · cache 99% · $0.420');
  });

  it('aggregates byModel when total is absent', () => {
    expect(
      formatOpsTokenGlance({
        usage: {
          byModel: {
            'gpt-test': { inputOther: 500, output: 50, inputCacheRead: 0, inputCacheCreation: 0 },
            'gpt-mini': { inputOther: 500, output: 50, inputCacheRead: 0, inputCacheCreation: 0 },
          },
        },
        cacheHitRate: 0.5,
      }),
    ).toBe('Tokens: in 1.0K · out 100 · cache 50%');
  });

  it('omits cache and cost when unavailable', () => {
    expect(
      formatOpsTokenGlance({
        usage: {
          total: { inputOther: 100, output: 20, inputCacheRead: 0, inputCacheCreation: 0 },
        },
      }),
    ).toBe('Tokens: in 100 · out 20');
  });

  it('shows budget cap and remaining when runtime budget env is set', () => {
    expect(
      formatOpsTokenGlance({
        usage: {
          total: { inputOther: 100, output: 20, inputCacheRead: 0, inputCacheCreation: 0 },
        },
        costUsd: 0.42,
        budgetUsd: 5,
      }),
    ).toBe('Tokens: in 100 · out 20 · $0.420 · budget $5.00 · $4.58 left');
  });

  it('shows over-budget when spend exceeds cap', () => {
    expect(
      formatOpsTokenGlance({
        usage: {
          total: { inputOther: 100, output: 20, inputCacheRead: 0, inputCacheCreation: 0 },
        },
        costUsd: 6.5,
        budgetUsd: 5,
      }),
    ).toBe('Tokens: in 100 · out 20 · $6.50 · budget $5.00 · over $1.50');
  });

  it('shows budget cap alone when spend is not tracked yet', () => {
    expect(
      formatOpsTokenGlance({
        usage: {
          total: { inputOther: 100, output: 20, inputCacheRead: 0, inputCacheCreation: 0 },
        },
        budgetUsd: 5,
      }),
    ).toBe('Tokens: in 100 · out 20 · budget $5.00');
  });
});
