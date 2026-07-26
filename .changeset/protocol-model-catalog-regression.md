---
'@superliora/protocol': patch
---

test(protocol): pin protocol/modelCatalog zod schemas regression cases

- `providerCatalogStatusSchema` accepts `connected` / `error` /
  `unconfigured` and rejects other values.
- `modelCatalogItemSchema` accepts a well-formed item and rejects an
  item without `model`.
- `providerCatalogItemSchema` accepts a complete item with `id`, `type`,
  `has_api_key`, and `status`.
- `providerRefreshChangeSchema` requires both `provider_id` and
  `provider_name`.
- `providerRefreshFailureSchema` accepts a failure with `provider` and
  `reason`.
