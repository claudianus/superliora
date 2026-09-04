---
"@superliora/liora": patch
---

Make provider recovery visible and honest during long waits: rate-limit backoff sleeps and model failovers now surface a retrying cue instead of a silent spinner, `Retry-After: 900` (seconds) is no longer misread as 900 milliseconds, rate-limit and connection errors stay retryable when a payload omits the retryable flag, and the failover question matches the user's answer even when the host UI re-formats the option label. Session lists also sort by the recorded activity time, renaming a session bumps its recency, and resuming a session loads subagent state in parallel for faster open.
