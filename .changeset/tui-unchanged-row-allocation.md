---
"@superliora/liora": patch
---

Stop rebuilding transcript rows that have not changed on every animation frame, which cut per-frame allocation during idle and streaming.