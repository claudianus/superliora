---
'@superliora/liora': patch
---

Block new fleet workers when SUPERLIORA_FLEET_BUDGET_USD is already spent, create a per-worker git worktree when SUPERLIORA_FLEET_WORKTREE=1, and limit `liora worktree hygiene --stale-remotes` to remote `liora/*` branches.
