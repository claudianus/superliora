---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/{context/types, compaction/planner.groupMessages} regression cases

- `userPromptDisposition` — pin the undefined-origin `keep` default, the `keep` for the `user` kind, the per-trigger `keep` / `drop` for `skill_activation` and `plugin_command` (only `user-slash` keeps), and the `drop` for every other origin kind (injection, shell_command, compaction_summary, system_trigger, background_task, cron_job, cron_missed, hook_result, retry).
- `isRealUserPromptOrigin` — pin the `true` returns for undefined / `user` / `user-slash` skill/plugin origins, and the `false` returns for dropped kinds (injection, retry).
- `groupMessages` — pin the empty-list empty-groups return, the consecutive-system collapse into a single `system` group with the right start/end indices, the system-group split when interrupted, the `assistant toolCall` + matching `tool` results into a single `tool_exchange` group, the unmatched `toolCallId` not being consumed, the standalone `tool_result` group for orphan tool messages, the single-message `user` / `assistant` group emission, and the preserved start/end indices + message-slice shape.
