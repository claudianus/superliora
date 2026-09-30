---
"@superliora/liora": patch
---

Stop a degraded provider from stalling worker spawns: the worker model is probed before a job takes a spawn slot, and a job that cannot be spawned is reported blocked with the model reason instead of a spawn-budget timeout.