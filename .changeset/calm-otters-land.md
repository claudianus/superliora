---
"@superliora/liora": patch
---

Verify landed jobs after the merge by recording a receipt with the resulting commit, and block the job when the branch did not actually integrate. Jobs without a worktree now clearly report that nothing was merged.
