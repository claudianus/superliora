---
'@superliora/oauth': patch
---

test(oauth): pin oauth/errors class hierarchy regression cases

- Every subclass (`OAuthUnauthorizedError`, `OAuthConnectionError`,
  `DeviceCodeExpiredError`, `DeviceCodeTimeoutError`,
  `RetryableRefreshError`) is an instance of `OAuthError` and `Error`.
- `message` and `name` round-trip; class name matches the export.
- Device-code errors have sensible default messages and accept overrides.
- Subclasses are catchable as `OAuthError`.
