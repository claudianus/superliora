---
'@superliora/agent-core': patch
---

Normal plan-mode reminder no longer claims TaskStop is blocked

TaskStop follows the user's permission mode (the plan-mode guard only denies CronCreate/CronDelete and out-of-plan-file Write/Edit). The reminder now names the real denies and states TaskStop follows the permission mode, matching the Ultra Plan phase text.
