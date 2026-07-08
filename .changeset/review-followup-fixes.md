---
"@superliora/liora": patch
---

Address code review feedback: fix the lazy-agent background-task cleanup that resolved promise settlement booleans instead of agents, fix a tool.result field access that would throw on protocol events, recover session metadata from the backup when state.json is missing, stop record persistence from burning through the latch on a single outage, and fix a double telemetry emit on auto-approved permissions. Also restore prior ultrawork mode on rollback, set planChanged before async plan reset, use the correct compaction cutoff for late-accept expiry, preserve error stacks in grace-timeout logs, and guard metadata tests with try/finally.
