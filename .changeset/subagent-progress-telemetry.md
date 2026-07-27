---
"@superliora/agent-core": minor
"@superliora/protocol": minor
---

Emit live telemetry for running subagents. The subagent host now polls each child every 5s and emits `subagent.progress` (last tool, target summary, tool count, elapsed time, token spend) on the parent event stream, plus a one-shot `subagent.stalled` when no tool call happens for 5 minutes. The progress timer is unref'd so it never keeps the event loop alive. Adds `SubagentProgressEvent`/`SubagentStalledEvent` to the shared protocol schema and re-exports them from agent-core RPC events.
