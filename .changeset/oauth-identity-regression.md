---
'@superliora/oauth': patch
---

test(oauth): pin oauth/identity pure helpers regression cases

- `SUPERLIORA_PLATFORM` is a non-empty string.
- `createKimiUserAgent` round-trips `userAgentProduct` and `version`.
- `assertKimiHostIdentity` returns the input identity when valid, throws
  on `undefined`, and throws when given an undefined identity.
