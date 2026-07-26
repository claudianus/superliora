---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/compaction/planner splitMessagesIntoTokenBlocks regression cases

- `CONTEXT_COMPACTION_V2_VERSION` literal pinning.
- `splitMessagesIntoTokenBlocks` covers empty input, single-group
  passthrough, multi-block splitting when total exceeds the target,
  message-order preservation across blocks, and a non-empty trailing
  block.
