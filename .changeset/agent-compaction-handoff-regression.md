---
"@superliora/agent-core": patch
---

test(agent-core): pin `handoff.ts` keep/drop policy and helpers

The compaction keep/drop policy decides which user-typed origins survive
compaction. New `PromptOrigin` kinds must add an entry to
`compactionUserMessageDisposition`; the exhaustive `never` switch already
catches omissions at compile time. Pin the policy with regression tests
covering:

- `isCompactionSummaryMessage` true / false / undefined origin
- `compactionUserMessageDisposition` keep for `user` and `user-slash` skill
  activations, drop for ephemeral / system origins (injection, shell,
  compaction_summary, system_trigger, background_task, cron_job,
  cron_missed, hook_result, retry), defensive `keep` for missing origin
- `isRealUserInput` true for `role=user` with keep disposition, false for
  non-user roles and ephemeral user messages
- `collectCompactableUserMessages` keeps real user input but excludes
  compaction summaries
- `buildCompactionElisionText` includes the omitted token count and is
  non-empty even at zero
