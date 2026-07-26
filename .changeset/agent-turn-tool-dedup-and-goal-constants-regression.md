---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/{turn/tool-dedup, goal/index} regression cases

- `GOAL_COMPLETE_REJECT_COOLDOWN_TURNS` (3) and `GOAL_NO_PROGRESS_STREAK_K`
  (6) constant pins.
- `__testing.REMINDER_TEXT_1` / `REMINDER_TEXT_3` / `DOOM_LOOP_HARD_STOP_TEXT`
  content pins.
- `__testing.REPEAT_FORCE_STOP_STREAK` is a positive integer.
- `__testing.makeReminderText2(toolName, streak)` returns a non-empty string
  that mentions the tool name and streak count.
