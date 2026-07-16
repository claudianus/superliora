---
'@superliora/agent-core': minor
'@superliora/liora': patch
---

Tighten full compaction recent-size keep ratio to 7% so long sessions reclaim denser working memory while still keeping the last two messages.
