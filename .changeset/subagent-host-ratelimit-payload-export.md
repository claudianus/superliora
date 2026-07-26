---
"@superliora/agent-core": patch
---

test(agent-core): pin `providerRateLimitErrorFromPayload` request-id extraction

The batch uses the `requestId` on the typed rate-limit error to attribute
the rate-limit hit to the right call site when scheduling the quiet window.
If a future change drops the type guard (e.g. uses `?? 'fallback'` instead
of a `typeof === 'string'` check), the batch cannot deduplicate concurrent
rate-limit signals and would re-throttle the same provider hit twice.
Expose the function behind a `__testing__` namespace and add three tests
that pin:

- extraction when `requestId` is a non-empty string,
- fallback to `null` when missing,
- fallback to `null` when the wrong type (number, object, undefined).

The `__testing__` namespace keeps the symbol out of the production surface
while still letting the regression test catch a behaviour break.
