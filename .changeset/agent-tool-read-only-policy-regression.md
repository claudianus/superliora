---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/permission/policies/tool-read-only regression cases

- `isReadOnlyTool` — pin the explicit `readOnly: true` and `readOnly: false` flag honours, the rejection of tools with mutating accesses (write / readwrite) even when the name is in the read-only set, the acceptance of names in `READ_ONLY_TOOL_NAMES` with empty accesses, the MCP `mcp__<server>__<tool>` keyword-token match (and the rejection of substrings / malformed names without a server separator), the rejection of unknown names without an explicit flag, and the non-classification of side-effect tools (Agent / BrowserObserve) that declare `accesses: []` but have no read-only flag.
- `READ_ONLY_TOOL_NAMES` — pin the membership of `Read` / `LioraRead` / `WebSearch` / `TodoList` and the non-membership of `Bash` / `Write` / `Edit`.
