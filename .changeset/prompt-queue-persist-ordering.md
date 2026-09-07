---
"@superliora/liora": patch
---

Serialize the durable prompt-queue sidecar writes: rapid submissions previously raced several best-effort writes on the same tmp file, and the persisted queue could end up corrupt or rolled back to a stale snapshot, losing restart recovery of the newest prompts.
