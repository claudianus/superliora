---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/provider-failover pure helpers regression cases

- `isPermanentQuotaOrBillingFailure` — pin the undefined-input `false` return, the `details.permanentQuota === true` short-circuit, the canonical quota/billing message detection, and the rejection of ordinary rate-limit messages.
- `isRetryableProviderFailure` — pin the undefined-input `false` return, the permanent-quota veto (even when `retryable: true`), the explicit `retryable: false` / `retryable: true` honours, the `PROVIDER_RATE_LIMIT` / `PROVIDER_CONNECTION_ERROR` code acceptance, and the unrelated-code rejection.
- `isRateLimitOrQuotaFailure` — pin the undefined-input `false` return, the permanent-quota veto (even when the message says "rate limit"), the `PROVIDER_RATE_LIMIT` code acceptance, the transient rate-limit message detection (`too many requests`, `provider.rate_limit`), and the unrelated-message rejection.
- `extractRetryAfterMs` — pin the missing-details `undefined` return, the direct `retryAfterMs` number, the non-finite / non-positive filter, the `retryAt - Date.now()` remaining-ms computation (positive when in the future, undefined when in the past), the seconds-vs-ms rule for `retryAfter` (small numeric and string values get ×1000, large ones stay as ms), and the non-numeric-string fallback to `undefined`.
- `resolveProviderRetryDelayMs` — pin the 500ms lower / 120_000ms upper clamp on the provider-supplied retry-after, the exponential backoff for rate-limit failures (no retryAfter set), and the global retry-backoff table for ordinary failures.
- Exported constants — pin `GOAL_PROVIDER_AUTO_RETRIES = 3` and `GOAL_PROVIDER_RATE_LIMIT_AUTO_RETRIES = 5`.
