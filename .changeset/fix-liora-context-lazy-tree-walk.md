---
"@superliora/liora": patch
---

Stop the code-context tools (LioraContext, LioraSearch, LioraSymbol, LioraCallgraph) from stalling a turn on a cold or stale index build, which could time out agents on large workspaces. Syntax trees are now walked lazily, and these tools wait for the index only within the build budget before falling back to direct search when it is not ready yet.
