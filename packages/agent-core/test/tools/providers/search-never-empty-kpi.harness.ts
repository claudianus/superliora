/**
 * Sovereign Reform W13 — free-only / never-empty search KPI harness.
 * Deterministic mock attempts (no live network).
 */

import {
  formatSearchNeverEmptySoftFailLines,
} from '#/tools/providers/research-search-health';
import {
  getSearchNeverEmptyTelemetry,
  resetSearchNeverEmptyTelemetry,
  type SearchNeverEmptyTelemetry,
} from '#/tools/providers/search-never-empty-telemetry';

/** Minimum soft-degrade success rate for free-fallback attempts. */
export const SEARCH_NEVER_EMPTY_SUCCESS_TARGET = 0.99;

/** Minimum synthetic free-fallback attempts in the default smoke path. */
export const SEARCH_NEVER_EMPTY_ATTEMPT_TARGET = 100;

export interface SearchNeverEmptyAttemptStub {
  readonly hardFail: boolean;
  readonly degraded: boolean;
  readonly resultsCount: number;
  readonly output: string;
}

export interface SearchNeverEmptyKpiReport {
  readonly attemptCount: number;
  readonly softDegradeCount: number;
  readonly hardFailCount: number;
  readonly successRate: number;
  readonly meetsSuccessTarget: boolean;
  readonly meetsKpi: boolean;
  readonly detail: string;
  readonly telemetry: SearchNeverEmptyTelemetry;
}

function outputHasFreeFallbackHint(output: string): boolean {
  return (
    /\bch3\b/i.test(output) ||
    /\bfree fallback\b/i.test(output) ||
    /\bddg\b/i.test(output)
  );
}

/** Single attempt soft-degrades via Ch3/free fallback (green path). */
export function fakeSoftDegradeFreeFallbackAttempt(): SearchNeverEmptyAttemptStub {
  return {
    hardFail: false,
    degraded: true,
    resultsCount: 0,
    output: 'degraded: true\nchannelsTried: ch3\nhint: free fallback (DDG/local)',
  };
}

/** Turn-killing hard fail — counts against the hard-fail 0 target. */
export function fakeHardFailAttempt(): SearchNeverEmptyAttemptStub {
  return { hardFail: true, degraded: false, resultsCount: 0, output: '' };
}

/** Degraded empty output missing Ch3/free hint — not a usable free-fallback soft degrade. */
export function fakeDegradeMissingFreeHintAttempt(): SearchNeverEmptyAttemptStub {
  return {
    hardFail: false,
    degraded: true,
    resultsCount: 0,
    output: 'degraded: true\nchannelsTried: ch4\nnext: try browser (Ch4)',
  };
}

function isSoftDegradeSuccess(attempt: SearchNeverEmptyAttemptStub): boolean {
  if (attempt.hardFail) {
    return false;
  }
  if (attempt.resultsCount > 0) {
    return true;
  }
  if (!attempt.degraded) {
    return false;
  }
  if (attempt.output.length === 0) {
    return true;
  }
  return outputHasFreeFallbackHint(attempt.output);
}

