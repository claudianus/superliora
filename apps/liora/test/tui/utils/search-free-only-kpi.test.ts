import { describe, expect, it } from 'vitest';

import {
  formatSearchFreeOnlyKpiSessionGlance,
  gradeSearchFreeOnlyKpiFromNeverEmpty,
} from '#/tui/utils/search/search-free-only-kpi';

describe('search free-only KPI — live never-empty telemetry', () => {
  it('grades live never-empty counters against success target', () => {
    const meter = gradeSearchFreeOnlyKpiFromNeverEmpty({
      hardFailCount: 0,
      softDegradeCount: 1,
    });
    expect(meter).toEqual({
      line: 'soft 100% · hard-fail 0 · target ≥99%',
      meetsSuccessTarget: true,
      meetsKpi: false,
    });
  });

  it('formatSearchFreeOnlyKpiSessionGlance returns null before any degrade', () => {
    expect(
      formatSearchFreeOnlyKpiSessionGlance({
        searchNeverEmpty: { hardFailCount: 0, softDegradeCount: 0 },
      }),
    ).toBeNull();
  });

  it('formatSearchFreeOnlyKpiSessionGlance surfaces live session KPI line', () => {
    expect(
      formatSearchFreeOnlyKpiSessionGlance({
        searchNeverEmpty: { hardFailCount: 0, softDegradeCount: 2 },
      }),
    ).toBe('soft 100% · hard-fail 0 · target ≥99%');
  });
});
