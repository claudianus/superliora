---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/permission/policies/plan-mode-guard-deny regression cases

- Pin documented policy name (`plan-mode-guard-deny`).
- Evaluate: returns undefined when plan mode is inactive.
- Evaluate: denies `CronCreate` / `CronDelete` in plan mode (mutation forbidden
  before ExitPlanMode).
