---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/swarm/SwarmMode regression cases

- `enter(trigger)` activates the mode, logs `swarm_mode.enter`, and appends the
  enter reminder for `manual` / `task` triggers; `tool` trigger skips the
  reminder.
- `enter` on already-active mode is a no-op.
- `restoreEnter` only flips the active flag (no logs / reminders / emits).
- `exit()` logs `swarm_mode.exit`, clears active, emits status update;
  `tool` trigger skips the pop + exit reminder; an active pop short-circuits
  the exit reminder append.
- `isActive` / `shouldAutoExit` (true for `task` / `tool`, false for `manual`).
