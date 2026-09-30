---
"@superliora/liora": patch
---

Keep the cleared-tool markers micro-compaction writes byte-identical between steps, so the provider prompt cache is not invalidated on every request, and spill each cleared output once instead of rewriting it (and pruned the receipt directory) on every render.