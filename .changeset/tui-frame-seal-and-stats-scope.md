---
"@superliora/liora": patch
---

Cut per-frame renderer work: the background seal now walks only the rows dirtied this frame instead of all cells twice, and frame health no longer rebuilds a full stats snapshot every frame.
