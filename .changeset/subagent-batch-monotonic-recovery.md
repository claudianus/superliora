---
'@superliora/agent-core': patch
---

fix(agent-core): use monotonic clock for subagent-batch capacity recovery

The 3-minute rate-limit "quiet window" and the 2-second shrink throttle
in `SubagentBatch` were both measured against `Date.now()`, so a
wall-clock jump (NTP correction, suspend/resume, manual change) could
spuriously trigger or suppress capacity recovery. Switched those checks
to `process.hrtime.bigint()`-based monotonic milliseconds while keeping
`Date.now()` for `setTimeout` deadlines (the OS scheduler aligns
timeouts to wall time anyway). Wall-clock source: tools/cron/clock.ts
documents the same convention.
