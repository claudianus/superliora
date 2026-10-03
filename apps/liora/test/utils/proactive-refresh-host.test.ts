import { describe, expect, it, vi } from 'vitest';

import { OAUTH_LOGIN_REQUIRED_CODE } from '#/constant/app';
import {
  buildOAuthRefreshFailure,
  buildOAuthRefreshFailureFromOutcome,
  OAUTH_REFRESH_FAILURE_HINT,
  startHarnessOAuthProactiveRefresh,
} from '#/utils/oauth/proactive-refresh-host';

describe('buildOAuthRefreshFailureFromOutcome', () => {
  it('maps OAuthManager refresh failure outcomes', () => {
    expect(
      buildOAuthRefreshFailureFromOutcome({ success: false, reason: 'unauthorized' }),
    ).toEqual({
      reason: 'OAuth refresh unauthorized; re-login required',
      hint: OAUTH_REFRESH_FAILURE_HINT,
    });
  });
});

describe('buildOAuthRefreshFailure', () => {
  it('normalizes error messages for credential warnings', () => {
    const failure = buildOAuthRefreshFailure(new Error('  token   expired  '));
    expect(failure).toEqual({
      reason: 'token expired',
      hint: OAUTH_REFRESH_FAILURE_HINT,
    });
  });
});

describe('startHarnessOAuthProactiveRefresh', () => {
  it('returns undefined when getAccessToken is absent', () => {
    const harness = {
      auth: {
        resolveOAuthTokenProvider: () => ({}),
      },
    } as never;
    expect(startHarnessOAuthProactiveRefresh(harness)).toBeUndefined();
  });

  it('skips ensureFresh when managed OAuth has no cached token', async () => {
    vi.useFakeTimers();
    const onRefreshFailure = vi.fn();
    const getAccessToken = vi.fn(async () => {
      throw new Error('should not refresh without a token');
    });
    const getCachedAccessToken = vi.fn(async () => undefined);
    const harness = {
      auth: {
        resolveOAuthTokenProvider: () => ({ getAccessToken }),
        getCachedAccessToken,
      },
    } as never;

    const handle = startHarnessOAuthProactiveRefresh(harness, { onRefreshFailure });
    expect(handle).toBeDefined();

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(getCachedAccessToken).toHaveBeenCalled();
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(onRefreshFailure).not.toHaveBeenCalled();

    handle?.stop();
    vi.useRealTimers();
  });

  it('does not warn about idle login-required credentials', async () => {
    vi.useFakeTimers();
    const onRefreshFailure = vi.fn();
    const error = Object.assign(
      new Error('OAuth provider "managed:kimi-api" requires login before it can be used.'),
      { code: OAUTH_LOGIN_REQUIRED_CODE },
    );
    const getAccessToken = vi.fn(async () => {
      throw error;
    });
    const harness = {
      auth: {
        resolveOAuthTokenProvider: () => ({ getAccessToken }),
      },
    } as never;

    const handle = startHarnessOAuthProactiveRefresh(harness, { onRefreshFailure });
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(getAccessToken).toHaveBeenCalledTimes(1);
    expect(onRefreshFailure).not.toHaveBeenCalled();

    handle?.stop();
    vi.useRealTimers();
  });

  it('surfaces actual refresh failures through the host callback', async () => {
    vi.useFakeTimers();
    const onRefreshFailure = vi.fn();
    const error = new Error('refresh failed');
    const getAccessToken = vi.fn(async () => {
      throw error;
    });
    const getCachedAccessToken = vi.fn(async () => 'cached-token');
    const harness = {
      auth: {
        resolveOAuthTokenProvider: () => ({ getAccessToken }),
        getCachedAccessToken,
      },
    } as never;

    const handle = startHarnessOAuthProactiveRefresh(harness, { onRefreshFailure });
    expect(handle).toBeDefined();

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(getAccessToken).toHaveBeenCalledTimes(1);
    expect(onRefreshFailure).toHaveBeenCalledWith({
      reason: 'refresh failed',
      hint: OAUTH_REFRESH_FAILURE_HINT,
    });

    handle?.stop();
    vi.useRealTimers();
  });
});
