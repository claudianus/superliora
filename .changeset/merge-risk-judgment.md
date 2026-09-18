---
"@superliora/liora": patch
---

Merge jobs now judge risk from the caller's risk assessment or declared sensitive paths instead of fixed diff-size thresholds and a filename blocklist; a missing judgment holds the merge instead of auto-approving it.
