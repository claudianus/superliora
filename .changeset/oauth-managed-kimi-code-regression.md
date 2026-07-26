---
'@superliora/oauth': patch
---

test(oauth): pin oauth/managed-kimi-code pure helpers regression cases

- `SUPERLIORA_PLATFORM_ID`, `MANAGED_KIMI_API_PROVIDER`,
  `SUPERLIORA_PROVIDER_NAME`, `SUPERLIORA_OAUTH_KEY` literals.
- `parseModelProtocol` accepts the canonical `anthropic` literal and
  rejects unknown / empty / nullish / non-string values.
- `allocateManagedKimiOAuthAccountKey` returns a stable non-null object
  for the same inputs.
- `ManagedKimiCodeModelsAuthError` is an `Error` subclass with the
  expected name.
