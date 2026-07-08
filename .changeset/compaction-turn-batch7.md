---
"@superliora/liora": patch
---

Relax the observed max context toward the configured maximum each successful turn so a single transient overflow no longer permanently tightens compaction for the rest of the session. Compute the merged compaction quality once instead of three times in the repaired-summary path. Resolve the turn first-request gate on clean turn completion so callers can treat rejection strictly as an error.
