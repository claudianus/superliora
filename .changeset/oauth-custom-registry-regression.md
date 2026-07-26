---
'@superliora/oauth': patch
---

test(oauth): pin oauth/custom-registry pure helpers regression cases

- `CUSTOM_REGISTRY_DEFAULT_MAX_CONTEXT` (= 131072) and the default
  capability tuple.
- `CustomRegistryApiError` exposes `message`, `name`, `status`, and is
  catchable as `Error`.
- `capabilitiesFromCustomEntry` covers the empty-entry default, `tool_use`
  via `tool_call: true`, `thinking` via `reasoning: true` and
  `interleaved`, image / video / audio modality detection, and
  dedup of overlapping hints.
