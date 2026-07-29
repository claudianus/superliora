---
'@superliora/liora': minor
---

Add orchestrator mode foundation for async parallel coding: `orchestratorMode` flag on Agent, plus three orchestrator tools (SpawnWorker, SteerWorker, QueryWorker) that delegate work to background agents in isolated git worktrees. The orchestrator never performs long-running file operations itself — it classifies intent, spawns/steers/queries workers, and reports status.
