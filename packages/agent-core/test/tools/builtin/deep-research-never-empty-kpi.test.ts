import { describe, expect, it } from 'vitest';

import { getSearchNeverEmptyTelemetry, resetSearchNeverEmptyTelemetry } from '#/tools/providers/search-never-empty-telemetry';

import {
  DEEP_RESEARCH_NEVER_EMPTY_ATTEMPT_TARGET,
  DEEP_RESEARCH_NEVER_EMPTY_SUCCESS_TARGET,
  fakeDeepResearchEmptyCascadeAttempt,
  fakeDeepResearchMissingOfflineStubAttempt,
  formatDeepResearchNeverEmptyKpiReport,
  gradeDeepResearchNeverEmptyKpi,
  outputHasDeepResearchNeverEmptyMarkers,
  runDeepResearchEmptyCascadeToolAttempt,
  runDeepResearchNeverEmptyKpi,
  runDeepResearchNeverEmptyKpiWithTelemetry,
} from './deep-research-never-empty-kpi.harness';

describe('DeepResearch never-empty KPI harness (W13)', () => {
  it(`simulates ${String(DEEP_RESEARCH_NEVER_EMPTY_ATTEMPT_TARGET)} empty-cascade attempts with ≥99% soft-degrade and hard-fail 0`, () => {
    const report = runDeepResearchNeverEmptyKpi();

    expect(report.attemptCount).toBe(DEEP_RESEARCH_NEVER_EMPTY_ATTEMPT_TARGET);
    expect(report.hardFailCount).toBe(0);
    expect(report.successRate).toBeGreaterThanOrEqual(DEEP_RESEARCH_NEVER_EMPTY_SUCCESS_TARGET);
    expect(report.meetsSuccessTarget).toBe(true);
    expect(report.meetsKpi).toBe(true);

    // eslint-disable-next-line no-console -- KPI harness emits a single summary line for CI/scripts.
    console.log(formatDeepResearchNeverEmptyKpiReport(report));
  });

  it('rejects a single hard-fail streak break', () => {
    const report = runDeepResearchNeverEmptyKpi(DEEP_RESEARCH_NEVER_EMPTY_ATTEMPT_TARGET, {
      hardFailAtAttempt: 42,
    });
    expect(report.hardFailCount).toBe(1);
    expect(report.meetsKpi).toBe(false);
    expect(report.detail).toContain('hard-fail 0');
  });

  it('rejects soft-degrade below success target when offline_stub is missing', () => {
    const singleMiss = runDeepResearchNeverEmptyKpi(DEEP_RESEARCH_NEVER_EMPTY_ATTEMPT_TARGET, {
      missOfflineStubAtAttempt: 7,
    });
    expect(singleMiss.hardFailCount).toBe(0);
    expect(singleMiss.successRate).toBe(0.99);
    expect(singleMiss.meetsKpi).toBe(true);

    const withTwoMisses = gradeDeepResearchNeverEmptyKpi([
      ...Array.from({ length: DEEP_RESEARCH_NEVER_EMPTY_ATTEMPT_TARGET - 2 }, () =>
        fakeDeepResearchEmptyCascadeAttempt(),
      ),
      fakeDeepResearchMissingOfflineStubAttempt(),
      fakeDeepResearchMissingOfflineStubAttempt(),
    ]);
    expect(withTwoMisses.hardFailCount).toBe(0);
    expect(withTwoMisses.successRate).toBeLessThan(DEEP_RESEARCH_NEVER_EMPTY_SUCCESS_TARGET);
    expect(withTwoMisses.meetsKpi).toBe(false);
  });

  it('aligns graded counters with process-wide never-empty telemetry', () => {
    const report = runDeepResearchNeverEmptyKpiWithTelemetry(3);
    expect(report.telemetry).toEqual({
      hardFailCount: 0,
      softDegradeCount: 3,
    });
    expect(report.softDegradeCount).toBe(3);
  });

  it('grades pure output markers for offline stub + Ch4/Ch5 next line', () => {
    const attempt = fakeDeepResearchEmptyCascadeAttempt();
    expect(outputHasDeepResearchNeverEmptyMarkers(attempt.output)).toBe(true);
    expect(attempt.output).toContain('mode: local-only');
    expect(attempt.output).toContain('allow_browser: false');
  });

  it('soft-degrades live empty cascade without throwing (mock engine, no network)', async () => {
    resetSearchNeverEmptyTelemetry();
    const { isError, output } = await runDeepResearchEmptyCascadeToolAttempt();
    expect(isError).toBe(false);
    expect(outputHasDeepResearchNeverEmptyMarkers(output)).toBe(true);
    expect(getSearchNeverEmptyTelemetry().softDegradeCount).toBeGreaterThan(0);
    expect(getSearchNeverEmptyTelemetry().hardFailCount).toBe(0);
  });

  it('escalates to browser on allow_browser without hard-failing when SERP stays empty', async () => {
    const { isError, output } = await runDeepResearchEmptyCascadeToolAttempt({
      depth: 'quick',
      allowBrowser: true,
    });
    expect(isError).toBe(false);
    expect(output).toContain('allow_browser: true');
    expect(outputHasDeepResearchNeverEmptyMarkers(output)).toBe(true);
  });
});
