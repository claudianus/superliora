---
"@superliora/liora": patch
---

Fix resumed job workers dying instantly with "timed out after 1s — aborted by the 1ms wall-clock deadline": a resume whose inherited wall-clock budget is fully spent now relaunches with a fresh kind budget (implement 30m / mission 45m / explore 20m) instead of the 1ms exhausted sentinel, which aborted the worker before its first turn. Partially spent resumes still inherit the remaining wall-clock.
