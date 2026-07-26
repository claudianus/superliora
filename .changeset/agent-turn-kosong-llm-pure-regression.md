---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/turn/kosong-llm pure helper regression cases

- `buildMessagesWithSystem()` prepend with system message, empty-history fallback,
  and history non-mutation.
- `classifyProviderRouteFailure()` `rate_limit` classification + undefined
  fallback for unrecognized and non-Error inputs.
