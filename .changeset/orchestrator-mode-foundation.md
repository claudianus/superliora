---
'@superliora/liora': minor
---

Add orchestrator mode for async parallel coding. `orchestratorMode` flag on Agent activates delegation behavior: the system prompt instructs the agent to classify intent, route work to background workers via SpawnWorker/SteerWorker/QueryWorker tools, and respond immediately without performing long-running file operations itself. Workers run in isolated git worktrees. The TUI footer shows an "orchestrator" badge when the mode is active, and the `agent.status.updated` event carries `orchestratorMode` for real-time sync.
