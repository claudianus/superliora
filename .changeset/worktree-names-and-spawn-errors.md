---
"@superliora/liora": patch
---

Reject worktree names Windows cannot create, keep a name like `my.project.` from silently colliding with `my.project`, and say what actually went wrong when a spawned command cannot start instead of reporting an empty failure.
