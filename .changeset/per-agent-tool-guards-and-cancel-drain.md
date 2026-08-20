---
'@superliora/liora': patch
---

Keep tool-call circuit breakers and duplicate-write detection on each agent instead of sharing them across the process, wait for a cancelled turn to finish writing before the next prompt is recorded, and keep Retry-After on HTTP 429.
