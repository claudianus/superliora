import type { FooterBadgeSeverity } from '#/tui/components/chrome/footer/footer-badges';

export const CACHE_HIT_TARGET = 0.99;

export interface CacheHitMeterResult {
  readonly line: string;
  readonly meetsTarget: boolean;
  readonly footerBadge: {
    readonly text: string;
    readonly severity: FooterBadgeSeverity;
  } | null;
}

export function formatCacheHitMeter(
  rate: number | undefined,
  streak?: number,
): CacheHitMeterResult {
  if (rate === undefined || !Number.isFinite(rate)) {
    return {
      line: 'Cache hit: (no data yet)',
      meetsTarget: false,
      footerBadge: null,
    };
  }

  const pct = Math.round(rate * 100);
  const meetsTarget = rate >= CACHE_HIT_TARGET;
  const streakSuffix =
    streak !== undefined && streak > 0 ? ` · streak×${String(streak)}` : '';
  const line = `Cache hit: ${String(pct)}%${streakSuffix} · target ≥99%`;

  const streakSpark =
    streak !== undefined && streak >= 3 ? `×${String(streak)}` : '';
  const footerBadge = meetsTarget
    ? {
        text: `cache✓${streakSpark}`,
        severity: 'info' as const,
      }
    : { text: `cache ${String(pct)}%`, severity: 'warning' as const };

  return { line, meetsTarget, footerBadge };
}
