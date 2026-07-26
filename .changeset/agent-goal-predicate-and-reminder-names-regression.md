---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/{goal/predicate, turn/reminder-names} regression cases

- `GOAL_COMPLETION_REMINDER_NAME` / `GOAL_BLOCKED_REMINDER_NAME` constant pins.
- `parseGoalPredicateCriterion()` empty / fenced `goal-predicate` / fenced
  `json` / `predicate:v1:` prefix / bare JSON / legacy prose / invalid JSON /
  version-mismatch / clamp & trim / non-object JSON branches.
