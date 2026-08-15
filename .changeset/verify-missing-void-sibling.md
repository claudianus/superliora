---
"@superliora/liora": patch
---

Conductor merge no longer hard-fails when a timeout/route_fail verify child has no dual-axis JSON if a same-axis sibling already passed. Void env/timeout missing skips structured-verdict retry hops (still no Debug for missing JSON).
