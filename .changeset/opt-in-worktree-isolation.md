---
"@superliora/liora": patch
---

Roll back default session worktree auto-isolation. New sessions stay on the current checkout unless you pass `--worktree [name]`. Prefer a dedicated worktree/branch for large or parallel work instead of forcing isolation on every launch.
