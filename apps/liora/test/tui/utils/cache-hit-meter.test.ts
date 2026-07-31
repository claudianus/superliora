import { describe, expect, it } from 'vitest';

import { formatCacheHitMeter } from '#/tui/utils/cache/cache-hit-meter';

describe('formatCacheHitMeter', () => {
  it('returns no-data defaults when rate is undefined', () => {
    expect(formatCacheHitMeter(undefined)).toEqual({
      line: 'Cache hit: (no data yet)',
      meetsTarget: false,
      footerBadge: null,
    });
  });

  it('marks ≥99% as target met with cache✓ badge', () => {
    expect(formatCacheHitMeter(0.995, 2)).toEqual({
      line: 'Cache hit: 100% · streak×2 · target ≥99%',
      meetsTarget: true,
      footerBadge: { text: 'cache✓', severity: 'info' },
    });
  });

  it('adds streak spark on footer badge when streak ≥ 3', () => {
    expect(formatCacheHitMeter(0.995, 12).footerBadge).toEqual({
      text: 'cache✓×12',
      severity: 'info',
    });
  });

  it('omits streak suffix when streak is zero or missing', () => {
    expect(formatCacheHitMeter(0.99, 0).line).toBe('Cache hit: 99% · target ≥99%');
    expect(formatCacheHitMeter(0.99).line).toBe('Cache hit: 99% · target ≥99%');
  });

  it('warns below target with percentage badge', () => {
    expect(formatCacheHitMeter(0.42)).toEqual({
      line: 'Cache hit: 42% · target ≥99%',
      meetsTarget: false,
      footerBadge: { text: 'cache 42%', severity: 'warning' },
    });
  });
});
