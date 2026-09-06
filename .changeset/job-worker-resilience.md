---
"@superliora/liora": patch
---

Stop job workers from stalling and dying mid-finish: workers run with auto-approval inside their isolated worktree, and the 30m wall-clock deadline now grants a one-shot 5-minute finishing window before aborting.
