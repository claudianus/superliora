---
"@superliora/liora": patch
---

Starting a session with worktree isolation in a fresh or completely empty folder no longer blocks: the harness now auto-initializes a local git repo and creates a baseline commit (empty folders get an empty baseline commit) before creating the worktree. This covers `liora --worktree`, `/fork --worktree`, fleet workers, and Conductor jobs; repos that were initialized but never committed are repaired the same way. Set SUPERLIORA_AUTO_GIT_INIT=0 to keep manual setup.
