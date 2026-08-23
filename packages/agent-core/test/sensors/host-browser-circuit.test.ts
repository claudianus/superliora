import { afterEach, describe, expect, it } from 'vitest';

import {
  countHostBrowserEinvalJobs,
  HOST_BROWSER_EINVAL_RETRY_LIMIT,
  hostBrowserCircuitShouldSkip,
  recordHostBrowserCircuitHit,
  resetHostBrowserCircuitsForTests,
  sessionHostBrowserShouldEscalate,
} from '../../src/sensors/host-browser-circuit';

describe('host-browser circuit', () => {
  afterEach(() => {
    resetHostBrowserCircuitsForTests();
  });

  it('opens after two EINVAL hits and then skips', () => {
    const first = recordHostBrowserCircuitHit('sess', 'einval');
    expect(first.open).toBe(false);
    expect(hostBrowserCircuitShouldSkip(first)).toBe(false);

    const second = recordHostBrowserCircuitHit('sess', 'einval');
    expect(second.einvalCount).toBe(HOST_BROWSER_EINVAL_RETRY_LIMIT);
    expect(second.open).toBe(true);
    expect(hostBrowserCircuitShouldSkip(second)).toBe(true);
  });

  it('escalates when two jobs already recorded host_browser=einval', () => {
    const jobs = [
      { notes: 'host_browser=einval', resultSummary: 'spawn EINVAL' },
      { notes: 'host_browser=einval', resultSummary: 'visual=skipped_host' },
    ];
    expect(countHostBrowserEinvalJobs(jobs)).toBe(2);
    expect(sessionHostBrowserShouldEscalate(jobs)).toBe(true);
  });
});
