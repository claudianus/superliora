---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/background/task regression cases

- `TERMINAL_STATUSES` set membership: `completed`, `failed`, `timed_out`,
  `killed`, `lost` (5 terminal values).
- `running` is not in the terminal set.
