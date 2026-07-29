---
'@superliora/liora': minor
---

Full orchestrator mode for async parallel coding. `orchestratorMode` on Agent activates delegation: system prompt instructs classify-and-route behavior; six tools (SpawnWorker, SteerWorker, QueryWorker, EnqueueWorkerTask, MergeWorker) manage background workers in isolated git worktrees. Runtime toggle via `/orchestrator [on|off]` slash command through the full RPC chain. Workers support DAG dependency scheduling (`dependsOn`), sequential task queues with auto-spawn, file ownership conflict detection, structured result forwarding to follow-up tasks, and per-worker token usage tracking. MergeWorker integrates completed worktree branches back via `git merge`. The TUI footer shows an orchestrator badge with live worker status counts (running/completed/failed) synced through `agent.status.updated` events.
