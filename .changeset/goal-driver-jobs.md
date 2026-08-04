---
"@superliora/liora": minor
---

Add goal-driver Jobs: `JobCreate` with `kind=goal-driver` migrates the goal onto a dedicated worker that keeps turning toward it autonomously in its own worktree, so several goals can run in parallel while the conductor lane stays free. Completion criteria and token/turn/wall-clock budget caps ride on the job; hitting a cap stops the loop and surfaces the job as blocked, resumable from the ledger.
