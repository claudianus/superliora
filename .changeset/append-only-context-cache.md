---
"@superliora/liora": patch
---

Keep conversation history append-only for prompt-cache stability, but bound new tool results at write time (receipt + disk spill) so context pressure does not depend on full compaction alone.
