---
"@superliora/liora": patch
---

Allow read-only tools (Read, Grep, Glob, web search, MCP docs) in every UltraPlan phase, including write and exit, so the agent can check code while drafting the plan instead of getting stuck. Read-only MCP servers like Context7 are now allowed too, while write-capable ones stay blocked.
