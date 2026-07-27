---
"@superliora/agent-core": minor
---

Introduce the unified fan-out primitive. `src/session/spawn-agents.ts` defines one `FanoutSpec` (mode: manual/template/expert, tasks, contract, budget, ownership) plus `spawnOneAgent`/`spawnAgents` entry points; the Agent tool is now a thin alias that maps its schema onto a single-task manual spec instead of calling host spawn/resume directly. Runtime, events, leases, and contract/budget wiring hang off one shape; AgentSwarm and UltraSwarm keep their orchestration engines but share the same option derivation, and expert mode stays a documented boundary.
