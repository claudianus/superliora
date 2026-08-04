---
"@superliora/liora": patch
---

Fix Cursor provider turns that leaked raw `<tool_call>` / `mcp_superliora_*` markup and died with Premature close by answering request-context and interaction queries, rejecting hanging native exec, and recovering text-form tool calls.
