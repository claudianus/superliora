---
'@superliora/oauth': patch
---

test(oauth): pin oauth/api-error.extractApiErrorMessage regression cases

- `extractApiErrorMessage` covers `null` / `undefined` / primitives,
  the canonical `error_description` key, `message` and `detail` fallbacks,
  top-level `error: string`, nested `error: { message }`, ordered
  `errors[]` walking, top-level array-of-payloads, and empty-string
  short-circuit.
