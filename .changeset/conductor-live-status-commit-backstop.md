---
"@superliora/liora": minor
---

Conductor jobs now report live worker state: the job desk feed, JobList, and JobInspect show each running worker's current step and last heartbeat, stalled workers get flagged on the ledger, and terminal notices that land mid-turn wake the conductor instead of waiting for the next prompt. Workers are instructed to commit in their worktree, and any uncommitted changes are snapshotted onto the job branch at completion and before land-to-main, so worktree cleanup can no longer discard finished work.
