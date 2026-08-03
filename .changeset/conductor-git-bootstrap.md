---
"@superliora/liora": patch
---

Fix Conductor jobs blocking forever in projects without a git repository: the repo is now initialized with a baseline commit before worktrees are assigned. Set SUPERLIORA_CONDUCTOR_AUTO_GIT_INIT=0 to keep manual setup.
