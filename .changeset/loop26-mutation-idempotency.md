---
'@superliora/agent-core': patch
---

Wire short-window idempotency for Edit/Write/ApplyPatch so identical mutation args replay the prior result instead of double-applying, and reset the tracker at turn boundaries.
