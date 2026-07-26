---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/context/projector trimTrailingOpenToolExchange regression cases

- `trimTrailingOpenToolExchange` covers empty history, tool-only history,
  user-tailed history, assistant without tool calls, fully-closed
  assistant tool calls, partial open exchange, and a multi-call
  assistant with at least one missing result.
