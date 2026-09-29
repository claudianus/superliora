---
"@superliora/liora": patch
---

Keep worktrees and file watching reliable on case-insensitive filesystems: a worktree whose files are still open is no longer dropped from the registry, file-change events are no longer lost to a path-casing difference, and hook commands are not mistaken for directories.
