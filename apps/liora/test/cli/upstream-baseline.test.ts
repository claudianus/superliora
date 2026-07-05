import { describe, expect, it } from 'vitest';

import {
  formatUpstreamBaselineSummary,
  getUpstreamBaseline,
} from '#/cli/upstream-baseline';

describe('upstream baseline', () => {
  it('formats the embedded baseline for /status', () => {
    const baseline = getUpstreamBaseline();
    expect(formatUpstreamBaselineSummary(baseline)).toBe(
      'kimi-code 0.22.x @ main@8fbe8553 (sync 2026-07-05, 8fbe85531b05)',
    );
  });
});
