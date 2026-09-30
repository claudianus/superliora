---
"@superliora/liora": patch
---

Stop the animated stage frame from copying a whole row for each painted cell, which cut per-frame allocation while it animates.