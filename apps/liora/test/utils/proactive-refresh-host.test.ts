import { describe, expect, it, vi } from 'vitest';

import { OAUTH_LOGIN_REQUIRED_CODE } from '#/constant/app';
import {
  buildOAuthRefreshDegradedEvent,
  buildOAuthRefreshDegradedEventFromOutcome,
  OAUTH_REFRESH_DEGRADED_HINT,
  startHarnessOAuthProactiveRefresh,
} from '#/utils/oauth/proactive-refresh-host';

describe('buildOAuthRefreshDegradedEventFromOutcome', () => {
  it('maps OAuthManager refresh failure outcomes', () => {
    expect(
      buildOAuthRefreshDegradedEventFromOutcome({ success: false, reason: 'unauthorized' }),
    ).toEqual({
      type: 'runtime.degraded',
      scope: 'oauth',
      reason: 'OAuth refresh unauthorized; re-login required',
      hint: OAUTH_REFRESH_DEGRADED_HINT,
      atMs: expect.any(Number),
    });
  });
});

describe('buildOAuthRefreshDegradedEvent', () => {
  it('maps errors to oauth runtime.degraded', () => {
    const event = buildOAuthRefreshDegradedEvent(new Error('token expired'), 1_700);
    expect(event).toEqual({
      type: 'runtime.degraded',
      scope: 'oauth',
      reason: 'token expired',
      hint: OAUTH_REFRESH_DEGRADED_HINT,
      atMs: 1_700,
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
    const onDegraded = vi.fn();
    const broadcastRuntimeDegraded = vi.fn();
    const getAccessToken = vi.fn(async () => {
      throw new Error('should not refresh without a token');
    });
    const getCachedAccessToken = vi.fn(async () => undefined);
    const harness = {
      auth: {
        resolveOAuthTokenProvider: () => ({ getAccessToken }),
        getCachedAccessToken,
      },
      broadcastRuntimeDegraded,
    } as never;

    const handle = startHarnessOAuthProactiveRefresh(harness, { onDegraded });
    expect(handle).toBeDefined();

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(getCachedAccessToken).toHaveBeenCalled();
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(onDegraded).not.toHaveBeenCalled();
    expect(broadcastRuntimeDegraded).not.toHaveBeenCalled();

    handle?.stop();
    vi.useRealTimers();
  });

  it('does not surface idle login-required as runtime.degraded', async () => {
    vi.useFakeTimers();
    const onDegraded = vi.fn();
    const broadcastRuntimeDegraded = vi.fn();
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
      broadcastRuntimeDegraded,
    } as never;

    const handle = startHarnessOAuthProactiveRefresh(harness, { onDegraded });
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(getAccessToken).toHaveBeenCalledTimes(1);
    expect(onDegraded).not.toHaveBeenCalled();
    expect(broadcastRuntimeDegraded).not.toHaveBeenCalled();

    handle?.stop();
    vi.useRealTimers();
  });

  it('surfaces refresh failures via onDegraded and runtime.degraded broadcast', async () => {
    vi.useFakeTimers();
    const onDegraded = vi.fn();
    const broadcastRuntimeDegraded = vi.fn();
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
      broadcastRuntimeDegraded,
    } as never;

    const handle = startHarnessOAuthProactiveRefresh(harness, { onDegraded });
    expect(handle).toBeDefined();

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(getAccessToken).toHaveBeenCalledTimes(1);
    expect(onDegraded).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'runtime.degraded',
        scope: 'oauth',
        reason: 'refresh failed',
      }),
    );
    expect(broadcastRuntimeDegraded).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'runtime.degraded',
        scope: 'oauth',
        reason: 'refresh failed',
      }),
    );

    handle?.stop();
    vi.useRealTimers();
  });
});
