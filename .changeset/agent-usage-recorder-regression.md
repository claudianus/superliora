---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/usage/UsageRecorder regression cases

- `UsageRecorder.beginTurn` / `endTurn` — pin the no-aggregation behaviour when nothing has been recorded.
- `UsageRecorder.record` — pin per-model aggregation across multiple records, the per-turn total kept only for `scope: 'turn'` records and reset across turns, the no-per-turn-total behaviour for `scope: 'session'`, the `agent.records.logRecord({ type: 'usage.record', model, usage, usageScope })` integration, the `agent.emitStatusUpdated()` call on every record, and the no-agent crash-safety.
- `UsageRecorder.data` / `status` — pin the defensive-copy guarantee on `byModel` entries and `currentTurn`, the session `cacheHitRate` (`inputCacheRead / inputTotal`) when the total is present, the `cacheHitRate: 0` result when the total has no cache reads, and the `undefined` status when nothing has been recorded.
