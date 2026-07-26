---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/records/{blobref, persistence} regression cases

- `isBlobRef()` `blobref://` protocol branches (positive / negative prefixes,
  case-sensitive, other schemes).
- `MAX_WIRE_LINE_BYTES` constant pin (64 MiB).
