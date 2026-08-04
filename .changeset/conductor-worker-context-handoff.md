---
"@superliora/liora": patch
---

Give Conductor workers more context up front: JobCreate accepts context_paths (read-first hints rendered into the worker prompt), child jobs chained via parent_job_id now receive the parent's result summary as prior findings, and answers delivered through JobResume survive worker relaunch instead of landing only in ledger notes.