/** Grade synthetic free-fallback attempts — soft-degrade rate + hard-fail count vs targets. */
export function gradeSearchNeverEmptyKpi(
  attempts: readonly SearchNeverEmptyAttemptStub[],
): SearchNeverEmptyKpiReport {
  if (attempts.length === 0) {
    return {
      attemptCount: 0,
      softDegradeCount: 0,
      hardFailCount: 0,
      successRate: 0,
      meetsSuccessTarget: false,
      meetsKpi: false,
      detail: 'no attempts',
      telemetry: { hardFailCount: 0, softDegradeCount: 0 },
    };
  }

  let softDegradeCount = 0;
  let hardFailCount = 0;
  for (const attempt of attempts) {
    if (attempt.hardFail) {
      hardFailCount += 1;
      continue;
    }
    if (isSoftDegradeSuccess(attempt)) {
      softDegradeCount += 1;
    }
  }

  const attemptCount = attempts.length;
  const successRate = softDegradeCount / attemptCount;
  const meetsSuccessTarget = successRate >= SEARCH_NEVER_EMPTY_SUCCESS_TARGET;
  const meetsKpi =
    hardFailCount === 0 &&
    meetsSuccessTarget &&
    attemptCount >= SEARCH_NEVER_EMPTY_ATTEMPT_TARGET;

  const pct = Math.round(successRate * 100);
  const detail = meetsKpi
    ? `${String(attemptCount)} attempts · soft ${String(pct)}% · hard-fail 0 — targets met`
    : hardFailCount > 0
      ? `${String(hardFailCount)} hard-fail(s) — requires hard-fail 0`
      : meetsSuccessTarget
        ? `soft ${String(pct)}% ok; need ≥${String(SEARCH_NEVER_EMPTY_ATTEMPT_TARGET)} attempts`
        : `soft ${String(pct)}% below ≥${String(Math.round(SEARCH_NEVER_EMPTY_SUCCESS_TARGET * 100))}% target`;

  return {
    attemptCount,
    softDegradeCount,
    hardFailCount,
    successRate,
    meetsSuccessTarget,
    meetsKpi,
    detail,
    telemetry: { hardFailCount, softDegradeCount },
  };
}

/**
 * Simulate N free-fallback attempts with fake outcomes. Default: 100 all-soft (smoke path).
 * Optional hardFailAtAttempt or missHintAtAttempt inject a single streak break.
 */
export function runSearchNeverEmptyKpi(
  attemptCount: number = SEARCH_NEVER_EMPTY_ATTEMPT_TARGET,
  options?: { readonly hardFailAtAttempt?: number; readonly missHintAtAttempt?: number },
): SearchNeverEmptyKpiReport {
  const attempts: SearchNeverEmptyAttemptStub[] = [];
  const hardFailAtAttempt = options?.hardFailAtAttempt;
  const missHintAtAttempt = options?.missHintAtAttempt;

  for (let i = 0; i < attemptCount; i++) {
    const attemptIndex = i + 1;
    if (hardFailAtAttempt === attemptIndex) {
      attempts.push(fakeHardFailAttempt());
    } else if (missHintAtAttempt === attemptIndex) {
      attempts.push(fakeDegradeMissingFreeHintAttempt());
    } else {
      attempts.push(fakeSoftDegradeFreeFallbackAttempt());
    }
  }

  return gradeSearchNeverEmptyKpi(attempts);
}

/** Record one soft-degrade via the production never-empty footer helper (no network). */
export function recordSoftDegradeViaNeverEmptyFooter(): void {
  formatSearchNeverEmptySoftFailLines({
    degraded: true,
    health: {
      degraded: true,
      hard: false,
      hint: 'Paid slots cooling.',
    },
    channelsTried: ['ch1', 'ch3'],
  });
}

/** Run default smoke KPI and sync counters through process-wide telemetry. */
export function runSearchNeverEmptyKpiWithTelemetry(
  attemptCount: number = SEARCH_NEVER_EMPTY_ATTEMPT_TARGET,
): SearchNeverEmptyKpiReport {
  resetSearchNeverEmptyTelemetry();
  const report = runSearchNeverEmptyKpi(attemptCount);
  for (let i = 0; i < report.softDegradeCount; i++) {
    recordSoftDegradeViaNeverEmptyFooter();
  }
  const telemetry = getSearchNeverEmptyTelemetry();
  return {
    ...report,
    telemetry,
  };
}

/** One-line KPI summary for script / CI logs. */
export function formatSearchNeverEmptyKpiReport(report: SearchNeverEmptyKpiReport): string {
  const pct = (report.successRate * 100).toFixed(1);
  return (
    `search-never-empty-kpi: attempts=${String(report.attemptCount)} ` +
    `soft=${String(report.softDegradeCount)}/${String(report.attemptCount)} (${pct}% ≥${String(SEARCH_NEVER_EMPTY_SUCCESS_TARGET * 100)}%) ` +
    `hard-fail=${String(report.hardFailCount)} ` +
    `meetsKpi=${String(report.meetsKpi)} ` +
    `telemetry=${JSON.stringify(report.telemetry)}`
  );
}
