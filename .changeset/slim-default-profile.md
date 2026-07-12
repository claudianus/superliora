---
'@superliora/liora': minor
---

Slim down the default agent profile and add a backwards-compatible full profile.

- The default `agent` profile now exposes only the 10 tools needed for everyday coding: `Read`, `Write`, `Edit`, `Glob`, `Grep`, `Bash`, `LioraRead`, `WebSearch`, `FetchURL`, and `AskUserQuestion` (plus MCP tools).
- Specialized tools such as Plan Mode, Goal, Background/Cron, GUI, and Swarm are no longer shown to the model by default.
- Subagent profiles (`coder`, `explore`, `plan`, `ultra-plan`) keep the tools they need for their specific roles.
- New `superliora-full` profile restores the previous default tool set for users who depend on it.
