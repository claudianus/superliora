---
"@superliora/liora": patch
---

Reject Conductor JobCreate/spawn when the worker model fails a live probe (quota, auth, or provider errors) instead of queueing a doomed worker.
