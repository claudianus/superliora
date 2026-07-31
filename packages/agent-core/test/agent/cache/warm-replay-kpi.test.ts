import { describe, expect, it } from 'vitest';

import {
  formatWarmReplayKpiReport,
  runWarmReplayKpi,
  WARM_HIT_TARGET,
  WARM_REPLAY_TURN_COUNT,
  WARM_STREAK_MIN_INPUT,
} from './warm-replay-kpi.harness';

describe('warm replay cache KPI harness (W1)', () => {
  it(`simulates ${String(WARM_REPLAY_TURN_COUNT)} turns with stable prefix and ≥99% warm-phase hit rate`, () => {
    const report = runWarmReplayKpi();

    expect(report.prefixStable).toBe(true);
    expect(report.warmTurnCount).toBe(WARM_REPLAY_TURN_COUNT - 1);
    expect(report.warmTurnPassRate).toBeGreaterThanOrEqual(WARM_HIT_TARGET);
    expect(report.warmTurnsAtTarget).toBe(report.warmTurnCount);
    expect(report.cacheWarmStreak).toBe(WARM_REPLAY_TURN_COUNT - 1);
    expect(report.missReasons).toEqual({ schema_change: 1 });

    for (const turn of report.turns.slice(report.bootstrapTurns)) {
      expect(turn.hitRate).toBeGreaterThanOrEqual(WARM_HIT_TARGET);
      expect(turn.usage.inputCacheCreation).toBe(0);
    }

    // eslint-disable-next-line no-console -- KPI harness emits a single summary line for CI/scripts.
    console.log(formatWarmReplayKpiReport(report));
  });

  it('uses mocked token shapes above the warm-streak input threshold', () => {
    const report = runWarmReplayKpi({ turnCount: 3, bootstrapTurns: 1 });
    for (const turn of report.turns) {
      const input =
        turn.usage.inputOther + turn.usage.inputCacheRead + turn.usage.inputCacheCreation;
      expect(input).toBeGreaterThanOrEqual(WARM_STREAK_MIN_INPUT);
    }
  });
});
