---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/skill/prompt render regression cases

- `renderUserSlashSkillPrompt()` user-slash trigger + `<kimi-skill-loaded>` block.
- `renderModelToolSkillPrompt()` `model-tool` and `nested-skill` triggers.
- `renderSkillLoadedBlock()` XML escaping for `skillName` / `skillArgs` and
  optional `source` / `dir` attribute omission.
