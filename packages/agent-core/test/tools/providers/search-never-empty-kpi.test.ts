import { describe, expect, it } from 'vitest';

import {
  fakeDegradeMissingFreeHintAttempt,
  fakeSoftDegradeFreeFallbackAttempt,
  formatSearchNeverEmptyKpiReport,
  gradeSearchNeverEmptyKpi,
  runSearchNeverEmptyKpi,
  runSearchNeverEmptyKpiWithTelemetry,
  SEARCH_NEVER_EMPTY_ATTEMPT_TARGET,
  SEARCH_NEVER_EMPTY_SUCCESS_TARGET,
} from './search-never-empty-kpi.harness';

describe('search never-empty KPI harness (W13)', () => {
  it(`simulates ${String(SEARCH_NEVER_EMPTY_ATTEMPT_TARGET)} free-only attempts with ≥99% soft-degrade and hard-fail 0`, () => {
    const report = runSearchNeverEmptyKpi();

    expect(report.attemptCount).toBe(SEARCH_NEVER_EMPTY_ATTEMPT_TARGET);
    expect(report.hardFailCount).toBe(0);
    expect(report.successRate).toBeGreaterThanOrEqual(SEARCH_NEVER_EMPTY_SUCCESS_TARGET);
    expect(report.meetsSuccessTarget).toBe(true);
    expect(report.meetsKpi).toBe(true);

    // eslint-disable-next-line no-console -- KPI harness emits a single summary line for CI/scripts.
    console.log(formatSearchNeverEmptyKpiReport(report));
  });

  it('rejects a single hard-fail streak break', () => {
    const report = runSearchNeverEmptyKpi(SEARCH_NEVER_EMPTY_ATTEMPT_TARGET, {
      hardFailAtAttempt: 42,
    });
    expect(report.hardFailCount).toBe(1);
    expect(report.meetsKpi).toBe(false);
    expect(report.detail).toContain('hard-fail 0');
  });

  it('rejects soft-degrade below success target when free hint is missing', () => {
    const singleMiss = runSearchNeverEmptyKpi(SEARCH_NEVER_EMPTY_ATTEMPT_TARGET, {
      missHintAtAttempt: 7,
    });
    expect(singleMiss.hardFailCount).toBe(0);
    expect(singleMiss.successRate).toBe(0.99);
    expect(singleMiss.meetsKpi).toBe(true);

    const withTwoMisses = gradeSearchNeverEmptyKpi([
      ...Array.from({ length: SEARCH_NEVER_EMPTY_ATTEMPT_TARGET - 2 }, () =>
        fakeSoftDegradeFreeFallbackAttempt(),
      ),
      fakeDegradeMissingFreeHintAttempt(),
      fakeDegradeMissingFreeHintAttempt(),
    ]);
    expect(withTwoMisses.hardFailCount).toBe(0);
    expect(withTwoMisses.successRate).toBeLessThan(SEARCH_NEVER_EMPTY_SUCCESS_TARGET);
    expect(withTwoMisses.meetsKpi).toBe(false);
  });

  it('aligns graded counters with process-wide never-empty telemetry', () => {
    const report = runSearchNeverEmptyKpiWithTelemetry(3);
    expect(report.telemetry).toEqual({
      hardFailCount: 0,
      softDegradeCount: 3,
    });
    expect(report.softDegradeCount).toBe(3);
  });
});
