---
"@superliora/liora": patch
---

Stop auto-splitting Conductor jobs by ownership_paths, and wait for parent jobs to finish before starting chained children so parallel spawns stop racing file leases.
