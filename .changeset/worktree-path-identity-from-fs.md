---
"@superliora/liora": patch
---

Register the same worktree once when its path is spelled with different casing. Worktree identity and home-directory identity were inferred from the operating system rather than the filesystem, so on a default macOS volume — which compares paths case-insensitively — `/Users/x/Repo` and `/users/x/repo` were treated as two worktrees. Path comparison now asks the filesystem, once and cached, whether it folds case. Separators were already unified everywhere, so only case was at risk. A plugin language server watching the workspace was already doing this correctly; its answer is now shared rather than private to the file watcher.
