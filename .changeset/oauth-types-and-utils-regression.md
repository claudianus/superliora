---
'@superliora/oauth': patch
---

test(oauth): pin oauth/types + utils regression cases

- `isRecord` covers plain objects, arrays, null, primitives, and undefined.
- `tokenToWire` maps camelCase `TokenInfo` to snake_case `TokenInfoWire`.
- `tokenFromWire` round-trips a fully populated record, fills missing
  strings with empty strings, coerces non-numeric `expires_at` /
  `expires_in` to `0`, and combined with `tokenToWire` is a lossless
  round-trip.
