---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/turn/canonical-args.ts and agent/turn/reminder-names.ts regression cases

- `agent/turn/canonical-args.ts` — pins `canonicalTelemetryArgs` (recursive key sort for deterministic JSON, array order preserved, top-level `null` / number / string verbatim, nested string values escaped deterministically).
- `agent/turn/reminder-names.ts` — pins `GOAL_COMPLETION_REMINDER_NAME = 'goal_completion'`, `GOAL_BLOCKED_REMINDER_NAME = 'goal_blocked'`, and the collision-free invariant between them (TUI reminder filtering depends on the names being distinct).
