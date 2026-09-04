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
    scope: '',
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
  it('invokes ensureFresh on the interval and can be stopped', async () => {
    vi.useFakeTimers();
    try {
      const ensureFresh = vi.fn(async () => 'token');
      const handle = startProactiveRefreshTimer(ensureFresh, 1_000);
      await vi.advanceTimersByTimeAsync(2_500);
      expect(ensureFresh).toHaveBeenCalledTimes(2);
      handle.stop();
      await vi.advanceTimersByTimeAsync(2_500);
      expect(ensureFresh).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('skips ticks while a refresh is still in flight', async () => {
    vi.useFakeTimers();
    try {
      let release!: () => void;
      const gate = new Promise<string>((resolve) => {
        release = () => {
          resolve('token');
        };
      });
      const ensureFresh = vi.fn(() => gate);
      const handle = startProactiveRefreshTimer(ensureFresh, 1_000);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(ensureFresh).toHaveBeenCalledTimes(1);
      release();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(ensureFresh).toHaveBeenCalledTimes(2);
      handle.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
