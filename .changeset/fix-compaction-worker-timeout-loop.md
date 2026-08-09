---
"@superliora/liora": patch
---

Stop oversized background compaction from cancelling every 10 minutes and restarting: scale the worker deadline with context size, cap parallel summarize blocks, and fall back to an extractive summary if the budget still expires.
