---
"@superliora/liora": patch
---

Fix tool call results being silently dropped when a manual compaction starts while a tool exchange is still open. Late-arriving results now land in history instead of being treated as orphans.
