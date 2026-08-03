import { describe, expect, it } from 'vitest';

import {
  GOAL_PROVIDER_AUTO_RETRIES,
  GOAL_PROVIDER_RATE_LIMIT_AUTO_RETRIES,
  extractRetryAfterMs,
  isPermanentQuotaOrBillingFailure,
  isRateLimitOrQuotaFailure,
  isRetryableProviderFailure,
  resolveProviderRetryDelayMs,
} from '#/agent/provider-failover';
import { ErrorCodes, type LioraErrorPayload } from '#/errors/index';

const err = (over: Partial<LioraErrorPayload> = {}): LioraErrorPayload => ({
  code: ErrorCodes.PROVIDER_RATE_LIMIT,
  message: 'rate limit',
  ...over,
});

describe('agent/provider-failover — isPermanentQuotaOrBillingFailure', () => {
  it('returns false for undefined', () => {
    expect(isPermanentQuotaOrBillingFailure(undefined)).toBe(false);
  });

  it('returns true when details.permanentQuota is true', () => {
    expect(isPermanentQuotaOrBillingFailure(err({ details: { permanentQuota: true } }))).toBe(true);
  });

  it('returns true for the canonical quota/billing messages', () => {
    expect(isPermanentQuotaOrBillingFailure(err({ message: 'insufficient credit' }))).toBe(true);
    expect(isPermanentQuotaOrBillingFailure(err({ message: 'Payment required' }))).toBe(true);
  });

  it('returns false for an ordinary rate-limit message', () => {
    expect(isPermanentQuotaOrBillingFailure(err({ message: 'rate limit exceeded' }))).toBe(false);
  });
});

describe('agent/provider-failover — isRetryableProviderFailure', () => {
  it('returns false for undefined', () => {
    expect(isRetryableProviderFailure(undefined)).toBe(false);
  });

  it('returns false for a permanent quota / billing failure even when retryable=true', () => {
    expect(
      isRetryableProviderFailure(err({ retryable: true, details: { permanentQuota: true } })),
    ).toBe(false);
  });

  it('honors explicit retryable=false', () => {
    expect(isRetryableProviderFailure(err({ retryable: false }))).toBe(false);
  });

  it('honors explicit retryable=true', () => {
    expect(isRetryableProviderFailure(err({ retryable: true }))).toBe(true);
  });

  it('accepts PROVIDER_RATE_LIMIT and PROVIDER_CONNECTION_ERROR by code', () => {
    // Serialized provider errors always carry the registry `retryable` flag
    // (KIMI_ERROR_INFO), so retryability is asserted on that real payload shape.
    expect(
      isRetryableProviderFailure({
        code: ErrorCodes.PROVIDER_RATE_LIMIT,
        message: 'x',
        retryable: true,
      }),
    ).toBe(true);
    expect(
      isRetryableProviderFailure({
        code: ErrorCodes.PROVIDER_CONNECTION_ERROR,
        message: 'x',
        retryable: true,
      }),
    ).toBe(true);
  });

  it('rejects an unrelated error code without retryable flag', () => {
    expect(isRetryableProviderFailure({ code: ErrorCodes.BAD_REQUEST, message: 'x' })).toBe(false);
  });
});

describe('agent/provider-failover — isRateLimitOrQuotaFailure', () => {
  it('returns false for undefined', () => {
    expect(isRateLimitOrQuotaFailure(undefined)).toBe(false);
  });

  it('returns false for permanent quota / billing even when message says "rate limit"', () => {
    expect(
      isRateLimitOrQuotaFailure(err({ message: 'rate limit', details: { permanentQuota: true } })),
    ).toBe(false);
  });

  it('accepts the PROVIDER_RATE_LIMIT code', () => {
    expect(isRateLimitOrQuotaFailure({ code: ErrorCodes.PROVIDER_RATE_LIMIT, message: 'x' })).toBe(
      true,
    );
  });

  it('accepts transient rate-limit messages', () => {
    expect(isRateLimitOrQuotaFailure({ code: 'OTHER', message: 'Too many requests' })).toBe(true);
    expect(isRateLimitOrQuotaFailure({ code: 'OTHER', message: 'provider.rate_limit hit' })).toBe(
      true,
    );
  });

  it('rejects an unrelated message', () => {
    expect(isRateLimitOrQuotaFailure({ code: 'OTHER', message: 'something else' })).toBe(false);
  });
});

