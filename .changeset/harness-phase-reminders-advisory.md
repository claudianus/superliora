---
'@superliora/agent-core': patch
---

Align Ultra Plan phase reminders with the advisory gate reality

- Drop false enforcement claims from the injected phase text: TaskStop and ExitPlanMode are no longer described as BLOCKED (they follow the user's permission mode since the ritual-gate removal).
- Design/Review no longer say the plan file cannot be written or ExitPlanMode cannot be called; the text now states the real harness guards (product Write/Edit denied outside the plan file, CronCreate/CronDelete denied) and marks the rest as guidance.
- Interview readiness wording changes from "Hard gate for NextPhase to Design" to a recommendation: a verifiable UltraGoal is recommended, gaps soft-fill, and NextPhase advances with a readiness warning instead of blocking.
