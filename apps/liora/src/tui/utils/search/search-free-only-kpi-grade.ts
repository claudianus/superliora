/**
 * Free-only search fallback — synthetic attempts + grader for smoke checks.
 */

/** Minimum soft-degrade success rate for free-fallback attempts. */
export const SEARCH_FREE_ONLY_SUCCESS_TARGET = 0.99;

/** Minimum synthetic free-fallback attempts in the default smoke path. */
export const SEARCH_FREE_ONLY_ATTEMPT_TARGET = 100;

export interface SearchFreeOnlyAttemptStub {
  readonly hardFail: boolean;
  readonly degraded: boolean;
  readonly resultsCount: number;
  readonly output: string;
}

export interface SearchFreeOnlyKpiGradeResult {
  readonly attemptCount: number;
  readonly softDegradeCount: number;
  readonly hardFailCount: number;
  readonly successRate: number;
  readonly meetsSuccessTarget: boolean;
  readonly meetsKpi: boolean;
  readonly detail: string;
}

function outputHasFreeFallbackHint(output: string): boolean {
  return (
    /\bch3\b/i.test(output) ||
    /\bfree fallback\b/i.test(output) ||
    /\bddg\b/i.test(output)
  );
}

/** Single attempt soft-degrades via Ch3/free fallback (green path). */
export function fakeSoftDegradeFreeFallbackAttempt(): SearchFreeOnlyAttemptStub {
  return {
    hardFail: false,
    degraded: true,
    resultsCount: 0,
    output: 'degraded: true\nchannelsTried: ch3\nhint: free fallback (DDG/local)',
  };
}

/** Turn-killing hard fail — counts against the hard-fail 0 target. */
export function fakeHardFailAttempt(): SearchFreeOnlyAttemptStub {
  return { hardFail: true, degraded: false, resultsCount: 0, output: '' };
}

/** Degraded empty output missing Ch3/free hint — not a usable free-fallback soft degrade. */
export function fakeDegradeMissingFreeHintAttempt(): SearchFreeOnlyAttemptStub {
  return {
    hardFail: false,
    degraded: true,
    resultsCount: 0,
    output: 'degraded: true\nchannelsTried: ch4\nnext: try browser (Ch4)',
  };
}

function isSoftDegradeSuccess(attempt: SearchFreeOnlyAttemptStub): boolean {
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
export function gradeSearchFreeOnlyKpi(
  attempts: readonly SearchFreeOnlyAttemptStub[],
): SearchFreeOnlyKpiGradeResult {
  if (attempts.length === 0) {
    return {
      attemptCount: 0,
      softDegradeCount: 0,
      hardFailCount: 0,
      successRate: 0,
      meetsSuccessTarget: false,
      meetsKpi: false,
      detail: 'no attempts',
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
  const meetsSuccessTarget = successRate >= SEARCH_FREE_ONLY_SUCCESS_TARGET;
  const meetsKpi =
    hardFailCount === 0 &&
    meetsSuccessTarget &&
    attemptCount >= SEARCH_FREE_ONLY_ATTEMPT_TARGET;

  const pct = Math.round(successRate * 100);
  const detail = meetsKpi
    ? `${String(attemptCount)} attempts · soft ${String(pct)}% · hard-fail 0 — targets met`
    : hardFailCount > 0
      ? `${String(hardFailCount)} hard-fail(s) — requires hard-fail 0`
      : meetsSuccessTarget
        ? `soft ${String(pct)}% ok; need ≥${String(SEARCH_FREE_ONLY_ATTEMPT_TARGET)} attempts`
        : `soft ${String(pct)}% below ≥${String(Math.round(SEARCH_FREE_ONLY_SUCCESS_TARGET * 100))}% target`;

  return {
    attemptCount,
    softDegradeCount,
    hardFailCount,
    successRate,
    meetsSuccessTarget,
    meetsKpi,
    detail,
  };
}

/**
 * Simulate N free-fallback attempts with fake outcomes. Default: 100 all-soft (smoke path).
 * Optional hardFailAtAttempt or missHintAtAttempt inject a single streak break.
 */
export function simulateSearchFreeOnlyKpi(
  attemptCount: number = SEARCH_FREE_ONLY_ATTEMPT_TARGET,
  options?: { readonly hardFailAtAttempt?: number; readonly missHintAtAttempt?: number },
): SearchFreeOnlyKpiGradeResult {
  const attempts: SearchFreeOnlyAttemptStub[] = [];
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

  return gradeSearchFreeOnlyKpi(attempts);
}
