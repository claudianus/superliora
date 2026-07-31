import { describe, expect, it } from 'vitest';

import {
  formatSearchNeverEmptyTelemetryLine,
  getSearchNeverEmptyTelemetry,
  recordSearchNeverEmptyHardFail,
  recordSearchNeverEmptySoftDegrade,
  resetSearchNeverEmptyTelemetry,
} from '../../../src/tools/providers/search-never-empty-telemetry';

describe('search-never-empty-telemetry', () => {
  it('starts at zero and formats the W13 glance line', () => {
    resetSearchNeverEmptyTelemetry();
    expect(getSearchNeverEmptyTelemetry()).toEqual({
      hardFailCount: 0,
      softDegradeCount: 0,
    });
    expect(formatSearchNeverEmptyTelemetryLine()).toBe('hard-fail 0 · soft-degrade 0');
  });

  it('increments soft-degrade and hard-fail independently', () => {
    resetSearchNeverEmptyTelemetry();
    recordSearchNeverEmptySoftDegrade(2);
    recordSearchNeverEmptyHardFail(1);
    expect(formatSearchNeverEmptyTelemetryLine()).toBe('hard-fail 1 · soft-degrade 2');
  });
});
