---
"@superliora/liora": patch
---

Conductor verify Jobs that finish without dual-axis JSON no longer look merge-ready: they fail, get one automatic structured re-verify, and skip Debug. MergeJob now tells you to requeue verify for JSON instead of opening a Debug job.
