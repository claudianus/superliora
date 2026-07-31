import { describe, expect, it } from 'vitest';

import {
  buildOAuthRefreshDegradedEvent,
  buildOAuthRefreshDegradedEventFromError,
  buildOAuthRefreshDegradedEventFromOutcome,
  OAUTH_REFRESH_DEGRADED_HINT,
} from '../../src/runtime/oauth-refresh-degraded';

describe('buildOAuthRefreshDegradedEventFromOutcome', () => {
  it('maps unauthorized refresh to oauth runtime.degraded', () => {
    expect(
      buildOAuthRefreshDegradedEventFromOutcome(
        { success: false, reason: 'unauthorized' },
        1_700,
      ),
    ).toEqual({
      type: 'runtime.degraded',
      scope: 'oauth',
      reason: 'OAuth refresh unauthorized; re-login required',
      hint: OAUTH_REFRESH_DEGRADED_HINT,
      atMs: 1_700,
    });
  });

  it('maps network_or_other refresh failures', () => {
    expect(
      buildOAuthRefreshDegradedEventFromOutcome({ success: false, reason: 'network_or_other' })
        .reason,
    ).toBe('oauth_refresh_failed');
  });
});

describe('buildOAuthRefreshDegradedEventFromError', () => {
  it('normalizes error messages', () => {
    const event = buildOAuthRefreshDegradedEventFromError(new Error('token  expired'));
    expect(event).toEqual(buildOAuthRefreshDegradedEvent('token expired'));
  });
});
