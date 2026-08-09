---
"@superliora/liora": patch
---

Stop background compaction from cancelling when Conductor inject/steer or micro cutoff only appends or touches the retained tail; only a changed compacted prefix aborts the run.
