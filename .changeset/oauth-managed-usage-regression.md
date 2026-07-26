---
'@superliora/oauth': patch
---

test(oauth): pin oauth/managed-usage pure helpers regression cases

- `DEFAULT_SUPERLIORA_BASE_URL` literal.
- `isManagedKimiCode` rejects unrelated / empty / nullish values.
- `kimiCodeBaseUrl` / `kimiCodeUsageUrl` return `https://` URLs on the
  same host.
- `formatDuration` covers day / hour / minute / second segments,
  zero-second output, and negative-input coercion.
- `formatResetTime` returns a "resets at …" message for empty, non-
  numeric, and numeric inputs.
- `parseManagedUsagePayload` returns an empty `limits` array for empty,
  `null`, and `undefined` payloads.
