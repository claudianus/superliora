---
'@superliora/oauth': patch
---

test(oauth): pin oauth/credential-health.credentialHealthCacheKey regression cases

- Deterministic, non-empty output for the same `(providerId, credentialKey)`.
- Differentiates by `providerId` and by `credentialKey`.
- Falls back to the literal `"default"` for an omitted credential key.
- Trims surrounding whitespace from both inputs.
