---
"@superliora/liora": patch
---

Harden the Conductor harness for marathon multi-job sessions: the job ledger now caps its growth (oldest terminal jobs are pruned first, never pending-land, pinned, or parent-referenced jobs) so long-running sessions stop re-persisting and scanning unbounded records, the shared worker spawner re-resolves the store-sensitive pool cap on every spawn (one session's projectMode cap no longer serializes another session's handshakes), schedule-pump awaiters (JobResume) now wait through re-armed follow-up drains instead of observing stale queued state, JobSteer is fully locked out of the status state machine (blocked/queued/terminal/running all rejected — parks and promotion belong to the spawner gates and scheduler), and doom-loop hard-stop notices plus job desk labels are language-neutral so the session response language governs user-facing text.
