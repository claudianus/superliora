---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/compaction/boundary-compaction regression cases

- `isSwarmToolResult` — pin the `<ultra_swarm_result>` and `<agent_swarm_result>` tag detection (with attributes), the surrounded-text acceptance, the plain-text / unrelated-XML rejection, and the case-insensitive tag name match.
- `maskStaleSwarmToolResult` — pin the verbatim return when the input is not a swarm tool result.
- `SWARM_TOTAL_RESULT_MAX_CHARS` — pin the 6_000 character cap.
