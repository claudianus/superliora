---
"@superliora/liora": patch
---

Fix Conductor deadlock where JobCreate continue_from on a blocked parent left the reuse child permanently queued; affinity reuse children now schedule while random sibling implement jobs still wait.
