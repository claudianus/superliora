---
"@superliora/liora": patch
---

Reuse the parent job's worktree for chained child jobs while the parent has not landed, so the child's commits accumulate on the branch that actually gets merged.
