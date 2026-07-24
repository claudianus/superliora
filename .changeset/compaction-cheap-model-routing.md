---
'@superliora/liora': minor
---

Route compaction to a cheap model automatically. When no explicit `compactionModel` is configured, the summarizer now picks the cheapest-looking model among the configured aliases (by well-known name patterns such as haiku/flash/nano/mini/lite/turbo) instead of the main model, falling back to the main model when nothing suitable resolves. An explicit `compactionModel` still takes priority.
