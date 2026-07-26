---
'@superliora/oauth': patch
---

test(oauth): pin oauth/open-platform pure helpers regression cases

- `OPEN_PLATFORMS` is a non-empty list with string `id` keys.
- `isOpenPlatformId` agrees with `OPEN_PLATFORMS` membership and rejects
  unknown ids.
- `getOpenPlatformById` returns the matching entry or `undefined`.
- `OpenPlatformApiError` preserves `message` and `status` and is
  catchable as `Error`.
- `filterModelsByPrefix` returns an array of the same length as the
  input, and an empty list for an empty input.
