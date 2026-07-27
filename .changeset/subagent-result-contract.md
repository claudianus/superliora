---
"@superliora/agent-core": minor
---

Attach a structured result contract to every subagent completion (agent id, profile, git-derived files_changed, verification status, deviations) and render it as a `<subagent-result>` envelope in foreground and swarm hand-offs, so parents receive machine-readable handoff data without the child having to self-report