describe('agent/provider-failover — extractRetryAfterMs', () => {
  it('returns undefined when details is missing', () => {
    expect(extractRetryAfterMs(err())).toBeUndefined();
  });

  it('reads the retryAfterMs number directly', () => {
    expect(extractRetryAfterMs(err({ details: { retryAfterMs: 12_345 } }))).toBe(12_345);
  });

  it('ignores non-finite or non-positive retryAfterMs', () => {
    expect(extractRetryAfterMs(err({ details: { retryAfterMs: NaN } }))).toBeUndefined();
    expect(extractRetryAfterMs(err({ details: { retryAfterMs: -1 } }))).toBeUndefined();
  });

  it('computes remaining ms from retryAt - Date.now() when positive', () => {
    const retryAt = Date.now() + 5_000;
    const remaining = extractRetryAfterMs(err({ details: { retryAt } }));
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(5_000);
  });

  it('treats past retryAt as undefined', () => {
    expect(extractRetryAfterMs(err({ details: { retryAt: Date.now() - 60_000 } }))).toBeUndefined();
  });

  it('treats small numeric retryAfter as seconds (multiplies by 1000)', () => {
    expect(extractRetryAfterMs(err({ details: { retryAfter: 5 } }))).toBe(5_000);
  });

  it('keeps large numeric retryAfter as milliseconds', () => {
    expect(extractRetryAfterMs(err({ details: { retryAfter: 30_000 } }))).toBe(30_000);
  });

  it('parses numeric retryAfter strings (with seconds-vs-ms rule)', () => {
    expect(extractRetryAfterMs(err({ details: { retryAfter: '2' } }))).toBe(2_000);
    expect(extractRetryAfterMs(err({ details: { retryAfter: '5000' } }))).toBe(5_000);
  });

  it('ignores non-numeric retryAfter strings', () => {
    expect(extractRetryAfterMs(err({ details: { retryAfter: 'soon' } }))).toBeUndefined();
  });
});

describe('agent/provider-failover — resolveProviderRetryDelayMs', () => {
  it('clamps the provider-supplied retryAfter to the supported range', () => {
    // Lower bound = 500ms, upper bound = 120_000ms.
    const small = resolveProviderRetryDelayMs(err({ details: { retryAfterMs: 10 } }), 0, false);
    expect(small).toBe(500);
    const huge = resolveProviderRetryDelayMs(err({ details: { retryAfterMs: 1_000_000 } }), 0, false);
    expect(huge).toBe(120_000);
  });

  it('uses an exponential backoff for rate-limit failures when no retryAfter is set', () => {
    const d0 = resolveProviderRetryDelayMs(err(), 0, true);
    const d1 = resolveProviderRetryDelayMs(err(), 1, true);
    const d2 = resolveProviderRetryDelayMs(err(), 2, true);
    expect(d1).toBeGreaterThan(d0);
    expect(d2).toBeGreaterThan(d1);
    // All within the clamp range.
    expect(d2).toBeLessThanOrEqual(120_000);
  });

  it('falls back to the global retry-backoff table for ordinary failures', () => {
    const d0 = resolveProviderRetryDelayMs(err(), 0, false);
    const d1 = resolveProviderRetryDelayMs(err(), 1, false);
    expect(d1).toBeGreaterThan(d0);
  });
});

describe('agent/provider-failover — exported constants', () => {
  it('pins the auto-retry budgets', () => {
    expect(GOAL_PROVIDER_AUTO_RETRIES).toBe(3);
    expect(GOAL_PROVIDER_RATE_LIMIT_AUTO_RETRIES).toBe(5);
  });
});
