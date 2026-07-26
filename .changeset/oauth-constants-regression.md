---
'@superliora/oauth': patch
---

test(oauth): pin oauth/constants regression cases

- `DEFAULT_SUPERLIORA_OAUTH_HOST` is an `https://` URL.
- `SUPERLIORA_FLOW_CONFIG` is a non-null object with at least one key.
- Every URL-shaped string in `SUPERLIORA_FLOW_CONFIG` is a non-empty
  `https?://` literal.
