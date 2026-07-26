---
'@superliora/oauth': patch
---

test(oauth): pin oauth/token-state regression cases

- `classifyToken` covers the `missing` kind for `undefined`, non-missing
  kind for any defined token, identical kinds for fresh and "soon-to-
  expire" tokens, and the `valid` kind for both fresh and past-expiry
  tokens (the higher "revoked" / "missing" tier is independent of the
  expiry-seconds tier).
- `revokedTombstone` clears the access / refresh tokens, zeroes the
  expiry, and preserves the prior `scope` and `tokenType`.
