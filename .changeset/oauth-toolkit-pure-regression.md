---
'@superliora/oauth': patch
---

test(oauth): pin oauth/toolkit.resolveKimiTokenStorageName regression cases

- Default (no inputs) returns `kimi-code`.
- `oauthKey: 'kimi-code'` and `oauthKey: 'oauth/kimi-code'` both return
  the canonical `kimi-code` storage name.
- Alternative `oauthKey` produces a non-empty custom storage name.
- Throws when the `providerName` is not the managed `kimi-api` provider.
