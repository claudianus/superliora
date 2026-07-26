---
'@superliora/liora': patch
---

Fix heap OOM when resuming large sessions by streaming wire reads/rewrites and capping in-memory UI replay during restore.
