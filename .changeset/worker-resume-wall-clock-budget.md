---
"@superliora/agent-core": patch
---

fix(agent-core): reassign fresh wall-clock budget when resuming an exhausted session

A job-worker resume whose inherited wall-clock was fully spent launched
with the 1ms `EXHAUSTED_JOB_WORKER_TIMEOUT_MS` sentinel, aborting the
worker before its first turn. `resolveJobWorkerLaunchTimeoutMs` now
re-grants the fresh kind budget on a fully spent resume (implement 30m /
mission 45m / explore 20m); partially spent resumes still inherit the
remaining wall-clock, and `timeoutMs: 0` stays exclusively the env
kill-switch.
