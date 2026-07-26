---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/replay/limit regression cases

- `RESUME_REPLAY_TURN_LIMIT` constant pin (10).
- `isReplayUserTurnRecord()` origin branches (no origin, user, skill_activation
  user-slash / auto, shell_command input phase, synthetic origins).
- `limitReplayRecordsByTurn()` early-return and slice behavior (maxTurns ≤ 0,
  under-limit pass-through, last-N windows).
