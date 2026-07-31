import { describe, expect, it } from 'vitest';

import {
  formatSearchNeverEmptyOpsHealthLine,
  formatSearchNeverEmptyTelemetryGlance,
  formatSearchNeverEmptyTelemetryLine,
  resolveSearchNeverEmptyTelemetry,
} from '../../../src/tui/utils/search/search-never-empty-telemetry';

describe('search never-empty telemetry glance', () => {
  it('formats the W13 settings line from usage.searchNeverEmpty', () => {
    expect(formatSearchNeverEmptyTelemetryLine({ hardFailCount: 0, softDegradeCount: 3 })).toBe(
      'hard-fail 0 · soft-degrade 3',
    );
  });

  it('returns null before counters are present on usage', () => {
    expect(formatSearchNeverEmptyTelemetryGlance(undefined)).toBeNull();
    expect(formatSearchNeverEmptyTelemetryGlance({})).toBeNull();
    expect(
      formatSearchNeverEmptyTelemetryGlance({
        searchNeverEmpty: { hardFailCount: 0, softDegradeCount: 0 },
      }),
    ).toBe('hard-fail 0 · soft-degrade 0');
  });

  it('resolves telemetry from usage slice', () => {
    expect(
      resolveSearchNeverEmptyTelemetry({
        searchNeverEmpty: { hardFailCount: 0, softDegradeCount: 1 },
      }),
    ).toEqual({ hardFailCount: 0, softDegradeCount: 1 });
  });

  it('formats Ops Runtime Health line from usage.searchNeverEmpty', () => {
    expect(
      formatSearchNeverEmptyOpsHealthLine({
        searchNeverEmpty: { hardFailCount: 1, softDegradeCount: 2 },
      }),
    ).toBe('Never-empty: hard-fail 1 · soft-degrade 2');
    expect(formatSearchNeverEmptyOpsHealthLine(undefined)).toBeNull();
  });
});
