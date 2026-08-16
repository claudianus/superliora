---
"@superliora/agent-core": patch
"@superliora/liora": patch
---

Harden Conductor land-to-main: infer missing `repoPath` (session cwd / git common-dir / worktree list), land from ledger `worktreeBranch` when the worktree directory was already GC'd by a sibling land, and bound-retry git merge on `.git/index.lock` contention with a clear stale-lock hint.
