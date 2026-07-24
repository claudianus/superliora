---
'@superliora/liora': minor
---

Make UltraSwarm subagents resilient to transient provider failures. A subagent task that hits a transient error (HTTP 5xx, provider overloaded, or a connection-level network error) is now retried in place up to two extra times with short exponential backoff before failing. Rate limits keep their dedicated capacity-aware scheduler, and timeouts, aborts, and permanent 4xx errors still fail immediately (no wasted retries).
