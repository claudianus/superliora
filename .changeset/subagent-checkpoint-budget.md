---
"@superliora/agent-core": minor
"@superliora/protocol": minor
---

Add checkpoints, finishing mode, and budget telemetry for subagents. While a subagent runs, the host now writes a durable checkpoint (todo list, dirty files, tool count, token spend) under the Liora home every 10 tool calls; `resume` injects the recovered snapshot as a reminder and consumes it, so an interrupted agent continues instead of blindly re-running. Runs also carry an explicit wall-clock budget: `subagent.progress` events now include `budgetMs`, `budgetRemainingMs`, and `finishing`, and when five minutes of budget remain the child gets a one-shot finishing-mode reminder (stop new work, verify, summarize). The Agent tool and swarm batch forward their timeouts into the host so single agents and swarm tasks share the same budget surface.
