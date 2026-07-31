import { describe, expect, it, vi } from 'vitest';

import {
  startProactiveRefreshTimer,
  tokenNeedsProactiveRefresh,
} from '../src/flow/proactive-refresh';
import type { TokenInfo } from '../src/types';

describe('tokenNeedsProactiveRefresh', () => {
  const token: TokenInfo = {
    accessToken: 'access',
    refreshToken: 'refresh',
    expiresIn: 3600,
    expiresAt: 10_000,
    tokenType: 'Bearer',
  };

  it('returns false when plenty of lifetime remains', () => {
    expect(
      tokenNeedsProactiveRefresh(token, {
        now: () => 9_000,
        threshold: () => 300,
      }),
    ).toBe(false);
  });

  it('returns true when remaining lifetime is below the threshold', () => {
    expect(
      tokenNeedsProactiveRefresh(token, {
        now: () => 9_800,
        threshold: () => 300,
      }),
    ).toBe(true);
  });

  it('returns false when expiresAt is zero', () => {
    expect(
      tokenNeedsProactiveRefresh(
        { ...token, expiresAt: 0 },
        { now: () => 9_999, threshold: () => 300 },
      ),
    ).toBe(false);
  });
});

describe('startProactiveRefreshTimer', () => {
  it('invokes ensureFresh on the interval and can be stopped', () => {
    vi.useFakeTimers();
    const ensureFresh = vi.fn(async () => 'token');
    const handle = startProactiveRefreshTimer(ensureFresh, 1_000);
    vi.advanceTimersByTime(2_500);
    expect(ensureFresh).toHaveBeenCalledTimes(2);
    handle.stop();
    vi.advanceTimersByTime(2_500);
    expect(ensureFresh).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
