---
"@superliora/liora": patch
---

Validate PushJob batch `source_dir` values: each must be a relative path inside the job worktree, so one approved batch can no longer aim the push executor at an arbitrary directory through absolute paths or `..` segments.
