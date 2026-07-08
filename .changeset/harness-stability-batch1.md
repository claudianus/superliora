---
"@superliora/liora": patch
---

Harden three data-integrity paths: write session metadata atomically with a rotated backup so a crash mid-write no longer corrupts resume; recover agent record persistence after a transient write failure instead of permanently bricking it; and drop volatile WebSocket frames for slow subscribers so one lagging client can't exhaust server memory on high-throughput sessions.
