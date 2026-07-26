---
'@superliora/agent-core': patch
---

test(agent-core): pin session/ultra-swarm-critic.ts and swarm-bus-coordination XML builder regression cases

- `buildCriticAssignmentXml` — pins the documented `<critic_assignment>` envelope, target-handoff wrap, conditional `<review_lens id=...>angle</review_lens>` block (omitted when either id or angle is missing).
- `assignDiverseCriticEdges` — pins the empty reviewers / sources / lenses short-circuit, the implement → plan → review priority order for targets, the same-reviewer skip key (each reviewer is assigned at most once per source set), and the lens metadata propagation to each assignment.
- `buildTeamRosterXml` — pins the `<team_roster>` envelope, `coverageLane ?? role` fallback per expert, and the empty-team empty-bullet case.
- `buildSwarmChannelRulesXml` — pins the documented channel rule list (standup / lane / direct / blocker / council channels and the 500-char cap).
- `buildSwarmCollaborationRequiredXml` — pins the implement / review / plan phase-specific collaboration checklist.
