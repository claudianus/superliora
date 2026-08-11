---
"@superliora/liora": minor
---

Conductor JobCreate can keep same-context follow-ups on an existing worker: pass continue_from_job_id (or affinity=auto with ownership_paths) to steer/fold a live or queued Job, or reuse its worktree and resume checkpoint after it finishes. ACK lines may include affinity_hint when a cold create overlaps a live owner.
